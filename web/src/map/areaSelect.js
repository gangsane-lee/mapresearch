// Ctrl+드래그 영역 선택 — 어댑터가 넘긴 두 꼭짓점(위경도)으로 영역 안 단지를 고른다.

/** 영역 안 단지가 이 개수 이하면 바로 비교, 넘으면 이 개수만큼 고르는 팝업 */
export const AREA_PICK = 2;

/** 두 점 → { minLat, minLng, maxLat, maxLng } */
export function boundsOf(a, b) {
  return {
    minLat: Math.min(a.lat, b.lat),
    maxLat: Math.max(a.lat, b.lat),
    minLng: Math.min(a.lng, b.lng),
    maxLng: Math.max(a.lng, b.lng),
  };
}

export const inBounds = (c, b) =>
  c.lat != null && c.lng != null && c.lat >= b.minLat && c.lat <= b.maxLat && c.lng >= b.minLng && c.lng <= b.maxLng;

/** 영역 선택 결과: NONE(없음) | SELECT(바로 비교할 id) | PICK(골라야 할 단지 목록) */
export function areaSelection(complexes, bounds) {
  const found = complexes.filter((c) => inBounds(c, bounds));
  if (!found.length) return { kind: 'NONE' };
  if (found.length <= AREA_PICK) return { kind: 'SELECT', ids: found.map((c) => c.complexId) };
  return { kind: 'PICK', items: found };
}
