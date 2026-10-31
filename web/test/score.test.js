import { expect, test } from 'vitest';
import { weightedScores, weightsFromSettings, DEFAULT_WEIGHTS } from '../src/util/score.js';

const enums = ['grade_traffic', 'grade_env', 'grade_edu'].flatMap((f) =>
  [['S', 4], ['A', 3], ['B', 2], ['C', 1]].map(([code, ord]) => ({ fieldCd: f, code, ord })),
);
const it = (id, ask, t, e, d) => ({
  complexId: id,
  values: {
    price_ask: ask == null ? undefined : { value: ask },
    grade_traffic: t && { value: t },
    grade_env: e && { value: e },
    grade_edu: d && { value: d },
  },
});

test('가중 평균: 최저 호가 = 가격 100, 등급 S=100', () => {
  const s = weightedScores([it(1, 100000, 'S', 'A', 'C'), it(2, 125000, 'A', 'A', 'S')], enums, { traffic: 1, env: 1, edu: 1, price: 1 });
  expect(s.get(1).parts).toEqual({ traffic: 100, env: 75, edu: 25, price: 100 });
  expect(s.get(1).score).toBe(75);
  expect(s.get(2).parts.price).toBe(80);
  expect(s.get(2).score).toBe(82.5);
});

test('값 없는 항목은 제외하고 정규화, 가중치 0 항목 무시', () => {
  const s = weightedScores([it(1, null, 'S', null, null)], enums, { traffic: 3, env: 2, edu: 2, price: 0 });
  expect(s.get(1).used).toEqual(['traffic']);
  expect(s.get(1).score).toBe(100);
  expect(weightedScores([it(2, null, null, null, null)], enums).get(2).score).toBeNull();
});

test('weightsFromSettings: 잘못된 값은 기본값', () => {
  expect(weightsFromSettings({ 'weight.traffic': '5', 'weight.price': 'x' })).toEqual({ ...DEFAULT_WEIGHTS, traffic: 5 });
});
