// 외부 API 쿼터 가드 (계획서 §5.2.1)
// 모든 외부 호출은 withQuota()를 거친다. 호출 "전에" 카운터를 올리고, 한도에 닿으면 호출하지 않는다.
// 한도가 설정되지 않은 api_cd는 거부한다(fail-closed) — 셀 수 없는 호출이 생기지 않도록.
import { sql } from '../db/pool.js';
import { AppError } from '../util/errors.js';

const pad = (n) => String(n).padStart(2, '0');

/** 서버 로컬(KST) 기준 기간 키 */
export function periodKeys(now = new Date()) {
  const ym = `${now.getFullYear()}${pad(now.getMonth() + 1)}`;
  return { DAY: `${ym}${pad(now.getDate())}`, MONTH: ym };
}

async function loadLimits(tx, apiCd) {
  const r = await new sql.Request(tx)
    .input('day', sql.VarChar(60), `quota.${apiCd}.DAY`)
    .input('month', sql.VarChar(60), `quota.${apiCd}.MONTH`)
    .query('SELECT setting_key, setting_val FROM dbo.setting WHERE setting_key IN (@day, @month)');
  const limits = {};
  for (const row of r.recordset) {
    const n = Number(row.setting_val);
    if (Number.isInteger(n) && n >= 0) limits[row.setting_key.endsWith('.DAY') ? 'DAY' : 'MONTH'] = n;
  }
  return limits;
}

/** 카운터 1 증가. 한도 초과·미설정이면 AppError(QUOTA_*) — 이때 카운터는 변하지 않는다. */
export async function consume(pool, apiCd, now = new Date()) {
  const keys = periodKeys(now);
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const limits = await loadLimits(tx, apiCd);
    const periods = Object.keys(limits);
    if (periods.length === 0) {
      throw new AppError('QUOTA_NOT_CONFIGURED', `${apiCd} 쿼터 한도가 설정되지 않았습니다`, 503);
    }
    const counts = {};
    for (const p of periods) {
      const r = await new sql.Request(tx)
        .input('a', sql.VarChar(30), apiCd)
        .input('p', sql.VarChar(5), p)
        .input('k', sql.Char(8), keys[p].padEnd(8))
        .input('l', sql.Int, limits[p]).query(`
          MERGE dbo.api_quota WITH (HOLDLOCK) AS t
          USING (SELECT @a AS api_cd, @p AS period_type, @k AS period_key, @l AS limit_cnt) AS s
             ON t.api_cd = s.api_cd AND t.period_type = s.period_type AND t.period_key = s.period_key
          WHEN MATCHED AND t.call_cnt < s.limit_cnt
               THEN UPDATE SET call_cnt = t.call_cnt + 1, limit_cnt = s.limit_cnt
          WHEN NOT MATCHED AND s.limit_cnt > 0
               THEN INSERT (api_cd, period_type, period_key, call_cnt, limit_cnt)
                    VALUES (s.api_cd, s.period_type, s.period_key, 1, s.limit_cnt)
          OUTPUT inserted.call_cnt;`);
      if (r.recordset.length === 0) {
        throw new AppError('QUOTA_EXCEEDED', `${apiCd} ${p === 'DAY' ? '일' : '월'} 한도(${limits[p]}) 초과`, 429);
      }
      counts[p] = { used: r.recordset[0].call_cnt, limit: limits[p] };
    }
    await tx.commit();
    return counts;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

/** 쿼터를 소비한 뒤 fn 실행. 재시도도 각각 withQuota로 감싼다(재시도도 쿼터에 포함). */
export async function withQuota(pool, apiCd, fn) {
  await consume(pool, apiCd);
  return fn();
}

/** 현재 기간 사용량 (설정 화면·/api/quota) */
export async function usage(pool, now = new Date()) {
  const keys = periodKeys(now);
  const r = await pool
    .request()
    .input('d', sql.Char(8), keys.DAY)
    .input('m', sql.Char(8), keys.MONTH.padEnd(8)).query(`
      SELECT s.setting_key, s.setting_val, q.call_cnt
      FROM dbo.setting s
      LEFT JOIN dbo.api_quota q
        ON s.setting_key = CONCAT('quota.', q.api_cd, '.', q.period_type)
       AND q.period_key = CASE q.period_type WHEN 'DAY' THEN @d ELSE @m END
      WHERE s.setting_key LIKE 'quota.%.%'`);
  return r.recordset.map((row) => {
    const [, apiCd, period] = row.setting_key.split('.');
    return { apiCd, period, used: row.call_cnt ?? 0, limit: Number(row.setting_val) };
  });
}
