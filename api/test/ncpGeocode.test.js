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
    roadKey: null,
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
  assert.equal(p.roadKey, '관악로 1', '단지 식별정보 road_addr 형식');
});

test('행정구역 개편 지역(화성시 동탄구) 실제 응답 → 새 법정동코드 + 도로명 키', () => {
  const p = parseRgeocode(sample('ncp_rgeocode_dongtan'));
  assert.equal(p.bjdCd, '4159710500', '네이버는 새 동탄구 코드 (단지 식별정보는 옛 4159013000)');
  assert.equal(p.umdNm, '청계동');
  assert.equal(p.jibun, '538');
  assert.equal(p.roadKey, '동탄순환대로21길 54');
  assert.equal(p.buildingNm, '동탄역 센트럴 푸르지오');
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

test('지오코딩 실제 응답 → 좌표 후보', async () => {
  const { parseGeocode, geocode } = await import('../src/external/ncpGeocode.js');
  assert.deepEqual(parseGeocode(sample('ncp_geocode')), [
    {
      roadAddress: '경기도 화성시 동탄구 동탄순환대로21길 54 동탄역 센트럴 푸르지오',
      jibunAddress: '경기도 화성시 동탄구 청계동 538 동탄역 센트럴 푸르지오',
      lat: 37.197453,
      lng: 127.114219,
    },
  ]);
  let got;
  await geocode({ pool: {}, keyId: 'a', secret: 'b', query: '강남역', call: async (o) => ((got = o), sample('ncp_geocode')) });
  assert.equal(got.apiCd, 'NCP_GEOCODE', '쿼터 가드');
  assert.match(got.url, /query=%EA%B0%95%EB%82%A8%EC%97%AD$/);
});
