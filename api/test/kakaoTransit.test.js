import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTransit, transitRoute } from '../src/external/kakaoTransit.js';

// 카카오맵 REST 문서의 대중교통 경로 응답 형식 (필드명 문서 기준, 값은 시험용)
const doc = {
  status: 'OK',
  properties: { total: 2, bus: 1, subway: 1, busAndSubway: 0 },
  routes: [
    {
      properties: { type: 'BUS', totalDistance: 9000, totalTime: 2700, transfers: 1, fare: { value: 1500 } },
      steps: [{ properties: { type: 'BUS', guidance: '마을 76 (판교역동편 > 성남시청전면)', distance: 4127, time: 1158 } }],
    },
    {
      properties: { type: 'SUBWAY', totalDistance: 12000, totalTime: 1830, transfers: 0, fare: { value: 1750 } },
      steps: [
        { properties: { type: 'WALKING', guidance: null, distance: 300, time: 240 } },
        { properties: { type: 'SUBWAY', guidance: '신분당선 (동천역 > 강남역)', distance: 11500, time: 1350, stops: [{ name: '동천역' }], vehicles: [{ type: '일반', name: '신분당선' }] } },
        { properties: { type: 'WALKING', distance: 200, time: 240 } },
      ],
    },
  ],
};

test('가장 빠른 경로를 분·환승·도보·경로 설명으로', () => {
  assert.deepEqual(parseTransit(doc), {
    minutes: 31,
    transfers: 0,
    walkMinutes: 8,
    routeDesc: '지하철 신분당선 (동천역 > 강남역) → 도보 합계 8분',
  });
});

test('경로 없음·형식 변경', () => {
  assert.throws(() => parseTransit({ status: 'STARTNODES_NULL' }), (e) => e.code === 'EXTERNAL_NO_ROUTE' && /출발지/.test(e.message));
  assert.throws(() => parseTransit({ routes: [] }), (e) => e.code === 'EXTERNAL_SCHEMA');
});

test('요청: 쿼터 가드 KAKAO_TRANSIT, 경도=x 위도=y, KakaoAK 헤더', async () => {
  let got;
  const call = async (o) => ((got = o), doc);
  await transitRoute({ pool: {}, restKey: 'k', from: { lat: 37.1, lng: 127.1 }, to: { lat: 37.5, lng: 127.02 }, call });
  assert.equal(got.apiCd, 'KAKAO_TRANSIT');
  assert.match(got.url, /start_x=127\.1&start_y=37\.1&end_x=127\.02&end_y=37\.5/);
  assert.equal(got.headers.Authorization, 'KakaoAK k');
  await assert.rejects(transitRoute({ pool: {}, restKey: null, from: {}, to: {}, call }), (e) => e.code === 'CONFIG');
});
