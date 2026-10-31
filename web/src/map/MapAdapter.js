// 지도 엔진 추상화 (계획서 §7.1). 컴포넌트는 지도 SDK를 직접 호출하지 않고 이 인터페이스만 쓴다.
//
// 좌표 규칙: 위치는 { lat, lng }, bbox 는 [minLng, minLat, maxLng, maxLat], GeoJSON 은 [lng, lat].
//
// interface MapAdapter {
//   mount(el: HTMLElement, opts: { center: {lat,lng}, zoom: number }): Promise<void>
//   destroy(): void
//   setCenter(pos: {lat,lng}, zoom?: number): void
//   fitBounds(bbox: number[], padding?: number): void
//   setMask(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null): void   // null = 해제
//   addMarker(m: { id, position: {lat,lng}, html: string, dimmed?: boolean }): void
//   updateMarker(id, patch: { html?: string, dimmed?: boolean, selected?: boolean }): void
//   removeMarker(id): void
//   clearMarkers(): void
//   onMarkerClick(handler: (id, ev: { ctrlKey: boolean, metaKey: boolean }) => void): void
//   onMapClick(handler: (pos: {lat,lng}) => void): void
// }

/** 지도 키가 없거나 SDK 로딩 실패 시 쓰는 빈 어댑터 — 나머지 화면은 정상 동작 (계획서 §1.2) */
export class NullMapAdapter {
  constructor(reason) {
    this.reason = reason;
    this.markers = new Map();
  }
  async mount(el) {
    el.classList.add('map-unavailable');
    el.dataset.reason = this.reason;
  }
  destroy() {}
  setCenter() {}
  fitBounds() {}
  setMask() {}
  addMarker(m) {
    this.markers.set(m.id, m);
  }
  updateMarker(id, patch) {
    const m = this.markers.get(id);
    if (m) Object.assign(m, patch);
  }
  removeMarker(id) {
    this.markers.delete(id);
  }
  clearMarkers() {
    this.markers.clear();
  }
  onMarkerClick() {}
  onMapClick() {}
}

export async function createMapAdapter({ engine, ncpKeyId }) {
  if (engine === 'NAVER') {
    if (!ncpKeyId) return new NullMapAdapter('NCP_KEY_ID가 설정되지 않았습니다 (.env)');
    const { NaverMapAdapter } = await import('./NaverMapAdapter.js');
    return new NaverMapAdapter({ ncpKeyId });
  }
  return new NullMapAdapter(`지원하지 않는 지도 엔진: ${engine}`);
}
