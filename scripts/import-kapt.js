// 한국부동산원 "공동주택 단지 식별정보_기본정보" CSV → kapt_ref 적재 (단지 등록 검색·마스터 출처)
//
//   node scripts/import-kapt.js --file "한국부동산원_공동주택 단지 식별정보_기본정보_20260831.csv"           (미리보기)
//   node scripts/import-kapt.js --file <CSV> --apply                                                       (적재, .env 의 DB)
//   node --env-file=.env.test scripts/import-kapt.js --file <CSV> --apply                                  (TEST DB)
//
// - 기본은 단지종류 1(아파트)만. --kinds 1,2,3 으로 연립·다세대 포함.
// - 기준일은 파일명의 yyyyMMdd (없으면 --base-date). 재적재 시 같은 단지고유번호는 갱신(MERGE) — 참조 데이터라 이력 불필요.
// - region 에 없는 시군구는 이름만으로 추가한다(경계·bbox 는 geo:build 의 040_region seed 가 채움).
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sql from 'mssql';
import { decodeText, parseCsv } from '../shared/csv.js';
import { KAPT_HEADER, parseKaptRow, kaptName } from '../shared/kapt.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: a } = parseArgs({
  options: {
    file: { type: 'string' },
    apply: { type: 'boolean', default: false },
    kinds: { type: 'string', default: '1' },
    'base-date': { type: 'string' },
  },
});
if (!a.file) {
  console.error('사용: node scripts/import-kapt.js --file <CSV> [--kinds 1,2,3] [--base-date YYYY-MM-DD] [--apply]');
  process.exit(1);
}
const m = /(\d{4})(\d{2})(\d{2})/.exec(path.basename(a.file));
const baseDate = a['base-date'] ?? (m ? `${m[1]}-${m[2]}-${m[3]}` : null);
if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate ?? '')) {
  console.error('기준일을 알 수 없습니다. --base-date YYYY-MM-DD 를 지정하세요.');
  process.exit(1);
}
const kinds = new Set(a.kinds.split(',').map(Number));

const [header, ...body] = parseCsv(decodeText(await readFile(path.resolve(a.file))));
if (KAPT_HEADER.some((h, i) => header[i]?.trim() !== h)) {
  console.error('헤더가 예상과 다릅니다 (파일 형식 변경?).');
  console.error('  예상:', KAPT_HEADER.join(', '));
  console.error('  실제:', header.join(', '));
  process.exit(1);
}
const parsed = body.filter((r) => r.length >= KAPT_HEADER.length).map(parseKaptRow);
const bad = parsed.filter((x) => !x).length;
const records = parsed.filter((x) => x && kinds.has(x.danjiKind));
console.log(`기준일 ${baseDate} · 전체 ${body.length}행 · 해석 실패 ${bad} · 적재 대상(단지종류 ${[...kinds].join(',')}) ${records.length}`);
console.table(records.slice(0, 5).map((r) => ({ id: r.danjiId, name: kaptName(r), sgg: r.sigunguCd, umd: r.umdNm, jibun: r.jibun, hhld: r.hhldCnt, apr: r.useAprDay })));
if (!a.apply) {
  console.log('\n미리보기만 했습니다. 맞으면 --apply 로 적재하세요.');
  process.exit(0);
}

if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env')); // 이미 있는 환경변수(--env-file)는 덮지 않음
const pool = await new sql.ConnectionPool({
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: true, trustServerCertificate: true, useUTC: false },
  requestTimeout: 300000,
}).connect();
console.log(`DB ${process.env.DB_NAME}`);

const cut = (s, n) => (s == null ? null : String(s).slice(0, n));
const tx = new sql.Transaction(pool);
await tx.begin();
try {
  const tmp = `#kapt_in_${Date.now().toString(36)}`;
  const t = new sql.Table(tmp);
  t.create = true;
  t.columns.add('danji_id', sql.Char(14), { nullable: false });
  t.columns.add('pnu', sql.Char(19), { nullable: false });
  t.columns.add('sigungu_cd', sql.Char(5), { nullable: false });
  t.columns.add('bjd_cd', sql.Char(10), { nullable: false });
  t.columns.add('umd_nm', sql.NVarChar(40), { nullable: false });
  t.columns.add('jibun', sql.NVarChar(30), { nullable: false });
  t.columns.add('addr', sql.NVarChar(200), { nullable: false });
  t.columns.add('nm_price', sql.NVarChar(100), { nullable: true });
  t.columns.add('nm_bld', sql.NVarChar(100), { nullable: true });
  t.columns.add('nm_road', sql.NVarChar(100), { nullable: true });
  t.columns.add('danji_kind', sql.TinyInt, { nullable: true });
  t.columns.add('dong_cnt', sql.Int, { nullable: true });
  t.columns.add('hhld_cnt', sql.Int, { nullable: true });
  t.columns.add('use_apr_day', sql.Date, { nullable: true });
  t.columns.add('road_addr', sql.NVarChar(200), { nullable: true });
  t.columns.add('sido_nm', sql.NVarChar(20), { nullable: false });
  t.columns.add('city_nm', sql.NVarChar(20), { nullable: true });
  t.columns.add('sgg_nm', sql.NVarChar(30), { nullable: false });
  for (const r of records) {
    t.rows.add(r.danjiId, r.pnu, r.sigunguCd, r.bjdCd, cut(r.umdNm, 40), cut(r.jibun, 30), cut(r.addr, 200), cut(r.nmPrice, 100), cut(r.nmBld, 100),
      cut(r.nmRoad, 100), r.danjiKind, r.dongCnt, r.hhldCnt, r.useAprDay, cut(r.roadAddr, 200), cut(r.sidoNm, 20), cut(r.cityNm, 20), cut(r.sggNm, 30));
  }
  await new sql.Request(tx).bulk(t);
  const res = await new sql.Request(tx).input('bd', sql.Date, baseDate).query(`
    DECLARE @out TABLE (act nvarchar(10));
    MERGE dbo.kapt_ref AS t USING ${tmp} AS s ON t.danji_id = s.danji_id
    WHEN MATCHED THEN UPDATE SET pnu = s.pnu, sigungu_cd = s.sigungu_cd, bjd_cd = s.bjd_cd, umd_nm = s.umd_nm, jibun = s.jibun, addr = s.addr,
         nm_price = s.nm_price, nm_bld = s.nm_bld, nm_road = s.nm_road, danji_kind = s.danji_kind, dong_cnt = s.dong_cnt, hhld_cnt = s.hhld_cnt,
         use_apr_day = s.use_apr_day, road_addr = s.road_addr, base_date = @bd, loaded_at = SYSDATETIME()
    WHEN NOT MATCHED THEN INSERT (danji_id, pnu, sigungu_cd, bjd_cd, umd_nm, jibun, addr, nm_price, nm_bld, nm_road, danji_kind, dong_cnt, hhld_cnt,
         use_apr_day, road_addr, base_date)
         VALUES (s.danji_id, s.pnu, s.sigungu_cd, s.bjd_cd, s.umd_nm, s.jibun, s.addr, s.nm_price, s.nm_bld, s.nm_road, s.danji_kind, s.dong_cnt,
         s.hhld_cnt, s.use_apr_day, s.road_addr, @bd)
    OUTPUT $action INTO @out;
    SELECT SUM(CASE WHEN act = 'INSERT' THEN 1 ELSE 0 END) AS inserted, SUM(CASE WHEN act = 'UPDATE' THEN 1 ELSE 0 END) AS updated FROM @out;

    INSERT dbo.region (sigungu_cd, sido_cd, sido_nm, sgg_nm, city_nm)
    SELECT s.sigungu_cd, LEFT(s.sigungu_cd, 2), MIN(s.sido_nm), MIN(s.sgg_nm), MIN(s.city_nm)
    FROM ${tmp} s WHERE NOT EXISTS (SELECT 1 FROM dbo.region r WHERE r.sigungu_cd = s.sigungu_cd)
    GROUP BY s.sigungu_cd;
    SELECT @@ROWCOUNT AS regions;`);
  await tx.commit();
  const [mr, rr] = res.recordsets;
  console.log(`적재 완료: 추가 ${mr[0].inserted ?? 0} · 갱신 ${mr[0].updated ?? 0} · 새 시군구 ${rr[0].regions}`);
} catch (err) {
  await tx.rollback().catch(() => {});
  console.error('적재 실패:', err.message);
  process.exitCode = 1;
} finally {
  await pool.close();
}
