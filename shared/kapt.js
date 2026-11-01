// 한국부동산원 "공동주택 단지 식별정보_기본정보" CSV 해석 (서버·스크립트 공용, 순수 함수)
//
// 헤더(2026-08-31 파일로 확인): 단지고유번호, 필지고유번호, 주소, 단지명_공시가격, 단지명_건축물대장,
//   단지명_도로명주소, 단지종류, 동수, 세대수, 사용승인일, 도로명주소

export const KAPT_HEADER = ['단지고유번호', '필지고유번호', '주소', '단지명_공시가격', '단지명_건축물대장', '단지명_도로명주소', '단지종류', '동수', '세대수', '사용승인일', '도로명주소'];

/**
 * PNU(19자리) → 지번 문자열. 실거래 API 의 jibun 형식('1708', '602-17')과 같게 만든다.
 * 11번째 자리 2 = 산.
 */
export function jibunFromPnu(pnu) {
  if (!/^\d{19}$/.test(pnu ?? '')) return null;
  const bon = Number(pnu.slice(11, 15));
  const bu = Number(pnu.slice(15, 19));
  const j = bu ? `${bon}-${bu}` : String(bon);
  return pnu[10] === '2' ? `산${j}` : j;
}

const ADMIN_TOKEN = /(시|군|구)$/;

/**
 * 주소 → { sidoNm, cityNm, sggNm, umdNm }
 * '서울특별시 관악구 봉천동 1708' → 관악구 / 봉천동
 * '경기도 성남시 분당구 정자동 10' → 성남시·분당구 / 정자동
 * '경기도 양평군 양평읍 양근리 1' → 양평군 / '양평읍 양근리'
 * '세종특별자치시 반곡동 841' → 시군구 단계 없음 → sggNm = 시도명
 * 마지막 토큰이 지번이면 버린다(지번 없는 주소도 있다). 시·군·구로 끝나는 앞쪽 토큰(최대 2개)이 시군구.
 */
export function splitAddr(addr) {
  const t = String(addr ?? '').trim().split(/\s+/);
  if (t.length < 2) return null;
  const sidoNm = t[0];
  const rest = /^(산)?\d/.test(t.at(-1)) ? t.slice(1, -1) : t.slice(1);
  const sgg = [];
  while (sgg.length < 2 && rest.length > 1 && ADMIN_TOKEN.test(rest[0])) sgg.push(rest.shift());
  if (!rest.length) return null;
  return {
    sidoNm,
    cityNm: sgg.length === 2 ? sgg[0] : null,
    sggNm: sgg.at(-1) ?? sidoNm,
    umdNm: rest.join(' '),
  };
}

const int = (s) => {
  const n = Number(String(s ?? '').replace(/,/g, ''));
  return Number.isInteger(n) && n > 0 ? n : null;
};
const nz = (s) => {
  const v = String(s ?? '').trim();
  return v === '' ? null : v;
};

/** CSV 한 행(배열, KAPT_HEADER 순서) → kapt_ref 레코드. 해석 불가 행은 null */
export function parseKaptRow(r) {
  const [danjiId, pnu, addr, nmPrice, nmBld, nmRoad, kind, dong, hhld, useApr, roadAddr] = r;
  if (!/^\d{14}$/.test(danjiId ?? '') || !/^\d{19}$/.test(pnu ?? '')) return null;
  const a = splitAddr(addr);
  if (!a) return null;
  return {
    danjiId,
    pnu,
    sigunguCd: pnu.slice(0, 5),
    bjdCd: pnu.slice(0, 10),
    umdNm: a.umdNm,
    jibun: jibunFromPnu(pnu),
    addr: addr.trim(),
    sidoNm: a.sidoNm,
    cityNm: a.cityNm,
    sggNm: a.sggNm,
    nmPrice: nz(nmPrice),
    nmBld: nz(nmBld),
    nmRoad: nz(nmRoad),
    danjiKind: int(kind),
    dongCnt: int(dong),
    hhldCnt: int(hhld),
    useAprDay: /^\d{4}-\d{2}-\d{2}$/.test(useApr ?? '') ? useApr : null,
    roadAddr: nz(roadAddr),
  };
}

/** 화면 표시용 대표 단지명: 공시가격 → 건축물대장 → 도로명주소 순 */
export const kaptName = (k) => k.nmPrice ?? k.nmBld ?? k.nmRoad ?? k.addr;
