// A3 호가 괴리·하락 플래그 (계획서 §10) — "지금 가격이 괜찮은가" 강조
//   ASK_BELOW_TRADE: 내 호가가 최근 실거래 대비 gapThresholdPct(기본 −5%) 이하
//   TRADE_DROP:      최신 실거래가 직전 실거래보다 낮음

/**
 * @param {{priceAsk:number|null, lastTrade:{amountMan:number}|null, prevTrade:{amountMan:number}|null}} s
 * @returns {Array<{code:string, label:string, pct:number}>}
 */
export function computeFlags({ priceAsk, lastTrade, prevTrade }, gapThresholdPct = -5) {
  const flags = [];
  if (priceAsk != null && lastTrade?.amountMan) {
    const pct = Math.round(((priceAsk - lastTrade.amountMan) / lastTrade.amountMan) * 1000) / 10;
    if (pct <= gapThresholdPct) flags.push({ code: 'ASK_BELOW_TRADE', label: `호가가 실거래보다 ${Math.abs(pct)}% 낮음`, pct });
  }
  if (lastTrade?.amountMan && prevTrade?.amountMan && lastTrade.amountMan < prevTrade.amountMan) {
    const pct = Math.round(((lastTrade.amountMan - prevTrade.amountMan) / prevTrade.amountMan) * 1000) / 10;
    flags.push({ code: 'TRADE_DROP', label: `최근 실거래 ${Math.abs(pct)}% 하락`, pct });
  }
  return flags;
}
