// 실거래 수집·적재·단지 연결 (계획서 §5.5 월 배치, §4.2 중복 제거)
// 화면 로딩 경로에서 호출하지 않는다 — 배치(scripts/sync-trades.js)와 수동 동기화 API 에서만.
import { sql } from '../db/pool.js';
import { withTransaction } from '../db/tx.js';
import { fetchMonth as realFetchMonth, siteKey } from '../external/rtms.js';
import { tradeKeyHash, rentKeyHash, assignDupSeq } from '../util/trade.js';
import { AppError } from '../util/errors.js';

// 호출마다 다른 임시 테이블 (세션 종료·연결 재설정 시 SQL Server 가 정리)
const tempName = (p) => `#${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const cut = (s, n) => (s == null ? null : String(s).slice(0, n));

/** 기준월에서 n개월 거꾸로 'yyyyMM' 목록 (신고 지연 30일 → 직전 달들도 다시 받는다) */
export function recentMonths(n, now = new Date()) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** 시군구의 법정동명 → 법정동코드 (kapt_ref 기준). 같은 이름이 여러 코드면 제외 */
async function umdMap(pool, sigunguCd) {
  const r = await pool
    .request()
    .input('g', sql.Char(5), sigunguCd)
    .query(`SELECT umd_nm, MIN(bjd_cd) AS bjd_cd FROM dbo.kapt_ref WHERE sigungu_cd = @g
            GROUP BY umd_nm HAVING COUNT(DISTINCT bjd_cd) = 1`);
  return new Map(r.recordset.map((x) => [x.umd_nm, x.bjd_cd]));
}

/** 정규화된 행 → dup_seq·해시·법정동코드 부여 (순수) */
export function prepareRows(kind, rows, umd) {
  const keyFn = kind === 'SALE' ? (t) => tradeKeyHash({ ...t, aptSeq: siteKey(t) }) : (t) => rentKeyHash({ ...t, aptSeq: siteKey(t) });
  return assignDupSeq(rows, keyFn).map((t) => ({ ...t, bjdCd: umd.get(t.umdNm) ?? null }));
}

async function upsertSales(req, rows) {
  const tmp = tempName('trade');
  const t = new sql.Table(tmp);
  t.create = true;
  t.columns.add('sigungu_cd', sql.Char(5), { nullable: false });
  t.columns.add('bjd_cd', sql.Char(10), { nullable: true });
  t.columns.add('umd_nm', sql.NVarChar(40), { nullable: true });
  t.columns.add('apt_nm', sql.NVarChar(100), { nullable: true });
  t.columns.add('jibun', sql.NVarChar(30), { nullable: true });
  t.columns.add('deal_date', sql.Date, { nullable: false });
  t.columns.add('excl_m2', sql.Decimal(7, 2), { nullable: false });
  t.columns.add('floor', sql.SmallInt, { nullable: true });
  t.columns.add('dong', sql.NVarChar(20), { nullable: true });
  t.columns.add('amount_man', sql.Int, { nullable: false });
  t.columns.add('cancel_flag', sql.Bit, { nullable: false });
  t.columns.add('cancel_date', sql.Date, { nullable: true });
  t.columns.add('deal_type', sql.NVarChar(10), { nullable: true });
  t.columns.add('dup_seq', sql.SmallInt, { nullable: false });
  t.columns.add('natural_key_hash', sql.Char(64), { nullable: false });
  for (const r of rows) {
    t.rows.add(r.sigunguCd, r.bjdCd, cut(r.umdNm, 40), cut(r.aptNm, 100), cut(r.jibun, 30), r.dealDate, r.exclM2, r.floor, cut(r.dong, 20),
      r.amountMan, r.canceled, r.cancelDate, cut(r.dealType, 10), r.dupSeq, r.naturalKeyHash);
  }
  await req().bulk(t);
  // 해제는 같은 자연키 행의 cancel_* 갱신 (계획서 §4.2). 거래 원본은 지우지 않는다.
  const m = await req().query(`
    DECLARE @out TABLE (act nvarchar(10));
    MERGE dbo.trade AS t
    USING ${tmp} AS s ON t.natural_key_hash = s.natural_key_hash AND t.dup_seq = s.dup_seq
    WHEN MATCHED THEN UPDATE SET last_seen_at = SYSDATETIME(), cancel_flag = s.cancel_flag,
         cancel_date = COALESCE(s.cancel_date, t.cancel_date), bjd_cd = COALESCE(t.bjd_cd, s.bjd_cd), deal_type = COALESCE(s.deal_type, t.deal_type)
    WHEN NOT MATCHED THEN INSERT (sigungu_cd, apt_seq, apt_nm, jibun, deal_date, excl_m2, floor, dong, amount_man, cancel_flag, cancel_date,
                                  dup_seq, natural_key_hash, bjd_cd, umd_nm, deal_type)
         VALUES (s.sigungu_cd, NULL, s.apt_nm, s.jibun, s.deal_date, s.excl_m2, s.floor, s.dong, s.amount_man, s.cancel_flag, s.cancel_date,
                 s.dup_seq, s.natural_key_hash, s.bjd_cd, s.umd_nm, s.deal_type)
    OUTPUT $action INTO @out;
    SELECT SUM(CASE WHEN act = 'INSERT' THEN 1 ELSE 0 END) AS inserted, SUM(CASE WHEN act = 'UPDATE' THEN 1 ELSE 0 END) AS updated FROM @out;`);
  return m.recordset[0];
}

async function upsertRents(req, rows) {
  const tmp = tempName('rent');
  const t = new sql.Table(tmp);
  t.create = true;
  t.columns.add('sigungu_cd', sql.Char(5), { nullable: false });
  t.columns.add('bjd_cd', sql.Char(10), { nullable: true });
  t.columns.add('umd_nm', sql.NVarChar(40), { nullable: true });
  t.columns.add('apt_seq', sql.VarChar(30), { nullable: true });
  t.columns.add('apt_nm', sql.NVarChar(100), { nullable: true });
  t.columns.add('jibun', sql.NVarChar(30), { nullable: true });
  t.columns.add('deal_date', sql.Date, { nullable: false });
  t.columns.add('excl_m2', sql.Decimal(7, 2), { nullable: false });
  t.columns.add('floor', sql.SmallInt, { nullable: true });
  t.columns.add('deposit_man', sql.Int, { nullable: false });
  t.columns.add('monthly_man', sql.Int, { nullable: false });
  t.columns.add('contract_type', sql.NVarChar(10), { nullable: true });
  t.columns.add('contract_term', sql.NVarChar(30), { nullable: true });
  t.columns.add('dup_seq', sql.SmallInt, { nullable: false });
  t.columns.add('natural_key_hash', sql.Char(64), { nullable: false });
  for (const r of rows) {
    t.rows.add(r.sigunguCd, r.bjdCd, cut(r.umdNm, 40), cut(r.aptSeq, 30), cut(r.aptNm, 100), cut(r.jibun, 30), r.dealDate, r.exclM2, r.floor,
      r.depositMan, r.monthlyMan, cut(r.contractType, 10), cut(r.contractTerm, 30), r.dupSeq, r.naturalKeyHash);
  }
  await req().bulk(t);
  const m = await req().query(`
    DECLARE @out TABLE (act nvarchar(10));
    MERGE dbo.trade_rent AS t
    USING ${tmp} AS s ON t.natural_key_hash = s.natural_key_hash AND t.dup_seq = s.dup_seq
    WHEN MATCHED THEN UPDATE SET last_seen_at = SYSDATETIME(), bjd_cd = COALESCE(t.bjd_cd, s.bjd_cd)
    WHEN NOT MATCHED THEN INSERT (sigungu_cd, apt_seq, apt_nm, jibun, deal_date, excl_m2, floor, deposit_man, monthly_man, contract_type,
                                  contract_term, dup_seq, natural_key_hash, bjd_cd, umd_nm)
         VALUES (s.sigungu_cd, s.apt_seq, s.apt_nm, s.jibun, s.deal_date, s.excl_m2, s.floor, s.deposit_man, s.monthly_man, s.contract_type,
                 s.contract_term, s.dup_seq, s.natural_key_hash, s.bjd_cd, s.umd_nm)
    OUTPUT $action INTO @out;
    SELECT SUM(CASE WHEN act = 'INSERT' THEN 1 ELSE 0 END) AS inserted, SUM(CASE WHEN act = 'UPDATE' THEN 1 ELSE 0 END) AS updated FROM @out;`);
  return m.recordset[0];
}

/**
 * 미연결 실거래를 단지에 연결 (법정동코드 + 지번이 같은 단지 중).
 * 한 필지에 단지가 여럿인 경우가 흔하다(전국 필지의 약 15% — 예: 봉천동 1712 관악드림 삼성/동아·초원).
 *   1) 거래 단지명(aptNm)이 단지 이름(표시명·식별정보 3종 이름) 중 하나와 같으면 연결
 *   2) 이름이 달라도, 그 필지에 등록 단지가 하나이고 거래 단지명도 한 종류뿐이면 연결
 * 그 밖은 연결하지 않는다 (unlinked 로 보고).
 */
export async function linkTrades(pool, sigunguCd) {
  const out = {};
  for (const tbl of ['trade', 'trade_rent']) {
    const r = await pool.request().input('g', sql.Char(5), sigunguCd).query(`
      WITH cx AS (
        SELECT c.complex_id, c.bjd_cd, c.jibun, c.display_nm, k.nm_price, k.nm_bld, k.nm_road
        FROM dbo.complex c
        LEFT JOIN dbo.complex_ext_id x ON x.complex_id = c.complex_id AND x.source = 'KAPT' AND x.valid_to IS NULL
        LEFT JOIN dbo.kapt_ref k ON k.danji_id = x.ext_id
        WHERE c.sigungu_cd = @g AND c.bjd_cd IS NOT NULL AND c.jibun IS NOT NULL),
      site AS (SELECT bjd_cd, jibun, COUNT(*) AS n FROM cx GROUP BY bjd_cd, jibun),
      tn AS (SELECT bjd_cd, jibun, COUNT(DISTINCT apt_nm) AS names FROM dbo.${tbl} WHERE sigungu_cd = @g GROUP BY bjd_cd, jibun)
      UPDATE t SET complex_id = cx.complex_id
      FROM dbo.${tbl} t
      JOIN cx ON cx.bjd_cd = t.bjd_cd AND cx.jibun = t.jibun
      JOIN site s ON s.bjd_cd = t.bjd_cd AND s.jibun = t.jibun
      JOIN tn ON tn.bjd_cd = t.bjd_cd AND tn.jibun = t.jibun
      WHERE t.sigungu_cd = @g AND t.complex_id IS NULL
        AND (t.apt_nm IN (cx.display_nm, cx.nm_price, cx.nm_bld, cx.nm_road) OR (s.n = 1 AND tn.names = 1));
      SELECT @@ROWCOUNT AS n;

      SELECT COUNT(*) AS n FROM dbo.${tbl} t
      WHERE t.sigungu_cd = @g AND t.complex_id IS NULL
        AND EXISTS (SELECT 1 FROM dbo.complex c WHERE c.bjd_cd = t.bjd_cd AND c.jibun = t.jibun);`);
    out[tbl] = r.recordsets[0][0].n;
    out[`${tbl}_unlinked`] = r.recordsets[1][0].n; // 등록 단지 필지에 있지만 다른 단지로 보이는 거래
  }
  return out;
}

/**
 * 한 시군구 × 여러 달 × 매매·전월세 동기화.
 * @returns 월·종류별 { fetched, inserted, updated } 와 연결 건수
 */
export async function syncTrades(pool, { serviceKey, sigunguCd, months = 3, kinds = ['SALE', 'RENT'], now, fetchMonth = realFetchMonth }) {
  if (!/^\d{5}$/.test(sigunguCd ?? '')) throw new AppError('VALIDATION', 'sigunguCd 는 5자리', 400);
  if (!Number.isInteger(months) || months < 1 || months > 36) throw new AppError('VALIDATION', 'months 는 1~36', 400);
  const umd = await umdMap(pool, sigunguCd);
  const results = [];
  for (const ym of recentMonths(months, now)) {
    for (const kind of kinds) {
      const rows = prepareRows(kind, await fetchMonth({ pool, serviceKey, kind, lawdCd: sigunguCd, ym }), umd);
      const r = rows.length ? await withTransaction(pool, (_tx, req) => (kind === 'SALE' ? upsertSales : upsertRents)(req, rows)) : { inserted: 0, updated: 0 };
      results.push({
        ym,
        kind,
        fetched: rows.length,
        inserted: r.inserted ?? 0,
        updated: r.updated ?? 0,
        noBjd: rows.filter((x) => !x.bjdCd).length,
      });
    }
  }
  const linked = await linkTrades(pool, sigunguCd);
  return { sigunguCd, results, linked };
}

/** 배치 대상 시군구: 등록된 단지가 있는 곳 (제외 상태 제외) */
export async function targetSigungus(pool) {
  const r = await pool.request().query("SELECT DISTINCT sigungu_cd FROM dbo.complex WHERE status <> 'EXCLUDED' ORDER BY sigungu_cd");
  return r.recordset.map((x) => x.sigungu_cd);
}
