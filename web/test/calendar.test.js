import { expect, test } from 'vitest';
import { monthGrid } from '../src/util/calendar.js';

test('monthGrid: 월요일 시작 6주, 2026년 11월', () => {
  const g = monthGrid(2026, 11);
  expect(g.weeks).toHaveLength(6);
  expect(g.weeks.every((w) => w.length === 7)).toBe(true);
  // 2026-11-01은 일요일 → 첫 칸은 10월 26일(월)
  expect(g.from).toBe('2026-10-26');
  expect(g.weeks[0][6]).toEqual({ date: '2026-11-01', day: 1, inMonth: true });
  expect(g.weeks[0][0].inMonth).toBe(false);
  expect(g.to).toBe('2026-12-06');
});

test('monthGrid: 1일이 월요일인 달', () => {
  expect(monthGrid(2026, 6).from).toBe('2026-06-01');
});
