import { describe, expect, test, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { normalizeAreaLabel, estimateExclM2 } from '../src/util/area.js';

const calls = [];
vi.mock('../src/api/client.js', () => ({
  api: vi.fn(async (url, opts) => {
    calls.push({ url, body: opts?.body });
    return { complexId: 1 };
  }),
}));
const { default: ComplexManualForm } = await import('../src/components/ComplexManualForm.vue');

describe('평형 입력 보조', () => {
  test('숫자만 입력하면 평을 붙인다', () => {
    expect(normalizeAreaLabel('24')).toBe('24평');
    expect(normalizeAreaLabel(' 33.5 ')).toBe('33.5평');
    expect(normalizeAreaLabel('24평')).toBe('24평');
    expect(normalizeAreaLabel('34A')).toBe('34A');
    expect(normalizeAreaLabel('')).toBe('');
  });

  test('평 → 전용㎡ 추정 (24평≈59.6, 34평≈84.5)', () => {
    expect(estimateExclM2('24평')).toBe(59.65);
    expect(estimateExclM2('34')).toBe(84.51);
    expect(estimateExclM2('34A')).toBe(84.51);
    expect(estimateExclM2('평')).toBe(null);
    expect(estimateExclM2('0')).toBe(null);
  });
});

describe('단지 추가 폼 평형 표', () => {
  const mountForm = () => mount(ComplexManualForm, { props: { regionItems: [], pickedPin: { lat: 37.48, lng: 126.94 } } });

  test('라벨 입력 → 전용 추정, 직접 고치면 추정 멈춤, 비고 저장', async () => {
    const w = mountForm();
    const label = w.find('input[aria-label^="평형 라벨"]');
    const excl = w.find('input[aria-label="전용면적"]');
    await label.setValue('24');
    expect(excl.element.value).toBe('59.65');
    expect(w.find('.est-tag').exists()).toBe(true);
    await label.trigger('blur');
    expect(label.element.value).toBe('24평');

    await excl.setValue('59.97');
    expect(w.find('.est-tag').exists()).toBe(false);
    await label.setValue('25');
    expect(excl.element.value).toBe('59.97', '직접 고친 전용은 라벨이 바뀌어도 유지');

    await w.find('input[aria-label="비고"]').setValue('판상형');
    await w.find('input[maxlength="100"]').setValue('테스트단지');
    await w.findAll('footer button').at(-1).trigger('click');
    const body = calls.find((c) => c.url === '/api/complexes/manual').body;
    expect(body.areaTypes).toEqual([{ label: '25평', exclM2: 59.97, rooms: null, baths: null, note: '판상형', isPrimary: true }]);
  });
});
