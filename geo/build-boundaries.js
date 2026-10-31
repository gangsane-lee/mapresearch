// 시군구 경계 GeoJSON 빌드 (계획서 §2.3, P0 완료 기준: 수도권 합계 2MB 이하)
//
//   node geo/build-boundaries.js --input geo/raw/HangJeongDong_ver20260701.geojson [--sido 11,28,41] [--simplify 8%]
//
// 입력: vuski/admdongkor 행정동 GeoJSON (직접 내려받아 geo/raw/ 에 둔다 — 커밋하지 않음)
// 출력:
//   web/public/geo/sigungu/{code}.json   구 단위 경계 (Feature)
//   web/public/geo/city/{시명}.json      일반구를 합친 시 경계 (브라우저에서 union 계산 금지)
//   web/public/geo/index.json            검색·fitBounds용 목록 + bbox
//   db/seed/040_region.sql               region 테이블 seed
import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import mapshaper from 'mapshaper';
import { splitCityName, bboxOf, regionSeedSql } from './lib.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({
  options: {
    input: { type: 'string', default: path.join('geo', 'raw', 'HangJeongDong_ver20260701.geojson') },
    sido: { type: 'string', default: '11,28,41' }, // 서울·인천·경기
    simplify: { type: 'string', default: '8%' },
    'out-root': { type: 'string' }, // 테스트용 출력 루트 (기본: 리포 루트)
  },
});

const sidoList = args.sido.split(',').map((s) => s.trim());
const outRoot = args['out-root'] ? path.resolve(args['out-root']) : root;
const outDir = path.join(outRoot, 'web', 'public', 'geo');

const raw = await readFile(path.resolve(root, args.input), 'utf8');
console.log(`입력 ${args.input} (${(raw.length / 1e6).toFixed(1)}MB)`);

// 1) 행정동 → 시군구 dissolve (bbox는 단순화 전 경계로 계산 — 단순화하면 모서리가 깎여 bbox가 줄어든다)
const filter = `${JSON.stringify(sidoList)}.includes(String(sido))`;
const dissolved = (
  await mapshaper.applyCommands(
    `-i in.json -filter '${filter}' -dissolve sgg copy-fields=sido,sidonm,sggnm -o out.json format=geojson`,
    { 'in.json': raw },
  )
)['out.json'];
const fullFc = JSON.parse(dissolved);

// 2) 토폴로지 보존 단순화 (인접 구 사이 틈 방지)
const simplify = async (geojson) =>
  JSON.parse(
    (
      await mapshaper.applyCommands(
        `-i in.json -simplify ${args.simplify} weighted keep-shapes -o out.json format=geojson precision=0.00001`,
        { 'in.json': geojson },
      )
    )['out.json'],
  );
const sggFc = await simplify(dissolved);
const simplifiedByCode = new Map(sggFc.features.map((f) => [String(f.properties.sgg), f.geometry]));

const rows = fullFc.features.map((f) => {
  const p = f.properties;
  const code = String(p.sgg);
  const { cityNm, sggNm } = splitCityName(String(p.sggnm));
  return { code, sidoCd: String(p.sido), sidoNm: p.sidonm, sggNm, cityNm, bbox: bboxOf(f.geometry), geometry: simplifiedByCode.get(code) };
});

// 3) 일반구가 있는 시는 시 단위로 한 번 더 dissolve (단순화 전 경계 기준)
const cityFeatures = fullFc.features
  .map((f, i) => ({ ...f, properties: { city: rows[i].cityNm } }))
  .filter((f) => f.properties.city);
let cityFull = { features: [] };
let citySimplified = new Map();
if (cityFeatures.length) {
  const cityDissolved = (
    await mapshaper.applyCommands('-i in.json -dissolve city -o out.json format=geojson', {
      'in.json': JSON.stringify({ type: 'FeatureCollection', features: cityFeatures }),
    })
  )['out.json'];
  cityFull = JSON.parse(cityDissolved);
  citySimplified = new Map((await simplify(cityDissolved)).features.map((f) => [f.properties.city, f.geometry]));
}

// 3) 출력
await rm(outDir, { recursive: true, force: true });
await mkdir(path.join(outDir, 'sigungu'), { recursive: true });
await mkdir(path.join(outDir, 'city'), { recursive: true });

for (const r of rows) {
  const feature = { type: 'Feature', properties: { code: r.code, name: r.sggNm }, bbox: r.bbox, geometry: r.geometry };
  await writeFile(path.join(outDir, 'sigungu', `${r.code}.json`), JSON.stringify(feature));
}
const cities = [];
for (const f of cityFull.features) {
  const name = f.properties.city;
  const bbox = bboxOf(f.geometry);
  const codes = rows.filter((r) => r.cityNm === name).map((r) => r.code).sort();
  cities.push({ name, codes, bbox });
  await writeFile(
    path.join(outDir, 'city', `${name}.json`),
    JSON.stringify({ type: 'Feature', properties: { name, codes }, bbox, geometry: citySimplified.get(name) }),
  );
}

rows.sort((a, b) => a.code.localeCompare(b.code));
const index = {
  source: path.basename(args.input),
  builtAt: new Date().toISOString(),
  sigungu: rows.map(({ code, sidoCd, sidoNm, sggNm, cityNm, bbox }) => ({ code, sidoCd, sidoNm, sggNm, cityNm, bbox })),
  cities,
};
await writeFile(path.join(outDir, 'index.json'), JSON.stringify(index));
await mkdir(path.join(outRoot, 'db', 'seed'), { recursive: true });
await writeFile(path.join(outRoot, 'db', 'seed', '040_region.sql'), regionSeedSql(rows));

// 4) 크기 점검
let total = 0;
for (const r of rows) total += (await stat(path.join(outDir, 'sigungu', `${r.code}.json`))).size;
const mb = total / 1024 / 1024;
console.log(`시군구 ${rows.length}개, 시 ${cities.length}개, 구 경계 합계 ${mb.toFixed(2)}MB`);
if (mb > 2) {
  console.error('완료 기준 초과(2MB): --simplify 값을 낮추세요 (예: 5%)');
  process.exitCode = 1;
}
