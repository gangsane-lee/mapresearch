// 네이버 Maps Reverse Geocoding — 지도 우클릭 위치 → 법정동코드·지번 (단지 등록 경로에서만 호출)
//
// 엔드포인트: https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc (신규 Maps 도메인, 2026-11-01 실호출 확인)
// 헤더: x-ncp-apigw-api-key-id / x-ncp-apigw-api-key (Client Secret — 서버에서만)
// 필드명은 docs/api-samples/ncp_rgeocode.json (관악구 봉천동) 실제 응답으로 고정.
//   results[name=addr].code.id = 법정동코드 10자리, land.type 1=일반 2=산, number1/number2 = 본번/부번
//   results[name=roadaddr].land.addition0 {type:'building', value} = 건물명 (없을 수 있음)
// status.code 0 = 정상, 3 = 결과 없음(바다 등).
import { z } from 'zod';
import { callExternal } from './http.js';
import { AppError } from '../util/errors.js';

export const RGEOCODE = { apiCd: 'NCP_RGEOCODE', url: 'https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc' };

const name = z.looseObject({ name: z.string().default('') });
const addition = z.looseObject({ type: z.string().default(''), value: z.string().default('') });
const result = z.looseObject({
  name: z.string(),
  code: z.looseObject({ id: z.string() }),
  region: z.looseObject({ area1: name, area2: name, area3: name, area4: name.optional() }),
  land: z
    .looseObject({
      type: z.string().default(''),
      name: z.string().optional(),
      number1: z.string().default(''),
      number2: z.string().default(''),
      addition0: addition.optional(),
    })
    .optional(),
});
const response = z.looseObject({
  status: z.looseObject({ code: z.number(), message: z.string().optional() }),
  results: z.array(result).default([]),
});

const lot = (land) => (land?.number1 ? `${land.number1}${land.number2 && land.number2 !== '0' ? `-${land.number2}` : ''}` : null);

/**
 * 응답 → { bjdCd, sigunguCd, sidoNm, sggNm, umdNm, jibun, jibunAddr, roadAddr, roadKey, buildingNm } | null(결과 없음)
 */
export function parseRgeocode(json) {
  const r = response.safeParse(json);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new AppError('EXTERNAL_SCHEMA', `역지오코딩 응답 형식이 바뀌었습니다: ${i.path.join('.')} ${i.message}`, 502);
  }
  const { status, results } = r.data;
  if (status.code === 3) return null;
  if (status.code !== 0) throw new AppError('EXTERNAL_API', `역지오코딩 오류 ${status.code} ${status.message ?? ''}`.trim(), 502);
  const addr = results.find((x) => x.name === 'addr') ?? results.find((x) => x.name === 'legalcode');
  if (!addr || !/^\d{10}$/.test(addr.code.id)) return null;
  const road = results.find((x) => x.name === 'roadaddr');
  const g = addr.region;
  const umdNm = [g.area3.name, g.area4?.name].filter(Boolean).join(' ');
  const n = lot(addr.land);
  const jibun = n ? `${addr.land.type === '2' ? '산' : ''}${n}` : null;
  const roadLot = lot(road?.land);
  const building = road?.land?.addition0?.type === 'building' ? road.land.addition0.value || null : null;
  return {
    bjdCd: addr.code.id,
    sigunguCd: addr.code.id.slice(0, 5),
    sidoNm: g.area1.name,
    sggNm: g.area2.name,
    umdNm,
    jibun,
    jibunAddr: [g.area1.name, g.area2.name, umdNm, jibun].filter(Boolean).join(' '),
    roadAddr: road?.land?.name && roadLot ? [road.region.area1.name, road.region.area2.name, road.land.name, roadLot].join(' ') : null,
    // kapt_ref.road_addr 와 같은 형식 ("동탄순환대로21길 54") — 행정구역 코드가 바뀌어도 도로명주소로 단지를 찾는다
    roadKey: road?.land?.name && roadLot ? `${road.land.name} ${roadLot}` : null,
    buildingNm: building,
  };
}

export async function reverseGeocode({ pool, keyId, secret, lat, lng, call = callExternal }) {
  if (!keyId || !secret) throw new AppError('CONFIG', '.env 에 NCP_KEY_ID / NCP_CLIENT_SECRET 이 없습니다', 503);
  const url = `${RGEOCODE.url}?coords=${lng},${lat}&orders=addr,roadaddr&output=json`;
  const json = await call({
    pool,
    apiCd: RGEOCODE.apiCd,
    job: 'ncp_rgeocode',
    url,
    headers: { 'x-ncp-apigw-api-key-id': keyId, 'x-ncp-apigw-api-key': secret },
    parse: (t) => JSON.parse(t),
  });
  return parseRgeocode(json);
}

// ── 주소 → 좌표 (Geocoding) — 설정의 기준점(집·직장) 좌표 찾기에서만 호출, 결과는 제안값 ──
// 엔드포인트: https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query= (2026-11-01 실호출, docs/api-samples/ncp_geocode.json)
//   addresses[].roadAddress / jibunAddress / x(경도) / y(위도) — 문자열
export const GEOCODE = { apiCd: 'NCP_GEOCODE', url: 'https://maps.apigw.ntruss.com/map-geocode/v2/geocode' };

const geoResponse = z.looseObject({
  status: z.string(),
  errorMessage: z.string().optional(),
  addresses: z.array(z.looseObject({ roadAddress: z.string().default(''), jibunAddress: z.string().default(''), x: z.string(), y: z.string() })).default([]),
});

/** 응답 → [{ roadAddress, jibunAddress, lat, lng }] (최대 5개) */
export function parseGeocode(json) {
  const r = geoResponse.safeParse(json);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new AppError('EXTERNAL_SCHEMA', `지오코딩 응답 형식이 바뀌었습니다: ${i.path.join('.')} ${i.message}`, 502);
  }
  if (r.data.status !== 'OK') throw new AppError('EXTERNAL_API', `지오코딩 오류 ${r.data.status} ${r.data.errorMessage ?? ''}`.trim(), 502);
  return r.data.addresses.slice(0, 5).map((a) => ({
    roadAddress: a.roadAddress || null,
    jibunAddress: a.jibunAddress || null,
    lat: Math.round(Number(a.y) * 1e6) / 1e6,
    lng: Math.round(Number(a.x) * 1e6) / 1e6,
  }));
}

export async function geocode({ pool, keyId, secret, query, call = callExternal }) {
  if (!keyId || !secret) throw new AppError('CONFIG', '.env 에 NCP_KEY_ID / NCP_CLIENT_SECRET 이 없습니다', 503);
  const json = await call({
    pool,
    apiCd: GEOCODE.apiCd,
    job: 'ncp_geocode',
    url: `${GEOCODE.url}?query=${encodeURIComponent(query)}`,
    headers: { 'x-ncp-apigw-api-key-id': keyId, 'x-ncp-apigw-api-key': secret },
    parse: (t) => JSON.parse(t),
  });
  return parseGeocode(json);
}
