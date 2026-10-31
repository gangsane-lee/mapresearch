// 기준점 직선거리 (계획서 §3.2 #6) — 저장하지 않고 화면 요청 시 계산
const R = 6371.0088; // 지구 평균 반지름 km

/** @returns {number} km (소수 1자리) */
export function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}
