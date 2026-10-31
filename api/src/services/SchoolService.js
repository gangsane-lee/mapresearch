// 학교·학업성취도·단지 배정 (계획서 §3.2 #10·#11) — 배정은 이력 관리(valid_from/valid_to), 성취도는 연도별
import { z } from 'zod';
import { sql } from '../db/pool.js';
import { withTransaction, ymd, num } from '../db/tx.js';
import { AppError } from '../util/errors.js';

const KIND = ['ELEM', 'MIDDLE', 'HIGH'];

function parse(schema, body) {
  const r = schema.safeParse(body);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new AppError('VALIDATION', `${i.path.join('.') || '입력'}: ${i.message}`, 400);
  }
  return r.data;
}

export const schoolInput = z.object({
  schoolNm: z.string().min(1).max(50),
  schoolKind: z.enum(KIND),
  sigunguCd: z.string().regex(/^\d{5}$/).nullish(),
  address: z.string().max(200).nullish(),
});

export const statInput = z.object({
  year: z.number().int().min(2000).max(2100),
  metricCd: z.string().regex(/^[A-Z0-9_]{1,30}$/),
  metricDesc: z.string().min(1).max(200), // 지표 정의·출처 (U10) 필수
  value: z.number().min(0).max(100000),
});

export const assignInput = z.object({
  schoolId: z.number().int().positive(),
  validFrom: z.iso.date(),
  walkMin: z.number().int().min(0).max(180).nullish(),
  busMin: z.number().int().min(0).max(180).nullish(),
  memo: z.string().max(300).nullish(),
});

const statSql = `
  OUTER APPLY (SELECT TOP (1) st.stat_year, st.metric_cd, st.metric_desc, st.value
               FROM dbo.school_stat st WHERE st.school_id = s.school_id
               ORDER BY st.stat_year DESC, st.metric_cd) ls`;

const toSchool = (s) => ({
  schoolId: s.school_id,
  schoolNm: s.school_nm,
  schoolKind: s.school_kind,
  sigunguCd: s.sigungu_cd,
  address: s.address,
  latestStat: s.stat_year == null ? null : { year: s.stat_year, metricCd: s.metric_cd, metricDesc: s.metric_desc, value: num(s.value) },
});

export async function searchSchools(pool, q) {
  const r = await pool
    .request()
    .input('q', sql.NVarChar(60), `%${(q ?? '').trim()}%`)
    .query(`SELECT TOP (50) s.*, ls.* FROM dbo.school s ${statSql} WHERE s.school_nm LIKE @q ORDER BY s.school_nm`);
  return r.recordset.map(toSchool);
}

export async function upsertSchool(pool, schoolId, body) {
  const v = parse(schoolInput, body);
  const req = pool
    .request()
    .input('n', sql.NVarChar(50), v.schoolNm)
    .input('k', sql.VarChar(10), v.schoolKind)
    .input('g', sql.Char(5), v.sigunguCd ?? null)
    .input('a', sql.NVarChar(200), v.address ?? null);
  if (schoolId == null) {
    const r = await req.query('INSERT dbo.school (school_nm, school_kind, sigungu_cd, address) OUTPUT inserted.school_id VALUES (@n, @k, @g, @a)');
    return { schoolId: r.recordset[0].school_id };
  }
  const u = await req.input('id', sql.Int, schoolId).query('UPDATE dbo.school SET school_nm = @n, school_kind = @k, sigungu_cd = @g, address = @a WHERE school_id = @id');
  if (!u.rowsAffected[0]) throw new AppError('NOT_FOUND', '학교를 찾을 수 없습니다', 404);
  return { schoolId };
}

/** 연도·지표별 성취도 저장 (같은 연도·지표는 갱신) */
export async function upsertStat(pool, schoolId, body) {
  const v = parse(statInput, body);
  await pool
    .request()
    .input('s', sql.Int, schoolId)
    .input('y', sql.SmallInt, v.year)
    .input('m', sql.VarChar(30), v.metricCd)
    .input('d', sql.NVarChar(200), v.metricDesc)
    .input('v', sql.Decimal(9, 4), v.value).query(`
      MERGE dbo.school_stat WITH (HOLDLOCK) AS t
      USING (SELECT @s AS school_id, @y AS stat_year, @m AS metric_cd) AS k
         ON t.school_id = k.school_id AND t.stat_year = k.stat_year AND t.metric_cd = k.metric_cd
      WHEN MATCHED THEN UPDATE SET metric_desc = @d, value = @v
      WHEN NOT MATCHED THEN INSERT (school_id, stat_year, metric_cd, metric_desc, value) VALUES (@s, @y, @m, @d, @v);`);
  return { schoolId, year: v.year, metricCd: v.metricCd };
}

export async function schoolStats(pool, schoolId) {
  const r = await pool
    .request()
    .input('s', sql.Int, schoolId)
    .query('SELECT stat_year, metric_cd, metric_desc, value FROM dbo.school_stat WHERE school_id = @s ORDER BY stat_year, metric_cd');
  return r.recordset.map((x) => ({ year: x.stat_year, metricCd: x.metric_cd, metricDesc: x.metric_desc, value: num(x.value) }));
}

/** 단지 배정 학교 (현재 + 이력) */
export async function complexSchools(pool, complexId) {
  const r = await pool
    .request()
    .input('c', sql.Int, complexId)
    .query(`SELECT cs.complex_school_id, cs.valid_from, cs.valid_to, cs.walk_min, cs.bus_min, cs.memo, s.*, ls.*
            FROM dbo.complex_school cs JOIN dbo.school s ON s.school_id = cs.school_id ${statSql}
            WHERE cs.complex_id = @c ORDER BY CASE WHEN cs.valid_to IS NULL THEN 0 ELSE 1 END, s.school_kind, cs.valid_from DESC`);
  return r.recordset.map((x) => ({
    ...toSchool(x),
    complexSchoolId: x.complex_school_id,
    validFrom: ymd(x.valid_from),
    validTo: ymd(x.valid_to),
    current: x.valid_to == null,
    walkMin: x.walk_min,
    busMin: x.bus_min,
    memo: x.memo,
  }));
}

/** 배정 변경: 같은 급(중학교 등)의 현재 배정을 validFrom 전날로 마감하고 새 배정 추가 (이력 보존) */
export async function assignSchool(pool, complexId, body) {
  const v = parse(assignInput, body);
  return withTransaction(pool, async (_tx, req) => {
    const s = await req().input('s', sql.Int, v.schoolId).query('SELECT school_kind FROM dbo.school WHERE school_id = @s');
    if (!s.recordset.length) throw new AppError('NOT_FOUND', '학교를 찾을 수 없습니다', 404);
    await req()
      .input('c', sql.Int, complexId)
      .input('k', sql.VarChar(10), s.recordset[0].school_kind)
      .input('f', sql.Date, v.validFrom).query(`
        UPDATE cs SET valid_to = DATEADD(day, -1, @f)
        FROM dbo.complex_school cs JOIN dbo.school x ON x.school_id = cs.school_id
        WHERE cs.complex_id = @c AND cs.valid_to IS NULL AND x.school_kind = @k AND cs.valid_from < @f`);
    const r = await req()
      .input('c', sql.Int, complexId)
      .input('s', sql.Int, v.schoolId)
      .input('f', sql.Date, v.validFrom)
      .input('w', sql.SmallInt, v.walkMin ?? null)
      .input('b', sql.SmallInt, v.busMin ?? null)
      .input('m', sql.NVarChar(300), v.memo ?? null).query(`
        INSERT dbo.complex_school (complex_id, school_id, valid_from, walk_min, bus_min, memo)
        OUTPUT inserted.complex_school_id VALUES (@c, @s, @f, @w, @b, @m)`);
    return { complexSchoolId: r.recordset[0].complex_school_id };
  });
}
