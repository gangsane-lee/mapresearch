import { describe, expect, test } from 'vitest';
import { acquisitionTax, brokerageFee, reviewPurchase, maxPriceFor } from '../src/util/purchase.js';

describe('취득세 (1주택)', () => {
  test('6억 이하 1% + 교육세 0.1%', () => {
    expect(acquisitionTax(50000)).toEqual({ rate: 1.1, amount: 550 });
  });
  test('6~9억 구간: 7.5억 → 2% (+0.2%)', () => {
    expect(acquisitionTax(75000)).toEqual({ rate: 2.2, amount: 1650 });
  });
  test('9억 초과 3% + 교육세 0.3%, 전용 85㎡ 초과면 농특세 0.2%', () => {
    expect(acquisitionTax(100000, 84.9).rate).toBe(3.3);
    expect(acquisitionTax(100000, 101.5)).toEqual({ rate: 3.5, amount: 3500 });
  });
});

describe('중개보수 상한', () => {
  test('구간별 요율·한도, 부가세 선택', () => {
    expect(brokerageFee(4000, { vat: false })).toBe(24);
    expect(brokerageFee(15000, { vat: false })).toBe(75);
    expect(brokerageFee(30000, { vat: false })).toBe(120, '2억 이상 9억 미만 0.4% (한도 없음)');
    expect(brokerageFee(90000, { vat: false })).toBe(450, '9억부터는 0.5%');
    expect(brokerageFee(100000, { vat: false })).toBe(500);
    expect(brokerageFee(100000)).toBe(550);
    expect(brokerageFee(160000, { vat: false })).toBe(1120);
  });
});

describe('매수 검토', () => {
  test('10억 예산, 9억 아파트 → 부대비용 포함 여유', () => {
    const r = reviewPurchase({ price: 90000, exclM2: 84.9, budget: 100000 });
    expect(r).toMatchObject({ price: 90000, tax: 2970, fee: 495, etc: 180, total: 93645, margin: 6355, verdict: 'OK' });
  });
  test('호가 없음·예산 없음·초과·빠듯', () => {
    expect(reviewPurchase({ price: null, budget: 100000 }).verdict).toBe('NO_PRICE');
    expect(reviewPurchase({ price: 90000 }).verdict).toBe('NO_BUDGET');
    expect(reviewPurchase({ price: 100000, budget: 100000 }).verdict).toBe('OVER');
    expect(reviewPurchase({ price: 92000, budget: 100000 }).verdict).toBe('TIGHT');
  });
  test('예산으로 살 수 있는 최대 매매가', () => {
    const p = maxPriceFor(100000);
    expect(reviewPurchase({ price: p, budget: 100000 }).total).toBeLessThanOrEqual(100000);
    expect(reviewPurchase({ price: p + 1, budget: 100000 }).total).toBeGreaterThan(100000);
  });
});
