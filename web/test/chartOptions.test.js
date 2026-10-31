import { describe, expect, test } from 'vitest';
import { priceTrendOption, monthlyAvg, gradeTrendOption, barOption, radarOption, eok } from '../src/charts/options.js';

describe('chart options', () => {
  test('monthlyAvg', () => {
    expect(monthlyAvg([{ d: '2026-08-01', v: 10 }, { d: '2026-08-20', v: 20 }, { d: '2026-07-03', v: 5 }], 'd', 'v')).toEqual([
      { month: '2026-07', value: 5 },
      { month: '2026-08', value: 15 },
    ]);
  });

  test('시세 추이: 해제 거래 제외, 월세 제외, 전세가율 계산', () => {
    const o = priceTrendOption({
      ask: [{ observedAt: '2026-09-01', value: 107000 }],
      sales: [
        { dealDate: '2026-08-14', amountMan: 100000, floor: 7, canceled: false },
        { dealDate: '2026-08-20', amountMan: 200000, floor: 3, canceled: true },
      ],
      rents: [
        { dealDate: '2026-08-02', depositMan: 40000, monthlyMan: 0 },
        { dealDate: '2026-08-05', depositMan: 10000, monthlyMan: 80 },
      ],
    });
    const byName = Object.fromEntries(o.series.map((s) => [s.name, s.data]));
    expect(byName['내 호가']).toEqual([['2026-09-01', 10.7]]);
    expect(byName['매매 실거래']).toEqual([['2026-08-14', 10, 7]]);
    expect(byName['전세(월평균)']).toEqual([['2026-08-15', 4]]);
    expect(byName['전세가율']).toEqual([['2026-08-15', 40]]);
  });

  test('등급·바·레이더', () => {
    const g = gradeTrendOption([{ name: '교통', points: [{ observedAt: '2026-09-01', value: 3 }] }], [{ fieldCd: 'grade_traffic', code: 'A', ord: 3 }]);
    expect(g.yAxis.axisLabel.formatter(3)).toBe('A');
    expect(barOption(['a', 'b'], [107000, null], { valueFmt: eok }).series[0].data).toEqual([10.7, null]);
    expect(radarOption([{ name: 'x', values: [4, null, 2] }], ['교통', '환경', '학군']).series[0].data[0].value).toEqual([4, 0, 2]);
  });
});
