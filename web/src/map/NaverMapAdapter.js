// 네이버 Maps (신규 Maps 상품, ncpKeyId) 어댑터
// 참고: https://navermaps.github.io/maps.js.ncp/docs/ — Polygon paths 배열의 2번째 이후 경로가 구멍.
// GL 모드(submodules=gl)는 P1 스파이크(U7) 전까지 사용하지 않는다.
import { buildMaskPaths } from './mask.js';

const SDK_URL = 'https://oapi.map.naver.com/openapi/v3/maps.js';
let sdkPromise = null;

function loadSdk(ncpKeyId) {
  if (window.naver?.maps) return Promise.resolve(window.naver.maps);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${SDK_URL}?ncpKeyId=${encodeURIComponent(ncpKeyId)}`;
      s.async = true;
      s.onload = () => (window.naver?.maps ? resolve(window.naver.maps) : reject(new Error('네이버 지도 SDK 초기화 실패')));
      s.onerror = () => {
        sdkPromise = null;
        reject(new Error('네이버 지도 SDK 로딩 실패 (네트워크 또는 키/도메인 설정 확인)'));
      };
      document.head.appendChild(s);
    });
  }
  return sdkPromise;
}

export class NaverMapAdapter {
  constructor({ ncpKeyId }) {
    this.ncpKeyId = ncpKeyId;
    this.map = null;
    this.mask = null;
    this.markers = new Map(); // id → { marker, state }
    this.markerClick = null;
    this.mapClick = null;
  }

  async mount(el, { center, zoom }) {
    const maps = await loadSdk(this.ncpKeyId);
    this.n = maps;
    this.map = new maps.Map(el, {
      center: new maps.LatLng(center.lat, center.lng),
      zoom,
      scaleControl: true,
      mapDataControl: false,
      zoomControl: true,
      zoomControlOptions: { position: maps.Position.TOP_RIGHT },
    });
    maps.Event.addListener(this.map, 'click', (e) => this.mapClick?.({ lat: e.coord.lat(), lng: e.coord.lng() }));
  }

  destroy() {
    this.clearMarkers();
    this.mask?.setMap(null);
    this.map?.destroy();
    this.map = null;
  }

  setCenter({ lat, lng }, zoom) {
    const pos = new this.n.LatLng(lat, lng);
    if (zoom != null) this.map.morph(pos, zoom);
    else this.map.panTo(pos);
  }

  fitBounds([minLng, minLat, maxLng, maxLat], padding = 40) {
    const b = new this.n.LatLngBounds(new this.n.LatLng(minLat, minLng), new this.n.LatLng(maxLat, maxLng));
    this.map.fitBounds(b, { top: padding, right: padding, bottom: padding, left: padding });
  }

  setMask(geometry) {
    this.mask?.setMap(null);
    this.mask = null;
    if (!geometry) return;
    const paths = buildMaskPaths(geometry).map((ring) => ring.map(([lng, lat]) => new this.n.LatLng(lat, lng)));
    this.mask = new this.n.Polygon({
      map: this.map,
      paths,
      fillColor: '#0f172a',
      fillOpacity: 0.45,
      strokeColor: '#2563eb',
      strokeWeight: 2,
      strokeOpacity: 0.9,
      clickable: false,
      zIndex: 10,
    });
  }

  addMarker({ id, position, html, dimmed = false }) {
    this.removeMarker(id);
    const state = { html, dimmed, selected: false };
    const marker = new this.n.Marker({
      map: this.map,
      position: new this.n.LatLng(position.lat, position.lng),
      icon: { content: this.#wrap(state), anchor: new this.n.Point(0, 0) },
      zIndex: 100,
    });
    this.n.Event.addListener(marker, 'click', (e) => {
      const dom = e.domEvent ?? e.pointerEvent ?? {};
      this.markerClick?.(id, { ctrlKey: !!dom.ctrlKey, metaKey: !!dom.metaKey });
    });
    this.markers.set(id, { marker, state });
  }

  updateMarker(id, patch) {
    const m = this.markers.get(id);
    if (!m) return;
    Object.assign(m.state, patch);
    m.marker.setIcon({ content: this.#wrap(m.state), anchor: new this.n.Point(0, 0) });
    m.marker.setZIndex(m.state.selected ? 200 : 100);
  }

  removeMarker(id) {
    const m = this.markers.get(id);
    if (m) {
      m.marker.setMap(null);
      this.markers.delete(id);
    }
  }

  clearMarkers() {
    for (const id of [...this.markers.keys()]) this.removeMarker(id);
  }

  onMarkerClick(handler) {
    this.markerClick = handler;
  }

  onMapClick(handler) {
    this.mapClick = handler;
  }

  #wrap({ html, dimmed, selected }) {
    const cls = ['apt-marker', dimmed ? 'is-dimmed' : '', selected ? 'is-selected' : ''].join(' ').trim();
    return `<div class="${cls}">${html}</div>`;
  }
}
