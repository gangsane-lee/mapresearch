// 국토교통부 전국 도시정비사업 통합 데이터(CSV, 연 1회) → redev_ref 적재 (계획서 §5.5)
//
//   node scripts/import-redev.js --file <내려받은 CSV> --year 2026          (미리보기: 헤더 매핑 + 5행)
//   node scripts/import-redev.js --file <CSV> --year 2026 --apply           (적재)
//
// - 헤더 이름은 아직 실제 파일로 확인 전이라(§12) 키워드로 대응시키고, 미리보기에서 사람이 확인한 뒤 --apply.
// - 같은 기준연도가 이미 있으면 적재하지 않는다 (삭제 없이 이력 보존). 단지 연결은 화면에서 수동.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sql from 'mssql';
import { decodeText, parseCsv, mapHeader } from '../shared/csv.js';

const RULES = {
  sido_nm: ['시도'],
  sgg_nm: ['시군구'],
  zone_nm: ['구역명칭', '구역명', '사업장명', '정비구역'],
  stage: ['추진단계', '진행단계', '단계'],
  biz_type: ['사업유형', '사업구분', '정비유형'],
  operator_nm: ['시행자', '조합명', '사업시행자'],
  supply_hhld: ['공급예정세대', '건립세대', '세대수'],
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: a } = parseArgs({ options: { file: { type: 'string' }, year: { type: 'string' }, apply: { type: 'boolean', default: false } } });
if (!a.file || !/^\d{4}$/.test(a.year ?? '')) {
  console.error('사용: node scripts/import-redev.js --file <CSV> --year YYYY [--apply]');
  process.exit(1);
}

const rows = parseCsv(decodeText(await readFile(path.resolve(a.file))));
const [header, ...body] = rows;
const { map, unmapped } = mapHeader(header, RULES);
console.log('헤더 매핑:');
for (const [t, i] of Object.entries(map)) console.log(`  ${t.padEnd(12)} ← ${header[i]}`);
if (unmapped.length) console.log(`  (미사용 헤더: ${unmapped.join(', ')})`);
const missing = ['sido_nm', 'sgg_nm', 'zone_nm'].filter((t) => !(t in map));
if (missing.length) {
  console.error(`필수 컬럼을 찾지 못했습니다: ${missing.join(', ')} — RULES 키워드를 실제 헤더에 맞게 고치세요.`);
  process.exit(1);
}

const pick = (r, t) => (t in map ? r[map[t]] || null : null);
const records = body.map((r) => ({
  sido_nm: pick(r, 'sido_nm'),
  sgg_nm: pick(r, 'sgg_nm'),
  zone_nm: pick(r, 'zone_nm'),
  stage: pick(r, 'stage'),
  biz_type: pick(r, 'biz_type'),
  operator_nm: pick(r, 'operator_nm'),
  supply_hhld: (() => {
    const n = Number(String(pick(r, 'supply_hhld') ?? '').replace(/[,\s]/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  })(),
})).filter((x) => x.zone_nm && x.sido_nm && x.sgg_nm);

console.log(`\n유효 행 ${records.length} / 전체 ${body.length}`);
console.table(records.slice(0, 5));
if (!a.apply) {
  console.log('\n미리보기만 했습니다. 매핑이 맞으면 --apply 로 적재하세요.');
  process.exit(0);
}

if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const pool = await new sql.ConnectionPool({
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: true, trustServerCertificate: true, useUTC: false },
}).connect();
try {
  const exist = await pool.request().input('y', sql.SmallInt, Number(a.year)).query('SELECT COUNT(*) AS n FROM dbo.redev_ref WHERE base_year = @y');
  if (exist.recordset[0].n > 0) {
    console.error(`${a.year}년 데이터가 이미 ${exist.recordset[0].n}건 있습니다. 적재하지 않습니다.`);
    process.exitCode = 1;
  } else {
    const t = new sql.Table('dbo.redev_ref');
    t.columns.add('base_year', sql.SmallInt, { nullable: false });
    t.columns.add('sido_nm', sql.NVarChar(20), { nullable: false });
    t.columns.add('sgg_nm', sql.NVarChar(30), { nullable: false });
    t.columns.add('zone_nm', sql.NVarChar(200), { nullable: false });
    t.columns.add('stage', sql.NVarChar(50), { nullable: true });
    t.columns.add('biz_type', sql.NVarChar(50), { nullable: true });
    t.columns.add('operator_nm', sql.NVarChar(200), { nullable: true });
    t.columns.add('supply_hhld', sql.Int, { nullable: true });
    const cut = (s, n) => (s == null ? null : String(s).slice(0, n));
    for (const r of records) {
      t.rows.add(Number(a.year), cut(r.sido_nm, 20), cut(r.sgg_nm, 30), cut(r.zone_nm, 200), cut(r.stage, 50), cut(r.biz_type, 50), cut(r.operator_nm, 200), r.supply_hhld);
    }
    await pool.request().bulk(t);
    console.log(`적재 완료: ${records.length}건 (${a.year}년)`);
  }
} finally {
  await pool.close();
}
