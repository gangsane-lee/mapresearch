import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import SidePanel from '../src/components/SidePanel.vue';

const fields = [
  { fieldCd: 'grade_traffic', label: '교통 등급', better: 'UP' },
  { fieldCd: 'grade_env', label: '환경 등급', better: 'UP' },
  { fieldCd: 'grade_edu', label: '학군 등급', better: 'UP' },
  { fieldCd: 'price_ask', label: '현재 호가', better: 'DOWN' },
  { fieldCd: 'price_last_trade', label: '최근 실거래', better: 'NONE' },
  { fieldCd: 'env_mart', label: '대형마트', better: 'UP' },
];
const item = (id, nm, ask, grade, extra = {}) => ({
  complexId: id,
  displayNm: nm,
  status: 'VISITED',
  sggNm: '관악구',
  master: { useAprDay: '2005-01-01', hhldCnt: 2105, hallType: '복도식', farRatio: 250 },
  areaTypes: [{ areaTypeId: id * 10, label: '23평', rooms: 3, baths: 2 }],
  areaTypeId: id * 10,
  values: {
    price_ask: { value: ask, observedAt: '2026-10-20', carried: false },
    price_last_trade: { value: 113000, observedAt: '2026-10-20', carried: false },
    grade_traffic: { value: grade, observedAt: '2026-08-01', carried: true },
  },
  derived: { gapPct: -5.3, budgetDiff: 7000, askDelta: 3000 },
  commutes: [{ anchorId: 1, mode: 'TRANSIT', minutes: 34, transfers: 1, observedAt: '2026-10-20' }],
  distances: [{ anchorId: 1, km: 7.3 }],
  askSeries: [{ observedAt: '2026-09-01', value: 107000 }, { observedAt: '2026-10-01', value: ask }],
  ...extra,
});
const response = (items) => ({
  asOf: '2026-11-01',
  staleDays: 30,
  budgetMan: 100000,
  fields,
  enums: [
    { fieldCd: 'grade_traffic', code: 'S', label: '최상', ord: 4 },
    { fieldCd: 'grade_traffic', code: 'A', label: '좋음', ord: 3 },
  ],
  anchors: [{ anchorId: 1, name: '강남역', kind: 'CBD' }],
  items,
});

function mockFetch(body) {
  const urls = [];
  globalThis.fetch = vi.fn(async (url) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => body };
  });
  return urls;
}
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => vi.restoreAllMocks());

describe('SidePanel', () => {
  test('요약: 등급·호가·괴리율·예산 대비·직선거리, 오래된 등급은 흐림', async () => {
    const urls = mockFetch(response([item(1, '벽산', 107000, 'S')]));
    const w = mount(SidePanel, { props: { ids: [1] } });
    await flushPromises();
    expect(urls[0]).toBe('/api/compare?ids=1');
    const t = w.text();
    expect(t).toContain('벽산');
    expect(t).toContain('10.7억');
    expect(t).toContain('-5.3%');
    expect(t).toContain('+7,000만');
    expect(t).toContain('7.3km');
    expect(w.find('.grade.g-S').classes()).toContain('stale'); // 2026-08-01 관측 → 30일 경과
    expect(w.find('svg.spark path').attributes('d')).toMatch(/^M/);
  });

  test('비교: 호가 낮은 단지 우세, 등급 높은 단지 우세', async () => {
    mockFetch(response([item(1, '벽산', 107000, 'A'), item(2, '두산', 95000, 'S')]));
    const w = mount(SidePanel, { props: { ids: [1, 2] } });
    await flushPromises();
    const rowOf = (label) => w.findAll('tbody tr').find((r) => r.find('th').text() === label);
    const askCells = rowOf('현재 호가').findAll('td');
    expect(askCells[1].classes()).toContain('best');
    expect(askCells[0].classes()).toContain('worst');
    const gradeCells = rowOf('교통 등급').findAll('td');
    expect(gradeCells[1].classes()).toContain('best');
    expect(w.text()).toContain('비교 (2)');
  });
});
