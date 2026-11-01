import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRgeocode, reverseGeocode } from '../src/external/ncpGeocode.js';

const sample = (f) => JSON.parse(readFileSync(new URL(`../../docs/api-samples/${f}.json`, import.meta.url), 'utf8'));

test('역지오코딩 실제 응답 → 법정동코드·지번', () => {
  assert.deepEqual(parseRgeocode(sample('ncp_rgeocode')), {
    bjdCd: '1162010100',
    sigunguCd: '11620',
    sidoNm: '서울특별시',
    sggNm: '관악구',
    umdNm: '봉천동',
    jibun: '1530-14',
    jibunAddr: '서울특별시 관악구 봉천동 1530-14',
    roadAddr: null,
    buildingNm: null,
  });
  assert.equal(parseRgeocode(sample('ncp_rgeocode_road')).jibun, '34', '부번 없으면 본번만');
});

test('산 지번·도로명·건물명', () => {
  const s = sample('ncp_rgeocode');
  const addr = s.results.find((r) => r.name === 'addr');
  const j = structuredClone(s);
  j.results = [
    { ...addr, land: { ...addr.land, type: '2', number1: '12', number2: '' } },
    { name: 'roadaddr', code: addr.code, region: addr.region, land: { type: '', name: '관악로', number1: '1', number2: '', addition0: { type: 'building', value: '관악드림타운' } } },
  ];
  const p = parseRgeocode(j);
  assert.equal(p.jibun, '산12');
  assert.equal(p.roadAddr, '서울특별시 관악구 관악로 1');
  assert.equal(p.buildingNm, '관악드림타운');
});

test('결과 없음(바다)은 null, 형식 변경은 EXTERNAL_SCHEMA', () => {
  assert.equal(parseRgeocode({ status: { code: 3, name: 'no results' }, results: [] }), null);
  assert.throws(() => parseRgeocode({ results: [] }), (e) => e.code === 'EXTERNAL_SCHEMA');
});

test('키 없으면 CONFIG, 호출은 쿼터 키 NCP_RGEOCODE·헤더로', async () => {
  await assert.rejects(reverseGeocode({ lat: 37, lng: 127 }), (e) => e.code === 'CONFIG');
  let seen;
  const call = async (o) => ((seen = o), sample('ncp_rgeocode'));
  const p = await reverseGeocode({ pool: {}, keyId: 'id', secret: 'sec', lat: 37.4807, lng: 126.9402, call });
  assert.equal(p.jibun, '1530-14');
  assert.equal(seen.apiCd, 'NCP_RGEOCODE');
  assert.match(seen.url, /coords=126\.9402,37\.4807/);
  assert.deepEqual(seen.headers, { 'x-ncp-apigw-api-key-id': 'id', 'x-ncp-apigw-api-key': 'sec' });
});
