// 네이버 Maps (신규 Maps 상품, ncpKeyId) 어댑터
// 참고: https://navermaps.github.io/maps.js.ncp/docs/ — Polygon paths 배열의 2번째 이후 경로가 구멍.
// GL 모드(submodules=gl)는 P1 스파이크(U7) 전까지 사용하지 않는다.
import { buildMaskPaths } from './mask.js';
import { boundsOf } from './areaSelect.js';

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
    this.el = el;
    this.map = new maps.Map(el, {
      center: new maps.LatLng(center.lat, center.lng),
      zoom,
      scaleControl: true,
      mapDataControl: false,
      zoomControl: true,
      zoomControlOptions: { position: maps.Position.TOP_RIGHT },
    });
    maps.Event.addListener(this.map, 'click', (e) => this.mapClick?.({ lat: e.coord.lat(), lng: e.coord.lng() }));
    // 우클릭: 브라우저 메뉴 대신 위치 정보 (x, y 는 지도 요소 기준 px — 카드 위치용)
    el.addEventListener('contextmenu', (ev) => ev.preventDefault());
    maps.Event.addListener(this.map, 'rightclick', (e) => {
      const r = el.getBoundingClientRect();
      const dom = e.domEvent ?? e.pointerEvent ?? {};
      this.mapRightClick?.(
        { lat: e.coord.lat(), lng: e.coord.lng() },
        { x: (dom.clientX ?? r.left) - r.left, y: (dom.clientY ?? r.top) - r.top },
      );
    });
    this.#bindAreaSelect(el);
    // 우측 패널 열림·닫힘, 위치 지정 모드 등 컨테이너 크기가 바뀌면 지도 크기도 따라가게
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
  }

  /**
   * Ctrl(⌘)+드래그로 사각형 영역 선택. 6px 미만 이동은 클릭으로 보고 그대로 둔다(Ctrl+클릭 다중 선택 유지).
   * 드래그하는 동안은 지도 이동을 끄고, 끝난 직후의 click(마커·지도)은 한 번 무시한다.
   */
  #bindAreaSelect(el) {
    const MIN_PX = 6;
    let start = null;
    let box = null;
    let moved = false;
    const offset = (ev) => {
      const r = el.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    // fromOffsetToCoord 는 지도 요소 기준이 아니다 → 페이지 좌표로 변환 (실측 2026-11-01)
    const toCoord = (ev) => {
      const c = this.map.getProjection().fromPageXYToCoord(new this.n.Point(ev.pageX, ev.pageY));
      return { lat: c.lat(), lng: c.lng() };
    };
    let startEv = null;
    const onMove = (ev) => {
      const p = offset(ev);
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < MIN_PX) return;
      moved = true;
      if (!box) {
        box = document.createElement('div');
        box.className = 'area-select-box';
        el.appendChild(box);
      }
      Object.assign(box.style, {
        left: `${Math.min(p.x, start.x)}px`,
        top: `${Math.min(p.y, start.y)}px`,
        width: `${Math.abs(p.x - start.x)}px`,
        height: `${Math.abs(p.y - start.y)}px`,
      });
    };
    const onUp = (ev) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      this.map.setOptions('draggable', true);
      el.classList.remove('is-area-selecting');
      box?.remove();
      box = null;
      if (moved) {
        const swallow = (e) => e.stopPropagation();
        el.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 0);
        this.areaSelect?.(boundsOf(toCoord(startEv), toCoord(ev)));
      }
      start = null;
    };
    el.addEventListener(
      'mousedown',
      (ev) => {
        if (ev.button !== 0 || !(ev.ctrlKey || ev.metaKey) || !this.areaSelect) return;
        ev.preventDefault(); // 타일 이미지 끌기·글자 선택 방지 (click 은 그대로 발생)
        start = offset(ev);
        startEv = { pageX: ev.pageX, pageY: ev.pageY };
        moved = false;
        this.map.setOptions('draggable', false);
        el.classList.add('is-area-selecting');
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      },
      { capture: true },
    );
  }

  destroy() {
    this.ro?.disconnect();
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
      fillColor: '#1b2430',
      fillOpacity: 0.38,
      strokeColor: '#8e6f3a',
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

  onAreaSelect(handler) {
    this.areaSelect = handler;
  }

  /** 컨테이너 크기가 바뀐 뒤(상단바·패널 숨김 등) 지도 크기 다시 맞춤 */
  resize() {
    if (!this.map || !this.el) return;
    // setSize 가 요소에 인라인 px 크기를 남긴다 → 그대로 두면 그리드 칸이 그 폭으로 고정돼
    // 우측 패널이 화면 밖으로 밀린다. 재기 전·후 모두 지워 CSS(100%)가 크기를 정하게 한다.
    const clear = () => {
      this.el.style.width = '';
      this.el.style.height = '';
    };
    clear();
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    if (!w || !h) return;
    const cur = this.map.getSize();
    if (cur.width !== w || cur.height !== h) this.map.setSize(new this.n.Size(w, h));
    clear();
  }

  onMapRightClick(handler) {
    this.mapRightClick = handler;
  }

  #wrap({ html, dimmed, selected }) {
    const cls = ['apt-marker', dimmed ? 'is-dimmed' : '', selected ? 'is-selected' : ''].join(' ').trim();
    return `<div class="${cls}">${html}</div>`;
  }
}
