import { describe, expect, test } from 'vitest';
import { rankOf, enumOrd, enumLabel, sparkPath, ageLabel } from '../src/util/compare.js';

const items = [{ complexId: 1, v: 107000 }, { complexId: 2, v: 95000 }, { complexId: 3, v: null }, { complexId: 4, v: 95000 }];

describe('rankOf', () => {
  test('DOWN(호가)은 낮을수록 최고, 동률 모두 강조, null 무시', () => {
    const r = rankOf(items, (i) => i.v, 'DOWN');
    expect([...r.best]).toEqual([2, 4]);
    expect([...r.worst]).toEqual([1]);
  });
  test('UP / NONE / 모두 같음 / 값 1개', () => {
    expect([...rankOf(items, (i) => i.v, 'UP').best]).toEqual([1]);
    expect(rankOf(items, (i) => i.v, 'NONE').best.size).toBe(0);
    expect(rankOf([{ complexId: 1, v: 1 }, { complexId: 2, v: 1 }], (i) => i.v, 'UP').best.size).toBe(0);
    expect(rankOf([{ complexId: 1, v: 1 }], (i) => i.v, 'UP').best.size).toBe(0);
  });
});

test('enum 변환', () => {
  const enums = [{ fieldCd: 'grade_edu', code: 'S', label: '최상', ord: 4 }, { fieldCd: 'redev_stage', code: 'UNION', label: '조합설립', ord: 5 }];
  expect(enumOrd(enums, 'grade_edu', 'S')).toBe(4);
  expect(enumOrd(enums, 'grade_edu', null)).toBeNull();
  expect(enumLabel(enums, 'grade_edu', 'S')).toBe('S');
  expect(enumLabel(enums, 'redev_stage', 'UNION')).toBe('조합설립');
});

test('sparkPath / ageLabel', () => {
  expect(sparkPath([1])).toBe('');
  expect(sparkPath([1, 2], 10, 10)).toBe('M0.0,8.0 L10.0,2.0');
  expect(ageLabel('2005-03-01', new Date('2026-11-01'))).toBe('2005년식 (22년차)');
  expect(ageLabel(null)).toBe('-');
});
