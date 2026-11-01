// 지도 엔진 추상화 (계획서 §7.1). 컴포넌트는 지도 SDK를 직접 호출하지 않고 이 인터페이스만 쓴다.
//
// 좌표 규칙: 위치는 { lat, lng }, bbox 는 [minLng, minLat, maxLng, maxLat], GeoJSON 은 [lng, lat].
//
// interface MapAdapter {
//   mount(el: HTMLElement, opts: { center: {lat,lng}, zoom: number }): Promise<void>
//   destroy(): void
//   setCenter(pos: {lat,lng}, zoom?: number, opts?: { offsetX?: number }): void   // offsetX = 지도 위 패널 폭
//   resize(): void                                                  // 컨테이너 크기 변경 후
//   fitBounds(bbox: number[], padding?: number | {top,right,bottom,left}): void
//   setMask(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null): void   // null = 해제
//   addMarker(m: { id, position: {lat,lng}, html: string, dimmed?: boolean }): void
//   updateMarker(id, patch: { html?: string, dimmed?: boolean, selected?: boolean }): void
//   removeMarker(id): void
//   clearMarkers(): void
//   onMarkerClick(handler: (id, ev: { ctrlKey: boolean, metaKey: boolean }) => void): void
//   onMapClick(handler: (pos: {lat,lng}) => void): void
//   onAreaSelect(handler: (bounds: {minLat,minLng,maxLat,maxLng}) => void): void   // Ctrl(⌘)+드래그 사각형
//   onMapRightClick(handler: (pos: {lat,lng}, point: {x,y}) => void): void         // point = 지도 요소 기준 px
//   setMapType(type: 'NORMAL' | 'SATELLITE' | 'HYBRID' | 'TERRAIN'): void
//   setLayer(name: 'cadastral' | 'traffic', on: boolean): void                     // 지적편집도·실시간 교통
// }

/**
 * 지도 키가 없거나 SDK 로딩 실패 시 쓰는 대체 어댑터 — 나머지 화면은 정상 동작 (계획서 §1.2)
 * 마커는 같은 말풍선 HTML을 목록으로 보여줘 선택(Ctrl 다중 선택 포함)이 가능하다.
 */
export class NullMapAdapter {
  constructor(reason) {
    this.reason = reason;
    this.markers = new Map();
    this.el = null;
    this.list = null;
    this.clickHandler = null;
  }
  async mount(el) {
    this.el = el;
    el.classList.add('map-unavailable');
    el.dataset.reason = this.reason;
    this.list = document.createElement('div');
    this.list.className = 'marker-list';
    this.list.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-marker-id]');
      if (!btn || !this.clickHandler) return;
      const id = this.markers.get(Number(btn.dataset.markerId))?.id ?? btn.dataset.markerId;
      this.clickHandler(id, { ctrlKey: ev.ctrlKey, metaKey: ev.metaKey });
    });
    el.appendChild(this.list);
  }
  destroy() {
    this.list?.remove();
    this.el?.classList.remove('map-unavailable');
  }
  setCenter() {}
  resize() {}
  fitBounds() {}
  setMask() {}
  addMarker(m) {
    this.markers.set(m.id, { ...m });
    this.#render();
  }
  updateMarker(id, patch) {
    const m = this.markers.get(id);
    if (!m) return;
    Object.assign(m, patch);
    this.#render();
  }
  removeMarker(id) {
    this.markers.delete(id);
    this.#render();
  }
  clearMarkers() {
    this.markers.clear();
    this.#render();
  }
  onMarkerClick(handler) {
    this.clickHandler = handler;
  }
  onMapClick() {}
  onAreaSelect() {} // 목록 모드에는 영역이 없다 (Ctrl+클릭으로 다중 선택)
  onMapRightClick() {}
  setMapType() {}
  setLayer() {}

  #render() {
    if (!this.list) return;
    this.list.replaceChildren(
      ...[...this.markers.values()].map((m) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'marker-item';
        b.dataset.markerId = m.id;
        if (m.selected) b.classList.add('selected');
        if (m.dimmed) b.classList.add('dimmed');
        b.innerHTML = m.html; // markerHtml()이 이스케이프한 HTML
        return b;
      }),
    );
    this.list.hidden = this.markers.size === 0;
  }
}

export async function createMapAdapter({ engine, ncpKeyId }) {
  if (engine === 'NAVER') {
    if (!ncpKeyId) return new NullMapAdapter('NCP_KEY_ID가 설정되지 않았습니다 (.env)');
    const { NaverMapAdapter } = await import('./NaverMapAdapter.js');
    return new NaverMapAdapter({ ncpKeyId });
  }
  return new NullMapAdapter(`지원하지 않는 지도 엔진: ${engine}`);
}
