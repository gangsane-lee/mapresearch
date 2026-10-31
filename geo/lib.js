// 경계 빌드의 순수 함수 (테스트 대상)

/**
 * 시군구명에서 상위 시 분리. admdongkor sggnm은 "성남시분당구" / "성남시 분당구" 두 형태 모두 대응.
 * @returns {{ cityNm: string|null, sggNm: string }}
 */
export function splitCityName(sggnm) {
  const s = sggnm.trim();
  const m = /^(\S+?시)\s?(\S+구)$/.exec(s);
  if (m) return { cityNm: m[1], sggNm: `${m[1]} ${m[2]}` };
  return { cityNm: null, sggNm: s };
}

/** GeoJSON geometry(Polygon/MultiPolygon) bbox [minLng, minLat, maxLng, maxLat] */
export function bboxOf(geometry) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const poly of polys)
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
  return [minX, minY, maxX, maxY].map((v) => Math.round(v * 1e6) / 1e6);
}

const q = (v) => (v == null ? 'NULL' : `N'${String(v).replace(/'/g, "''")}'`);

/** region seed (MERGE) SQL 생성 */
export function regionSeedSql(rows) {
  const values = rows
    .map(
      (r) =>
        `    ('${r.code}', '${r.sidoCd}', ${q(r.sidoNm)}, ${q(r.sggNm)}, ${q(r.cityNm)}, ${r.bbox.join(', ')})`,
    )
    .join(',\n');
  return `/*
  region — geo/build-boundaries.js 가 생성 (직접 수정 금지, 재빌드로 갱신)
  경계 데이터(admdongkor) 시군구 코드 기준. 법정동 코드(LAWD_CD)와 다른 지역은 region_code_map 으로 대응.
*/
MERGE dbo.region AS t
USING (VALUES
${values}
) AS s (sigungu_cd, sido_cd, sido_nm, sgg_nm, city_nm, min_lng, min_lat, max_lng, max_lat)
ON t.sigungu_cd = s.sigungu_cd
WHEN MATCHED THEN UPDATE SET sido_cd = s.sido_cd, sido_nm = s.sido_nm, sgg_nm = s.sgg_nm, city_nm = s.city_nm,
    min_lng = s.min_lng, min_lat = s.min_lat, max_lng = s.max_lng, max_lat = s.max_lat
WHEN NOT MATCHED THEN INSERT (sigungu_cd, sido_cd, sido_nm, sgg_nm, city_nm, min_lng, min_lat, max_lng, max_lat)
    VALUES (s.sigungu_cd, s.sido_cd, s.sido_nm, s.sgg_nm, s.city_nm, s.min_lng, s.min_lat, s.max_lng, s.max_lat);
`;
}
