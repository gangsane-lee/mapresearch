// 비교표 강조 (계획서 §7.2: field_def.better 기준 최고·최저)

/**
 * @param {Array<{complexId:number}>} items
 * @param {(item)=>number|null} getter   비교값 (enum은 ord로 변환해서 넘긴다)
 * @param {'UP'|'DOWN'|'NONE'} better
 * @returns {{ best:Set<number>, worst:Set<number> }}  값이 2개 이상이고 모두 같지 않을 때만
 */
export function rankOf(items, getter, better) {
  const empty = { best: new Set(), worst: new Set() };
  if (better === 'NONE') return empty;
  const vals = items.map((i) => [i.complexId, getter(i)]).filter(([, v]) => v != null && Number.isFinite(v));
  if (vals.length < 2) return empty;
  const nums = vals.map(([, v]) => v);
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  if (max === min) return empty;
  const hi = new Set(vals.filter(([, v]) => v === max).map(([id]) => id));
  const lo = new Set(vals.filter(([, v]) => v === min).map(([id]) => id));
  return better === 'UP' ? { best: hi, worst: lo } : { best: lo, worst: hi };
}

/** enum 코드 → ord (등급 S=4 … C=1) */
export function enumOrd(enums, fieldCd, code) {
  if (code == null) return null;
  return enums.find((e) => e.fieldCd === fieldCd && e.code === code)?.ord ?? null;
}

export function enumLabel(enums, fieldCd, code) {
  if (code == null) return '-';
  const e = enums.find((x) => x.fieldCd === fieldCd && x.code === code);
  return e ? (e.code.length <= 2 ? e.code : e.label) : code;
}

/** 스파크라인 SVG path (값 배열 → 0..w × 0..h) */
export function sparkPath(values, w = 120, h = 28) {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/** 연식 → "2005년식 (21년차)" */
export function ageLabel(useAprDay, today = new Date()) {
  if (!useAprDay) return '-';
  const y = Number(String(useAprDay).slice(0, 4));
  return `${y}년식 (${today.getFullYear() - y + 1}년차)`;
}
