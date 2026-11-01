import { describe, expect, test } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { boundsOf, inBounds, areaSelection, AREA_PICK } from '../src/map/areaSelect.js';
import { useSelectionStore } from '../src/stores/selection.js';
import AreaPickModal from '../src/components/AreaPickModal.vue';

const c = (id, lat, lng, extra = {}) => ({ complexId: id, displayNm: `단지${id}`, status: 'INTEREST', lat, lng, ...extra });

describe('영역 선택', () => {
  test('어느 방향으로 끌어도 같은 사각형', () => {
    expect(boundsOf({ lat: 37.5, lng: 127.0 }, { lat: 37.4, lng: 126.9 })).toEqual({ minLat: 37.4, maxLat: 37.5, minLng: 126.9, maxLng: 127.0 });
  });

  test('경계 포함, 좌표 없는 단지 제외', () => {
    const b = { minLat: 37.4, maxLat: 37.5, minLng: 126.9, maxLng: 127.0 };
    expect(inBounds(c(1, 37.4, 127.0), b)).toBe(true);
    expect(inBounds(c(2, 37.51, 126.95), b)).toBe(false);
    expect(inBounds(c(3, null, null), b)).toBe(false);
  });

  test('없음 / 2개 이하는 바로 선택 / 3개 이상은 고르기', () => {
    const b = { minLat: 37, maxLat: 38, minLng: 126, maxLng: 128 };
    const out = c(9, 36, 126.5);
    expect(areaSelection([out], b)).toEqual({ kind: 'NONE' });
    expect(areaSelection([c(1, 37.5, 127), out, c(2, 37.6, 127)], b)).toEqual({ kind: 'SELECT', ids: [1, 2] });
    const r = areaSelection([c(1, 37.5, 127), c(2, 37.6, 127), c(3, 37.7, 127)], b);
    expect(r.kind).toBe('PICK');
    expect(r.items.map((x) => x.complexId)).toEqual([1, 2, 3]);
  });

  test('selection.replace: 기존 선택을 교체', () => {
    setActivePinia(createPinia());
    const s = useSelectionStore();
    s.select(5);
    s.replace([1, 2]);
    expect(s.selectedIds).toEqual([1, 2]);
    expect(s.mode).toBe('COMPARE');
  });
});

describe('AreaPickModal', () => {
  const items = [
    c(1, 37.5, 127, { priceAsk: 110000, areaLabel: '24평', useAprDay: '2005-01-01', hhldCnt: 2105, sggNm: '관악구' }),
    c(2, 37.5, 127),
    c(3, 37.5, 127),
  ];

  test(`${AREA_PICK}개만 고를 수 있고, 다 고르면 비교하기`, async () => {
    const w = mount(AreaPickModal, { props: { items } });
    expect(w.text()).toContain('11억');
    expect(w.text()).toContain('2,105');
    const boxes = w.findAll('input[type="checkbox"]');
    const go = () => w.findAll('footer button').at(-1);
    expect(go().attributes('disabled')).toBeDefined();
    await boxes[0].setValue(true);
    await boxes[2].setValue(true);
    expect(boxes[1].attributes('disabled')).toBeDefined(); // 2개 찼으면 나머지 잠금
    expect(go().attributes('disabled')).toBeUndefined();
    await go().trigger('click');
    expect(w.emitted('pick')[0][0]).toEqual([1, 3]);
  });
});
