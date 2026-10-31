// 외부 API 실제 응답 확인 (계획서 §12 U1~U3) — 키 발급 후 사용자가 1회 실행
//
//   node scripts/probe-api.js --lawd 11620 --ym 202608 [--kapt A10027875] [--bjd 1162010100 --bun 0123 --ji 0000]
//
// 각 API를 1회씩 호출해 원문을 docs/api-samples/ 에 저장 (serviceKey 가림).
// 저장된 원문을 보고 api/src/external/*.js 의 zod 스키마·필드명을 확정한다.
// ※ 쿼터 테이블을 거치지 않는 진단용 — API당 1회만 호출한다.
// ※ "후보" 엔드포인트는 계획서상 미확인(U1·U3) — 실패하면 활용신청 페이지의 Swagger에서 실제 주소 확인.
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const key = process.env.DATA_GO_KR_KEY;
if (!key) {
  console.error('.env 에 DATA_GO_KR_KEY 가 없습니다');
  process.exit(1);
}

const { values: a } = parseArgs({
  options: {
    lawd: { type: 'string', default: '11620' },
    ym: { type: 'string', default: '202608' },
    kapt: { type: 'string' },
    bjd: { type: 'string' }, // 법정동코드 10자리 (시군구5 + 법정동5)
    bun: { type: 'string' },
    ji: { type: 'string', default: '0000' },
  },
});

const base = 'https://apis.data.go.kr/1613000';
const probes = [
  {
    name: 'rtms_trade',
    url: `${base}/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev`,
    params: { LAWD_CD: a.lawd, DEAL_YMD: a.ym, pageNo: 1, numOfRows: 10 },
  },
  {
    name: 'rtms_rent (후보 U3)',
    url: `${base}/RTMSDataSvcAptRent/getRTMSDataSvcAptRent`,
    params: { LAWD_CD: a.lawd, DEAL_YMD: a.ym, pageNo: 1, numOfRows: 10 },
  },
  {
    name: 'kapt_list (후보 U1)',
    url: `${base}/AptListService3/getSigunguAptList3`,
    params: { sigunguCode: a.lawd, pageNo: 1, numOfRows: 10, _type: 'json' },
  },
  a.kapt && {
    name: 'kapt_basis',
    url: `${base}/AptBasisInfoServiceV4/getAphusBassInfoV4`,
    params: { kaptCode: a.kapt, _type: 'json' },
  },
  a.kapt && {
    name: 'kapt_detail',
    url: `${base}/AptBasisInfoServiceV4/getAphusDtlInfoV4`,
    params: { kaptCode: a.kapt, _type: 'json' },
  },
  a.bjd && a.bun && {
    name: 'bld_title',
    url: `${base}/BldRgstHubService/getBrTitleInfo`,
    params: { sigunguCd: a.bjd.slice(0, 5), bjdongCd: a.bjd.slice(5), bun: a.bun, ji: a.ji, numOfRows: 10, pageNo: 1, _type: 'json' },
  },
  a.bjd && a.bun && {
    name: 'bld_recap',
    url: `${base}/BldRgstHubService/getBrRecapTitleInfo`,
    params: { sigunguCd: a.bjd.slice(0, 5), bjdongCd: a.bjd.slice(5), bun: a.bun, ji: a.ji, numOfRows: 10, pageNo: 1, _type: 'json' },
  },
].filter(Boolean);

const outDir = path.join(root, 'docs', 'api-samples');
await mkdir(outDir, { recursive: true });

for (const p of probes) {
  // 공공데이터포털 키는 이미 인코딩된 값과 디코딩 값 두 가지가 있다 → 인코딩 키면 그대로 붙인다
  const qs = new URLSearchParams(Object.entries(p.params).map(([k, v]) => [k, String(v)])).toString();
  const keyPart = key.includes('%') ? key : encodeURIComponent(key);
  const url = `${p.url}?serviceKey=${keyPart}&${qs}`;
  const file = p.name.split(' ')[0];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    const type = res.headers.get('content-type') ?? '';
    const ext = type.includes('json') || /^\s*[{[]/.test(text) ? 'json' : 'xml';
    await writeFile(path.join(outDir, `${file}.${ext}`), text.split(key).join('***'));
    console.log(`${res.status} ${p.name} → docs/api-samples/${file}.${ext} (${text.length}B)`);
  } catch (err) {
    console.log(`실패 ${p.name}: ${err.message}`);
  }
}
console.log('\n원문 확인 후 계획서 §12 U1~U3 갱신, external/*.js 스키마 확정');
