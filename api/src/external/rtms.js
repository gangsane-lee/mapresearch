// 국토교통부 아파트 매매·전월세 실거래 (계획서 §5.5, U3 해결 2026-11-01)
//
// 엔드포인트(활용신청 화면으로 확인):
//   매매   https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade
//   전월세 https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent
// 요청: serviceKey, LAWD_CD(시군구 5), DEAL_YMD(yyyyMM), pageNo, numOfRows. 응답 XML.
// 필드명은 docs/api-samples/rtms_{trade,rent}.xml (2026-09 관악구) 실제 응답으로 고정.
// 매매 응답에는 aptSeq 가 없다 → 단지 연결은 법정동코드 + 지번.
import { z } from 'zod';
import { callExternal, parseDataGoKr } from './http.js';
import { parseDealAmount } from '../util/unit.js';
import { AppError } from '../util/errors.js';

const BASE = 'https://apis.data.go.kr/1613000';
export const RTMS = {
  SALE: { apiCd: 'DATA_GO_KR_RTMS', url: `${BASE}/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade` },
  RENT: { apiCd: 'DATA_GO_KR_RENT', url: `${BASE}/RTMSDataSvcAptRent/getRTMSDataSvcAptRent` },
};

const s = z.string().default('');
const common = {
  aptNm: s,
  sggCd: z.string().regex(/^\d{5}$/),
  umdNm: s,
  jibun: s,
  dealYear: z.string().regex(/^\d{4}$/),
  dealMonth: z.string().regex(/^\d{1,2}$/),
  dealDay: z.string().regex(/^\d{1,2}$/),
  excluUseAr: z.string().regex(/^\d+(\.\d+)?$/),
  floor: s,
};
export const saleItem = z.looseObject({
  ...common,
  aptDong: s,
  dealAmount: z.string().min(1),
  cdealType: s, // 해제여부 (해제 시 값 있음)
  cdealDay: s, //  해제사유발생일 — 형식은 U18 — parseCancelDay 가 모르는 형식이면 null
  dealingGbn: s,
});
export const rentItem = z.looseObject({
  ...common,
  aptSeq: s,
  deposit: z.string().min(1),
  monthlyRent: s,
  contractType: s,
  contractTerm: s,
});

const pad2 = (v) => String(v).padStart(2, '0');
const dealDate = (i) => `${i.dealYear}-${pad2(i.dealMonth)}-${pad2(i.dealDay)}`;
const floorOf = (v) => (/^-?\d+$/.test(v) ? Number(v) : null);
const blank = (v) => (v === '' ? null : v);

/** 'yy.MM.dd' 또는 'yyyyMMdd' / 'yyyy-MM-dd' → 'yyyy-MM-dd', 그 외 null */
export function parseCancelDay(v) {
  let m = /^(\d{2})\.(\d{1,2})\.(\d{1,2})$/.exec(v ?? '');
  if (m) return `20${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(v ?? '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function validate(schema, raw, kind) {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new AppError('EXTERNAL_SCHEMA', `${kind} 응답 형식이 바뀌었습니다: ${i.path.join('.')} ${i.message}`, 502);
  }
  return r.data;
}

/** 매매 item → trade 행 후보 (bjdCd 는 호출 측에서 umdNm 으로 채운다) */
export function normalizeSale(raw) {
  const i = validate(saleItem, raw, '매매');
  return {
    sigunguCd: i.sggCd,
    umdNm: i.umdNm,
    jibun: blank(i.jibun),
    aptNm: blank(i.aptNm),
    aptSeq: null,
    dealDate: dealDate(i),
    exclM2: Number(i.excluUseAr),
    floor: floorOf(i.floor),
    dong: blank(i.aptDong),
    amountMan: parseDealAmount(i.dealAmount),
    canceled: i.cdealType !== '',
    cancelDate: parseCancelDay(i.cdealDay),
    dealType: blank(i.dealingGbn),
  };
}

/** 전월세 item → trade_rent 행 후보 */
export function normalizeRent(raw) {
  const i = validate(rentItem, raw, '전월세');
  return {
    sigunguCd: i.sggCd,
    umdNm: i.umdNm,
    jibun: blank(i.jibun),
    aptNm: blank(i.aptNm),
    aptSeq: blank(i.aptSeq),
    dealDate: dealDate(i),
    exclM2: Number(i.excluUseAr),
    floor: floorOf(i.floor),
    depositMan: parseDealAmount(i.deposit),
    monthlyMan: i.monthlyRent === '' ? 0 : parseDealAmount(i.monthlyRent),
    contractType: blank(i.contractType),
    contractTerm: blank(i.contractTerm),
  };
}

/** 실거래 자연키에 쓰는 단지 식별 문자열 (매매는 aptSeq 가 없어 시군구·법정동명·지번·단지명) */
export const siteKey = (t) => t.aptSeq ?? [t.sigunguCd, t.umdNm, t.jibun ?? '', t.aptNm ?? ''].join('|');

/**
 * 한 시군구·한 달 전체를 페이지 순회로 가져온다 (쿼터 가드는 callExternal 안에서).
 * @returns {Promise<object[]>} 정규화된 행
 */
export async function fetchMonth({ pool, serviceKey, kind, lawdCd, ym, numOfRows = 1000, call = callExternal }) {
  const api = RTMS[kind];
  if (!api) throw new AppError('VALIDATION', `알 수 없는 실거래 종류: ${kind}`, 400);
  if (!serviceKey) throw new AppError('CONFIG', '.env 에 DATA_GO_KR_KEY 가 없습니다', 503);
  const key = serviceKey.includes('%') ? serviceKey : encodeURIComponent(serviceKey);
  const normalize = kind === 'SALE' ? normalizeSale : normalizeRent;
  const out = [];
  for (let page = 1; ; page++) {
    const url = `${api.url}?serviceKey=${key}&LAWD_CD=${lawdCd}&DEAL_YMD=${ym}&pageNo=${page}&numOfRows=${numOfRows}`;
    const r = await call({ pool, apiCd: api.apiCd, job: `rtms_${kind.toLowerCase()}`, url, parse: parseDataGoKr });
    out.push(...r.items.map(normalize));
    if (r.items.length === 0 || page * numOfRows >= r.totalCount) break;
  }
  return out;
}
