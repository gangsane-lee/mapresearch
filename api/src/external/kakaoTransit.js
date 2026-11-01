// 카카오맵 REST — 대중교통 경로 조회 (스냅샷 입력에서 "자동 계산"을 누를 때만 호출, 결과는 제안값)
//
// 문서: https://developers.kakao.com/docs/ko/kakaomap/rest-api  "경로 조회 > 대중교통 경로 조회" (2026-11-01 확인)
//   GET https://dapi.kakao.com/v2/routing/publictraffic?start_x=경도&start_y=위도&end_x=경도&end_y=위도
//   헤더 Authorization: KakaoAK {REST_API_KEY}
//   응답 status: OK | STARTNODES_NULL | ENDNODES_NULL | EQUAL_POINTS | INVALID_REQUEST | NO_RESULTS
//   routes[].properties: type(BUS|SUBWAY|BUS_AND_SUBWAY), totalDistance(m), totalTime(초), transfers, fare
//   routes[].steps[].properties: guidance, type(BUS|SUBWAY|WALKING), distance(m), time(초), stops[{name}], vehicles[{type,name}]
//   출발 시각 파라미터는 문서에 없다(조회 시점 기준). 무료 일 1,000건, 초과 10원/건 → 쿼터 가드 KAKAO_TRANSIT.
// 2026-11-01 실호출로 필드 일치 확인 — 샘플 docs/api-samples/kakao_transit.json (계획서 §12 U21).
import { z } from 'zod';
import { callExternal } from './http.js';
import { AppError } from '../util/errors.js';

export const TRANSIT = { apiCd: 'KAKAO_TRANSIT', url: 'https://dapi.kakao.com/v2/routing/publictraffic' };

const step = z.looseObject({
  properties: z.looseObject({
    guidance: z.string().nullish(),
    type: z.string(),
    distance: z.number().nullish(),
    time: z.number().nullish(),
  }),
});
const route = z.looseObject({
  properties: z.looseObject({
    type: z.string().nullish(),
    totalDistance: z.number().nullish(),
    totalTime: z.number(),
    transfers: z.number().nullish(),
  }),
  steps: z.array(step).default([]),
});
const response = z.looseObject({
  status: z.string(),
  routes: z.array(route).default([]),
});

const STATUS_MSG = {
  STARTNODES_NULL: '출발지 근처에 정류장·역이 없습니다',
  ENDNODES_NULL: '기준점 근처에 정류장·역이 없습니다',
  EQUAL_POINTS: '출발지와 기준점이 같습니다',
  NO_RESULTS: '대중교통 경로가 없습니다',
  INVALID_REQUEST: '요청 형식 오류',
};

/**
 * 응답 → 가장 빠른 경로 { minutes, transfers, walkMinutes, routeDesc } (분은 반올림)
 * routeDesc 예: "지하철 신분당선 (동천역 > 강남역) → 도보 4분"
 */
export function parseTransit(json) {
  const r = response.safeParse(json);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new AppError('EXTERNAL_SCHEMA', `대중교통 응답 형식이 바뀌었습니다: ${i.path.join('.')} ${i.message}`, 502);
  }
  const { status, routes } = r.data;
  if (status !== 'OK') throw new AppError('EXTERNAL_NO_ROUTE', STATUS_MSG[status] ?? `대중교통 경로 조회 실패 (${status})`, 422);
  if (!routes.length) throw new AppError('EXTERNAL_NO_ROUTE', STATUS_MSG.NO_RESULTS, 422);
  const best = routes.reduce((a, b) => (b.properties.totalTime < a.properties.totalTime ? b : a));
  const walkSec = best.steps.filter((s) => s.properties.type === 'WALKING').reduce((n, s) => n + (s.properties.time ?? 0), 0);
  const legs = best.steps
    .filter((s) => s.properties.type !== 'WALKING' && s.properties.guidance)
    .map((s) => `${s.properties.type === 'SUBWAY' ? '지하철' : '버스'} ${s.properties.guidance}`);
  const walkMinutes = Math.round(walkSec / 60);
  return {
    minutes: Math.max(1, Math.round(best.properties.totalTime / 60)),
    transfers: best.properties.transfers ?? Math.max(0, legs.length - 1),
    walkMinutes,
    routeDesc: [...legs, walkMinutes ? `도보 합계 ${walkMinutes}분` : null].filter(Boolean).join(' → ').slice(0, 300),
  };
}

export async function transitRoute({ pool, restKey, from, to, complexId = null, call = callExternal }) {
  if (!restKey) throw new AppError('CONFIG', '.env 에 KAKAO_REST_KEY 가 없습니다 (카카오 개발자 콘솔 REST API 키, 카카오맵 사용 설정)', 503);
  const qs = new URLSearchParams({ start_x: String(from.lng), start_y: String(from.lat), end_x: String(to.lng), end_y: String(to.lat) });
  const json = await call({
    pool,
    apiCd: TRANSIT.apiCd,
    job: 'kakao_transit',
    complexId,
    url: `${TRANSIT.url}?${qs}`,
    headers: { Authorization: `KakaoAK ${restKey}` },
    parse: (t) => JSON.parse(t),
  });
  return parseTransit(json);
}
