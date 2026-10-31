import { describe, expect, test } from 'vitest';
import { buildFormState, toPayload, unconfirmedCarried, isCarried, rowErrors, gapPct, fromInput } from '../src/util/snapshotDraft.js';

const draft = {
  fields: [
    { fieldCd: 'price_ask', label: '현재 호가', dataType: 'num', unit: '만원', scope: 'AREA', confirmOnCarry: true, category: 'PRICE' },
    { fieldCd: 'env_mart', label: '대형마트', dataType: 'num', unit: '개', scope: 'COMPLEX', confirmOnCarry: false, category: 'ENV' },
    { fieldCd: 'grade_edu', label: '학군 등급', dataType: 'enum', unit: null, scope: 'COMPLEX', confirmOnCarry: true, category: 'EDU' },
    { fieldCd: 'note_overall', label: '종합', dataType: 'text', unit: null, scope: 'COMPLEX', confirmOnCarry: false, category: 'NOTE' },
  ],
  values: [
    { fieldCd: 'price_ask', areaTypeId: 1, value: 107000, carriedFromValueId: 10, carriedObservedAt: '2026-09-01' },
    { fieldCd: 'env_mart', areaTypeId: null, value: 1, carriedFromValueId: 11, carriedObservedAt: '2026-09-01' },
    { fieldCd: 'grade_edu', areaTypeId: null, value: 'C', carriedFromValueId: 12, carriedObservedAt: '2026-09-01' },
    { fieldCd: 'note_overall', areaTypeId: null, value: null, carriedFromValueId: null, carriedObservedAt: null },
  ],
  anchors: [{ anchorId: 1, name: '강남역' }, { anchorId: 2, name: '시청역' }],
  commutes: [{ anchorId: 1, mode: 'TRANSIT', minutes: 34, transfers: 1, carriedFromCommuteId: 5, carriedObservedAt: '2026-09-01' }],
};

describe('snapshot form state', () => {
  test('금액은 억 표기로 채움, 복사값 유지 시 carriedFromValueId 전송', () => {
    const s = buildFormState(draft);
    expect(s.rows[0].input).toBe('10.7억');
    const p = toPayload(s, { observedAt: '2026-10-01', source: 'VISIT' });
    expect(p.values.find((v) => v.fieldCd === 'price_ask')).toEqual({ fieldCd: 'price_ask', areaTypeId: 1, value: 107000, carriedFromValueId: 10 });
    expect(p.values.find((v) => v.fieldCd === 'note_overall')).toBeUndefined();
  });

  test('수정하거나 확인 체크하면 실제 관측값 (carried = null)', () => {
    const s = buildFormState(draft);
    s.rows[0].input = '11억';
    s.rows[1].confirmed = true;
    const p = toPayload(s, { observedAt: '2026-10-01', source: 'VISIT' });
    expect(p.values[0]).toMatchObject({ value: 110000, carriedFromValueId: null });
    expect(p.values[1]).toMatchObject({ value: 1, carriedFromValueId: null });
  });

  test('같은 값으로 다시 입력하면 여전히 복사값', () => {
    const s = buildFormState(draft);
    s.rows[0].input = '107000';
    expect(isCarried(s.rows[0])).toBe(true);
  });

  test('confirmOnCarry 항목만 저장 전 확인 대상', () => {
    const s = buildFormState(draft);
    expect(unconfirmedCarried(s).map((r) => r.field.fieldCd)).toEqual(['price_ask', 'grade_edu']);
    s.rows[2].confirmed = true;
    expect(unconfirmedCarried(s).map((r) => r.field.fieldCd)).toEqual(['price_ask']);
  });

  test('소요시간: 같으면 복사, 다르면 새 관측, 빈 값은 제외', () => {
    const s = buildFormState(draft);
    expect(toPayload(s, {}).commutes).toEqual([
      { anchorId: 1, mode: 'TRANSIT', minutes: 34, transfers: 1, routeDesc: null, suggestedMinutes: null, carriedFromCommuteId: 5 },
    ]);
    s.commutes[0].minutes = '30';
    s.commutes[1].minutes = '25';
    const p = toPayload(s, {});
    expect(p.commutes.map((c) => [c.anchorId, c.minutes, c.carriedFromCommuteId])).toEqual([[1, 30, null], [2, 25, null]]);
  });

  test('입력 오류 수집·괴리율', () => {
    const s = buildFormState(draft);
    s.rows[0].input = '10억5';
    s.commutes[1].minutes = '1.5';
    expect(rowErrors(s).map((e) => e.label)).toEqual(['현재 호가', '시청역 소요시간']);
    expect(gapPct(107000, 113000)).toBe(-5.3);
    expect(gapPct(107000, null)).toBeNull();
    expect(fromInput({ dataType: 'num', unit: '개' }, '-1').error).toBeTruthy();
  });
});
