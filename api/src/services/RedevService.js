// 정비사업 참고값 (계획서 §6 4번): redev_ref 는 국토부 CSV 원본, 단지 연결은 수동
import { sql } from '../db/pool.js';
import { AppError } from '../util/errors.js';

/** 단지와 같은 시군구의 정비구역 후보 + 이미 연결된 구역 (최신 기준연도 우선) */
export async function listRedevRefs(pool, complexId, q = '') {
  const r = await pool
    .request()
    .input('c', sql.Int, complexId)
    .input('q', sql.NVarChar(60), `%${q.trim()}%`).query(`
      SELECT TOP (100) rr.redev_ref_id, rr.base_year, rr.sido_nm, rr.sgg_nm, rr.zone_nm, rr.stage, rr.biz_type,
             rr.operator_nm, rr.supply_hhld, rr.complex_id
      FROM dbo.complex c
      LEFT JOIN dbo.region g ON g.sigungu_cd = c.sigungu_cd
      JOIN dbo.redev_ref rr
        ON rr.complex_id = c.complex_id
        OR (rr.complex_id IS NULL AND REPLACE(rr.sgg_nm, N' ', N'') = REPLACE(g.sgg_nm, N' ', N'') AND rr.zone_nm LIKE @q)
      WHERE c.complex_id = @c
      ORDER BY CASE WHEN rr.complex_id = c.complex_id THEN 0 ELSE 1 END, rr.base_year DESC, rr.zone_nm`);
  return r.recordset.map((x) => ({
    redevRefId: x.redev_ref_id,
    baseYear: x.base_year,
    sidoNm: x.sido_nm,
    sggNm: x.sgg_nm,
    zoneNm: x.zone_nm,
    stage: x.stage,
    bizType: x.biz_type,
    operatorNm: x.operator_nm,
    supplyHhld: x.supply_hhld,
    linked: x.complex_id === complexId,
  }));
}

export async function linkRedevRef(pool, redevRefId, complexId) {
  const u = await pool
    .request()
    .input('id', sql.Int, redevRefId)
    .input('c', sql.Int, complexId)
    .query('UPDATE dbo.redev_ref SET complex_id = @c WHERE redev_ref_id = @id');
  if (!u.rowsAffected[0]) throw new AppError('NOT_FOUND', '정비구역을 찾을 수 없습니다', 404);
  return { redevRefId, complexId };
}
