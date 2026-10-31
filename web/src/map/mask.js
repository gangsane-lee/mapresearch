// 구 선택 마스크 (계획서 §7.1)
// 폴리곤 1개: 바깥 = 전국을 덮는 사각형(시계방향), 구멍 = 선택 영역의 각 조각 외곽(반시계방향).
// 좌표는 [lng, lat]. 엔진 독립 — 어댑터가 자기 좌표 객체로 변환한다.

/** 전국을 넉넉히 덮는 사각형 (제주·울릉·독도 포함) */
export const KOREA_OUTER = [
  [122.0, 31.0],
  [122.0, 44.0],
  [134.0, 44.0],
  [134.0, 31.0],
];

/** 신발끈 공식 부호 면적 (+: 반시계, −: 시계) */
export function signedArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** GeoJSON 링은 첫 점 = 마지막 점. 지도 SDK 경로에는 중복 끝점을 뺀다. */
function openRing(ring) {
  const n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) return ring.slice(0, -1);
  return ring.slice();
}

function oriented(ring, clockwise) {
  const r = openRing(ring);
  const isCw = signedArea(r) < 0;
  return isCw === clockwise ? r : r.reverse();
}

/**
 * @param {{type:'Polygon'|'MultiPolygon', coordinates:any}} geometry 선택 영역 (여러 개 합치려면 MultiPolygon)
 * @returns {Array<Array<[number, number]>>} [outer, hole1, hole2, ...]
 */
export function buildMaskPaths(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  // 각 조각의 외곽 링만 구멍으로 사용 (구 내부의 섬형 구멍(enclave)은 음영 처리하지 않음)
  const holes = polys.map((poly) => oriented(poly[0], false));
  return [oriented(KOREA_OUTER, true), ...holes];
}

/** 여러 Feature를 MultiPolygon 하나로 (다중 선택용) */
export function mergeGeometries(geometries) {
  const coords = [];
  for (const g of geometries) {
    if (g.type === 'Polygon') coords.push(g.coordinates);
    else coords.push(...g.coordinates);
  }
  return { type: 'MultiPolygon', coordinates: coords };
}

/** 점이 bbox 안에 있는지 (선택 구 밖 마커 투명 처리용 1차 판정) */
export function inBbox([lng, lat], [minLng, minLat, maxLng, maxLat]) {
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
}

/** ray casting — 다각형(구멍 포함) 내부 판정 */
export function pointInGeometry(point, geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polys.some((poly) => ringContains(poly[0], point) && !poly.slice(1).some((h) => ringContains(h, point)));
}

function ringContains(ring, [x, y]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
