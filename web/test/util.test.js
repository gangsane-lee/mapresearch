import { describe, expect, test, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { formatMan, formatDeltaMan, escapeHtml, isStale, markerHtml } from '../src/util/format.js';
import { buildRegionItems, searchRegions } from '../src/util/regionSearch.js';
import { useSelectionStore, MAX_COMPARE } from '../src/stores/selection.js';

describe('format', () => {
  test('만원 → 억 표시', () => {
    expect(formatMan(107000)).toBe('10.7억');
    expect(formatMan(110500)).toBe('11.05억');
    expect(formatMan(7500)).toBe('7,500만');
    expect(formatMan(null)).toBe('-');
  });
  test('증감', () => {
    expect(formatDeltaMan(3000)).toBe('▲3,000만');
    expect(formatDeltaMan(-12000)).toBe('▼1.2억');
    expect(formatDeltaMan(0)).toBe('−');
    expect(formatDeltaMan(null)).toBe('');
  });
  test('관측일 경과', () => {
    const today = new Date('2026-11-01T12:00:00');
    expect(isStale('2026-09-15', 30, today)).toBe(true);
    expect(isStale('2026-10-20', 30, today)).toBe(false);
    expect(isStale(null, 30, today)).toBe(false);
  });
  test('마커 HTML은 사용자 입력을 이스케이프', () => {
    const html = markerHtml({ displayNm: '<img src=x onerror=alert(1)>', status: 'VISITED', priceAsk: 107000, areaLabel: '23평', priceAskDelta: -500 });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('10.7억');
    expect(html).toContain('class="down"');
    expect(escapeHtml(`"'&`)).toBe('&quot;&#39;&amp;');
  });
});

describe('regionSearch', () => {
  const index = {
    sigungu: [
      { code: '11620', sidoNm: '서울특별시', sggNm: '관악구', cityNm: null, bbox: [0, 0, 1, 1] },
      { code: '41131', sidoNm: '경기도', sggNm: '성남시 수정구', cityNm: '성남시', bbox: [0, 0, 1, 1] },
      { code: '41135', sidoNm: '경기도', sggNm: '성남시 분당구', cityNm: '성남시', bbox: [0, 0, 1, 1] },
    ],
    cities: [{ name: '성남시', codes: ['41131', '41135'], bbox: [0, 0, 2, 2] }],
  };
  const items = buildRegionItems(index);

  test('시 전체 항목 생성', () => {
    expect(items.find((i) => i.kind === 'CITY')).toMatchObject({ label: '성남시 전체', codes: ['41131', '41135'], sub: '경기도' });
  });
  test('시 검색은 시 전체가 먼저, 공백 무시', () => {
    const r = searchRegions(items, '성남');
    expect(r[0].kind).toBe('CITY');
    expect(r).toHaveLength(3);
    expect(searchRegions(items, '분 당')[0].key).toBe('41135');
  });
  test('시도명으로도 검색, 빈 검색어는 결과 없음', () => {
    expect(searchRegions(items, '서울').map((i) => i.key)).toEqual(['11620']);
    expect(searchRegions(items, '')).toEqual([]);
  });
});

describe('selection store', () => {
  beforeEach(() => setActivePinia(createPinia()));

  test('일반 클릭은 교체, Ctrl 클릭은 토글', () => {
    const s = useSelectionStore();
    s.select(1);
    s.select(2);
    expect(s.selectedIds).toEqual([2]);
    expect(s.mode).toBe('SUMMARY');
    s.select(3, { multi: true });
    expect(s.selectedIds).toEqual([2, 3]);
    expect(s.mode).toBe('COMPARE');
    s.select(2, { multi: true });
    expect(s.selectedIds).toEqual([3]);
  });

  test(`최대 ${MAX_COMPARE}개`, () => {
    const s = useSelectionStore();
    for (let i = 1; i <= MAX_COMPARE + 1; i++) s.select(i, { multi: true });
    expect(s.selectedIds).toHaveLength(MAX_COMPARE);
    expect(s.lastWarning).toMatch(/최대/);
    s.clear();
    expect(s.mode).toBe('NONE');
  });
});

test('마커: 가격 알림이 있으면 ! 표시와 사유 툴팁', () => {
  const html = markerHtml({ displayNm: '벽산', status: 'VISITED', priceAsk: 107000, flags: [{ code: 'ASK_BELOW_TRADE', label: '호가가 실거래보다 5.3% 낮음' }] });
  expect(html).toContain('class="flag"');
  expect(html).toContain('5.3% 낮음');
  expect(markerHtml({ displayNm: 'x', status: 'VISITED' })).not.toContain('class="flag"');
});
