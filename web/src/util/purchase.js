// 매수 검토: 매매가 + 부대비용(취득세·중개보수·기타) 추정 → 예산 대비 (금액은 모두 만원 정수)
//
// 기준 (2026-11 시행 기준, 추정치 — 실제 금액은 계약·보유 주택 수에 따라 다르다)
//  - 취득세(주택 유상취득, 1주택·일시적 2주택): 6억 이하 1%, 6억 초과~9억 이하 (취득가액(억) × 2/3 − 3)%, 9억 초과 3%
//    지방교육세 = 취득세율 × 10%, 농어촌특별세 = 전용 85㎡ 초과 시 0.2%
//    ※ 조정대상지역 다주택 중과세율은 반영하지 않는다 (갈아타기 = 일시적 2주택 가정)
//  - 중개보수 상한(주택 매매): 5천만 미만 0.6%(한도 25만), 2억 미만 0.5%(한도 80만), 9억 미만 0.4%,
//    12억 미만 0.5%, 15억 미만 0.6%, 15억 이상 0.7% — 부가세(10%)는 선택
//  - 기타(법무사·등기·채권 할인 등): 매매가의 비율로 어림 (기본 0.2%)

/** 취득세 + 지방교육세 + 농특세 (만원) 와 세율(%) */
export function acquisitionTax(priceMan, exclM2 = null) {
  if (!(priceMan > 0)) return { rate: 0, amount: 0 };
  const eok = priceMan / 10000;
  let rate;
  if (priceMan <= 60000) rate = 1;
  else if (priceMan <= 90000) rate = Math.round(((eok * 2) / 3 - 3) * 100) / 100;
  else rate = 3;
  const edu = rate * 0.1;
  const farm = exclM2 != null && exclM2 > 85 ? 0.2 : 0;
  const total = Math.round((rate + edu + farm) * 1000) / 1000;
  return { rate: total, amount: Math.round((priceMan * total) / 100) };
}

/** 중개보수 상한 (만원) */
export function brokerageFee(priceMan, { vat = true } = {}) {
  if (!(priceMan > 0)) return 0;
  const tiers = [
    [5000, 0.6, 25],
    [20000, 0.5, 80],
    [90000, 0.4, null],
    [120000, 0.5, null],
    [150000, 0.6, null],
    [Infinity, 0.7, null],
  ];
  const [, pct, cap] = tiers.find(([lim]) => priceMan < lim);
  let fee = (priceMan * pct) / 100;
  if (cap != null) fee = Math.min(fee, cap);
  if (vat) fee *= 1.1;
  return Math.round(fee);
}

/**
 * 한 단지 검토
 * @param price 기준 매매가(만원), budget 예산(만원, 없으면 null)
 * @returns { price, tax, taxRate, fee, etc, total, margin, verdict: 'OK'|'TIGHT'|'OVER'|'NO_BUDGET'|'NO_PRICE' }
 *   TIGHT = 남는 돈이 예산의 5% 미만
 */
export function reviewPurchase({ price, exclM2 = null, budget = null, vat = true, etcPct = 0.2 }) {
  if (!(price > 0)) return { verdict: 'NO_PRICE' };
  const t = acquisitionTax(price, exclM2);
  const fee = brokerageFee(price, { vat });
  const etc = Math.round((price * etcPct) / 100);
  const total = price + t.amount + fee + etc;
  const out = { price, tax: t.amount, taxRate: t.rate, fee, etc, total };
  if (budget == null) return { ...out, margin: null, verdict: 'NO_BUDGET' };
  const margin = budget - total;
  return { ...out, margin, verdict: margin < 0 ? 'OVER' : margin < budget * 0.05 ? 'TIGHT' : 'OK' };
}

/** 예산(총 자금)으로 살 수 있는 최대 매매가 (부대비용 포함, 1만원 단위 이분 탐색) */
export function maxPriceFor(budget, opts = {}) {
  if (!(budget > 0)) return null;
  let lo = 0;
  let hi = budget;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (reviewPurchase({ price: mid, budget, ...opts }).total <= budget) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
