// 스냅샷 입력 폼 상태 (계획서 §7.4) — 화면 독립 순수 로직
import { parseManwon } from '../../../shared/unit.js';
import { formatMan } from './format.js';

export const CATEGORY_ORDER = [
  ['TRAFFIC', '교통'],
  ['ENV', '환경'],
  ['EDU', '학군'],
  ['PRICE', '가격'],
  ['REDEV', '정비사업'],
  ['NOTE', '종합'],
];

const isMoney = (f) => f.dataType === 'num' && f.unit === '만원';

/** 저장값 → 입력창 문자열 */
export function toInput(field, value) {
  if (value == null) return field.dataType === 'bool' ? null : '';
  if (isMoney(field)) return formatMan(value).replace(/,/g, '');
  if (field.dataType === 'date') return String(value).slice(0, 7); // <input type=month>
  return field.dataType === 'bool' ? value : String(value);
}

/** 입력창 → 서버 전송값 (서버가 최종 검증). 해석 불가면 { error } */
export function fromInput(field, input) {
  if (input === '' || input == null) return { value: null };
  if (isMoney(field)) {
    try {
      return { value: parseManwon(input) };
    } catch (e) {
      return { error: e.message };
    }
  }
  if (field.dataType === 'num') {
    const n = Number(input);
    return Number.isFinite(n) && n >= 0 ? { value: n } : { error: '0 이상의 숫자' };
  }
  if (field.dataType === 'text') return { value: String(input).trim() || null };
  return { value: input };
}

export function buildFormState(draft) {
  const fields = new Map(draft.fields.map((f) => [f.fieldCd, f]));
  const rows = draft.values.map((v) => {
    const field = fields.get(v.fieldCd);
    return {
      key: `${v.fieldCd}|${v.areaTypeId ?? ''}`,
      field,
      areaTypeId: v.areaTypeId,
      input: toInput(field, v.value),
      original: v.value,
      carriedFromValueId: v.carriedFromValueId,
      carriedObservedAt: v.carriedObservedAt,
      auto: v.auto,
      prefill: v.prefill ?? null, // 같은 법정동 다른 단지 값 제안 (A10)
      confirmed: false,
    };
  });
  const commutes = draft.anchors.map((a) => {
    const prev = draft.commutes.find((c) => c.anchorId === a.anchorId && c.mode === 'TRANSIT');
    return {
      anchor: a,
      mode: 'TRANSIT',
      minutes: prev?.minutes ?? '',
      transfers: prev?.transfers ?? '',
      routeDesc: prev?.routeDesc ?? '',
      suggestedMinutes: null,
      original: prev ? { minutes: prev.minutes, transfers: prev.transfers ?? null } : null,
      carriedFromCommuteId: prev?.carriedFromCommuteId ?? null,
      carriedObservedAt: prev?.carriedObservedAt ?? null,
    };
  });
  return { rows, commutes };
}

const eq = (a, b) => (a == null && b == null) || (a != null && b != null && String(a) === String(b));

export function isChanged(row) {
  const r = fromInput(row.field, row.input);
  if (r.error) return true;
  return !eq(r.value, row.original);
}

/** 복사값으로 남는 행 (수정도, '이번에 확인함'도 아님) */
export const isCarried = (row) => row.carriedFromValueId != null && !row.confirmed && !isChanged(row);

/** 저장 전 확인이 필요한 복사값 (호가·등급 등 confirmOnCarry) */
export function unconfirmedCarried(state) {
  return state.rows.filter((r) => r.field.confirmOnCarry && isCarried(r));
}

export function rowErrors(state) {
  const errs = [];
  for (const r of state.rows) {
    const x = fromInput(r.field, r.input);
    if (x.error) errs.push({ key: r.key, label: r.field.label, message: x.error });
  }
  for (const c of state.commutes) {
    if (c.minutes !== '' && c.minutes != null && !(Number.isInteger(Number(c.minutes)) && Number(c.minutes) >= 0)) {
      errs.push({ key: `commute|${c.anchor.anchorId}`, label: `${c.anchor.name} 소요시간`, message: '분 단위 정수' });
    }
  }
  return errs;
}

export function toPayload(state, { observedAt, source, memo }) {
  const values = [];
  for (const r of state.rows) {
    const x = fromInput(r.field, r.input);
    if (x.error || x.value == null) continue;
    values.push({
      fieldCd: r.field.fieldCd,
      areaTypeId: r.areaTypeId,
      value: x.value,
      carriedFromValueId: isCarried(r) ? r.carriedFromValueId : null,
    });
  }
  const commutes = state.commutes
    .filter((c) => c.minutes !== '' && c.minutes != null)
    .map((c) => {
      const minutes = Number(c.minutes);
      const transfers = c.transfers === '' || c.transfers == null ? null : Number(c.transfers);
      const same = c.original && c.original.minutes === minutes && (c.original.transfers ?? null) === transfers;
      return {
        anchorId: c.anchor.anchorId,
        mode: c.mode,
        minutes,
        transfers,
        routeDesc: c.routeDesc || null,
        suggestedMinutes: c.suggestedMinutes,
        carriedFromCommuteId: same ? c.carriedFromCommuteId : null,
      };
    });
  return { observedAt, source, memo: memo || null, values, commutes };
}

/** 호가 괴리율 (호가−실거래)/실거래 % (계획서 §3.2 #20) */
export function gapPct(ask, lastTrade) {
  if (ask == null || !lastTrade) return null;
  return Math.round(((ask - lastTrade) / lastTrade) * 1000) / 10;
}
