import { afterEach, describe, expect, test, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import SnapshotForm from '../src/components/SnapshotForm.vue';

const draft = {
  complexId: 1,
  displayNm: '벽산',
  observedAt: '2026-10-01',
  prevSnapshotId: 1,
  prevObservedAt: '2026-09-01',
  fields: [
    { fieldCd: 'grade_traffic', label: '교통 등급', category: 'TRAFFIC', dataType: 'enum', unit: null, scope: 'COMPLEX', confirmOnCarry: true },
    { fieldCd: 'price_ask', label: '현재 호가', category: 'PRICE', dataType: 'num', unit: '만원', scope: 'AREA', confirmOnCarry: true },
    { fieldCd: 'price_last_trade', label: '최근 실거래', category: 'PRICE', dataType: 'num', unit: '만원', scope: 'AREA', confirmOnCarry: false },
  ],
  enums: [
    { fieldCd: 'grade_traffic', code: 'S', label: '최상', ord: 4 },
    { fieldCd: 'grade_traffic', code: 'A', label: '좋음', ord: 3 },
  ],
  areaTypes: [{ areaTypeId: 1, label: '23평', exclM2: 59.9, isPrimary: true }],
  anchors: [{ anchorId: 1, name: '강남역', kind: 'CBD' }],
  values: [
    { fieldCd: 'grade_traffic', areaTypeId: null, value: 'A', carriedFromValueId: 7, carriedObservedAt: '2026-09-01' },
    { fieldCd: 'price_ask', areaTypeId: 1, value: 107000, carriedFromValueId: 8, carriedObservedAt: '2026-09-01' },
    { fieldCd: 'price_last_trade', areaTypeId: 1, value: 113000, carriedFromValueId: null, auto: { dealDate: '2026-08-14' } },
  ],
  commutes: [],
  master: { use_apr_day: '2005-01-01', hhld_cnt: 2105, hall_type: '복도식', far_ratio: 250 },
  pendingMasterRevId: null,
};

function mockFetch() {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    calls.push({ url, method: opts.method ?? 'GET', body: opts.body ? JSON.parse(opts.body) : undefined });
    const body = url.includes('/draft') ? draft : { snapshotId: 2 };
    return { ok: true, status: 200, json: async () => body };
  });
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe('SnapshotForm', () => {
  test('직전 값 복사·괴리율 표시, 복사값 그대로 저장 시 확인 단계', async () => {
    const calls = mockFetch();
    const w = mount(SnapshotForm, { props: { complexId: 1 } });
    await flushPromises();

    expect(w.text()).toContain('직전 스냅샷(2026-09-01)');
    expect(w.text()).toContain('괴리율 -5.3%');
    expect(w.text()).toContain('실거래 자동 (2026-08-14)');
    expect(w.findAll('.badge').length).toBeGreaterThanOrEqual(2);

    await w.find('footer .btn.primary').trigger('click');
    expect(w.text()).toContain('직전 값을 그대로 복사했습니다');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  test('호가 수정 + 등급 확인 후 저장 → carried 구분된 payload', async () => {
    const calls = mockFetch();
    const w = mount(SnapshotForm, { props: { complexId: 1 } });
    await flushPromises();

    await w.find('input[id="price_ask|1"]').setValue('11억');
    await w.find('.confirm input[type="checkbox"]').setValue(true); // 교통 등급 '이번에 확인함'
    await w.find('footer .btn.primary').trigger('click');
    await flushPromises();

    const post = calls.find((c) => c.method === 'POST');
    expect(post.url).toBe('/api/complexes/1/snapshots');
    expect(post.body.values).toEqual([
      { fieldCd: 'grade_traffic', areaTypeId: null, value: 'A', carriedFromValueId: null },
      { fieldCd: 'price_ask', areaTypeId: 1, value: 110000, carriedFromValueId: null },
      { fieldCd: 'price_last_trade', areaTypeId: 1, value: 113000, carriedFromValueId: null },
    ]);
    expect(w.emitted('saved')).toBeTruthy();
  });
});
