<script setup>
// 메인 지도 화면 (계획서 §7.1)
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import RegionSearch from '../components/RegionSearch.vue';
import FilterBar from '../components/FilterBar.vue';
import SidePanel from '../components/SidePanel.vue';
import SnapshotForm from '../components/SnapshotForm.vue';
import ComplexManualForm from '../components/ComplexManualForm.vue';
import AreaPickModal from '../components/AreaPickModal.vue';
import MapPlaceCard from '../components/MapPlaceCard.vue';
import HistoryModal from '../components/HistoryModal.vue';
import ComplexListPanel from '../components/ComplexListPanel.vue';
import MapControls from '../components/MapControls.vue';
import BudgetReviewModal from '../components/BudgetReviewModal.vue';
import { api } from '../api/client.js';
// 차트(ECharts)가 포함된 상세 팝업은 지연 로딩 — 첫 화면 번들에서 제외 (계획서 §1.2 첫 화면 1.5초)
const DetailModal = defineAsyncComponent(() => import('../components/DetailModal.vue'));
const SettingsModal = defineAsyncComponent(() => import('../components/SettingsModal.vue'));
const CalendarModal = defineAsyncComponent(() => import('../components/CalendarModal.vue'));
import { createMapAdapter, NullMapAdapter } from '../map/MapAdapter.js';
import { pointInGeometry } from '../map/mask.js';
import { areaSelection } from '../map/areaSelect.js';
import { markerHtml } from '../util/format.js';
import { useSettingsStore } from '../stores/settings.js';
import { useRegionsStore } from '../stores/regions.js';
import { useComplexesStore } from '../stores/complexes.js';
import { useSelectionStore } from '../stores/selection.js';

const SEOUL = { center: { lat: 37.5326, lng: 126.99 }, zoom: 11 };

const settings = useSettingsStore();
const regions = useRegionsStore();
const complexes = useComplexesStore();
const selection = useSelectionStore();
const { selectedIds } = storeToRefs(selection);

const mapEl = ref(null);
const adapter = shallowRef(null);
const lastRegionMs = ref(null);
const notice = ref(null);
const snapshotFor = ref(null); // 스냅샷 입력 대상 complexId
const showManual = ref(false);
const reloadKey = ref(0); // 저장 후 패널 재조회
const pickingPin = ref(false);
const pickedPin = ref(null);
const showSettings = ref(false);
const showCalendar = ref(false);
const showBudget = ref(false);
const detailIds = ref(null); // 상세 팝업 대상
const detailRef = ref(null);
const correctOf = ref(null); // 정정 대상 스냅샷
const historyFor = ref(null); // 저장 이력 팝업 대상 complexId
const detailSnapshotId = ref(null); // 상세 팝업을 열면서 바로 보여 줄 스냅샷
const areaPick = ref(null); // Ctrl+드래그 영역 안 단지가 많을 때 고를 목록
const place = ref(null); // 지도 우클릭 위치 카드 { point, pos, loading, error, place, candidates }
const manualDanjiId = ref(null); // 우클릭 카드에서 고른 단지 → 단지 추가 폼 초안
const manualPlace = ref(null); // 우클릭 위치 주소 (식별정보 없는 위치 직접 추가)
let placeSeq = 0;

// 왼쪽 "내 단지" 목록 (접힘 상태는 이 브라우저에 기억)
const showList = ref(readPref('aptlog.showList', true));
watch(showList, (v) => writePref('aptlog.showList', v));
function readPref(k, d) {
  try {
    const v = localStorage.getItem(k);
    return v == null ? d : JSON.parse(v);
  } catch {
    return d;
  }
}
function writePref(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* 무시 */
  }
}

// 지도 유형·레이어 — 지도가 뜨기 전에 고른 값은 기억했다가 적용
const mapPrefs = { type: 'NORMAL', layers: {} };
function onMapType(t) {
  mapPrefs.type = t;
  adapter.value?.setMapType(t);
}
function onLayer(name, on) {
  mapPrefs.layers[name] = on;
  adapter.value?.setLayer(name, on);
}

/** 목록에서 고른 단지로 지도 이동 + 선택 */
function focusComplex(c, { multi = false } = {}) {
  if (c.lat != null && adapter.value) adapter.value.setCenter({ lat: c.lat, lng: c.lng }, 16, { offsetX: listInset() });
  selection.select(c.complexId, { multi });
}

/** 보이는 내 단지가 모두 들어오게 */
function fitAll() {
  const pts = complexes.visible.filter((c) => c.lat != null);
  if (!pts.length || !adapter.value) {
    notice.value = '지도에 표시할 단지가 없습니다';
    return;
  }
  if (pts.length === 1) return adapter.value.setCenter({ lat: pts[0].lat, lng: pts[0].lng }, 16, { offsetX: listInset() });
  const lngs = pts.map((c) => c.lng);
  const lats = pts.map((c) => c.lat);
  adapter.value.fitBounds([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)], { top: 70, right: 80, bottom: 70, left: 70 + listInset() });
}
/** 왼쪽 목록 패널이 가리는 폭 (px) */
const listInset = () => (showList.value && !pickingPin.value ? 352 : 0);

const nameOf = (id) => complexes.byId.get(id)?.displayNm ?? `#${id}`;

/** 스냅샷 수정 = 정정본 저장 (원본은 무효 처리돼 이력에 남는다) */
function openCorrect(snapshotId, complexId = detailIds.value?.[0] ?? historyFor.value) {
  if (!snapshotId || !complexId) return;
  correctOf.value = snapshotId;
  snapshotFor.value = complexId;
}

/** 가장 최근(무효 아닌) 스냅샷을 수정. 아직 없으면 새 스냅샷 */
async function editLatest(complexId) {
  try {
    const { items } = await api(`/api/complexes/${complexId}/snapshots`);
    if (items.length) openCorrect(items[0].snapshotId, complexId);
    else {
      notice.value = '저장한 스냅샷이 없어 새 스냅샷을 엽니다';
      snapshotFor.value = complexId;
    }
  } catch (err) {
    notice.value = err.message;
  }
}

async function openHistorySnapshot(snapshotId) {
  const id = historyFor.value;
  historyFor.value = null;
  detailSnapshotId.value = null; // 같은 스냅샷을 다시 골라도 펼쳐지도록
  await nextTick();
  detailSnapshotId.value = snapshotId;
  if (detailIds.value?.length !== 1 || detailIds.value[0] !== id) detailIds.value = [id];
}
function correctFromHistory(snapshotId) {
  const id = historyFor.value;
  historyFor.value = null;
  openCorrect(snapshotId, id);
}

/** 위치 지정 모드: 상단바·우측 패널을 숨기고 지도 전체를 핀 커서로 */
function startPickPin() {
  place.value = null;
  pickingPin.value = true;
}

function cancelPickPin() {
  pickingPin.value = false;
}

// 캡처 단계에서 먼저 받아 멈춘다 — 숨겨 둔 단지 추가 폼(Modal)의 Esc 닫기가 함께 실행되지 않도록
function onPickKey(e) {
  if (e.key !== 'Escape' || !pickingPin.value) return;
  e.stopImmediatePropagation();
  cancelPickPin();
}
// 상단바·패널이 빠지거나 돌아올 때 지도 크기는 어댑터가 컨테이너 크기 변화를 보고 맞춘다
watch(pickingPin, (on) => {
  if (on) window.addEventListener('keydown', onPickKey, true);
  else window.removeEventListener('keydown', onPickKey, true);
});

async function onManualSaved({ complexId }) {
  closeManual();
  await complexes.load();
  selection.select(complexId);
  notice.value = '단지를 등록했습니다';
}

async function onSnapshotSaved() {
  const corrected = correctOf.value != null;
  snapshotFor.value = null;
  correctOf.value = null;
  await onDataChanged();
  notice.value = corrected ? '정정본을 저장했습니다 (원본은 무효 처리, 이력 보존)' : '스냅샷을 저장했습니다';
}

async function onDataChanged() {
  reloadKey.value++;
  detailRef.value?.reload();
  await complexes.load();
}

/** Ctrl+드래그 영역: 1~2개면 바로 요약·비교, 그보다 많으면 고르는 팝업 */
function onAreaSelect(bounds) {
  const r = areaSelection(complexes.visible, bounds);
  if (r.kind === 'NONE') notice.value = '선택한 영역에 단지가 없습니다';
  else if (r.kind === 'SELECT') selection.replace(r.ids);
  else areaPick.value = r.items;
}

/** 우클릭: 그 위치의 단지 후보 (역지오코딩 — 사용자가 직접 누른 등록 경로에서만) */
async function onMapRightClick(pos, point) {
  if (pickingPin.value) return;
  const seq = ++placeSeq;
  place.value = { point, pos, loading: true, error: null, place: null, candidates: [] };
  try {
    const r = await api('/api/kapt/locate', { method: 'POST', body: pos });
    if (seq === placeSeq && place.value) Object.assign(place.value, { loading: false, place: r.place, candidates: r.candidates });
  } catch (err) {
    if (seq === placeSeq && place.value) Object.assign(place.value, { loading: false, error: err.message });
  }
}

function onPlaceAdd(danjiId) {
  manualDanjiId.value = danjiId;
  manualPlace.value = place.value.place;
  pickedPin.value = { ...place.value.pos };
  place.value = null;
  showManual.value = true;
}

function onPlaceOpen(complexId) {
  place.value = null;
  selection.select(complexId);
}

function closeManual() {
  showManual.value = false;
  pickingPin.value = false;
  pickedPin.value = null;
  manualDanjiId.value = null;
  manualPlace.value = null;
}

function onAreaPicked(ids) {
  areaPick.value = null;
  selection.replace(ids);
}

const currentRegion = computed(() => regions.current?.item ?? null);

/** 선택 구 안의 단지 (말풍선 강조 대상) */
const inRegion = computed(() => {
  const g = regions.current?.geometry;
  if (!g) return null;
  return new Set(
    complexes.visible.filter((c) => c.lat != null && pointInGeometry([c.lng, c.lat], g)).map((c) => c.complexId),
  );
});

function renderMarkers() {
  const a = adapter.value;
  if (!a) return;
  a.clearMarkers();
  for (const c of complexes.visible) {
    const noPin = c.lat == null || c.lng == null;
    if (noPin && !(a instanceof NullMapAdapter)) continue; // 지도에는 핀 있는 단지만, 대체 목록에는 전부
    a.addMarker({
      id: c.complexId,
      position: noPin ? null : { lat: c.lat, lng: c.lng },
      html: markerHtml(c),
      dimmed: inRegion.value ? !inRegion.value.has(c.complexId) : false,
    });
    if (selection.isSelected(c.complexId)) a.updateMarker(c.complexId, { selected: true });
  }
}

async function onSelectRegion(item) {
  try {
    const { geometry } = await regions.select(item);
    const t0 = performance.now();
    adapter.value.fitBounds(item.bbox, { left: 40 + listInset() });
    adapter.value.setMask(geometry);
    lastRegionMs.value = Math.round(performance.now() - t0); // 완료 기준: 100ms 이내 (타일 로딩 제외)
    renderMarkers();
    const n = inRegion.value?.size ?? 0;
    notice.value = n ? `${item.label}: 내 단지 ${n}개` : `${item.label}: 등록한 단지 없음`;
  } catch (err) {
    notice.value = err.message;
  }
}

function onClearRegion() {
  regions.clear();
  adapter.value.setMask(null);
  notice.value = null;
  renderMarkers();
}

watch(selectedIds, (now, before = []) => {
  const a = adapter.value;
  if (!a) return;
  for (const id of before) if (!now.includes(id)) a.updateMarker(id, { selected: false });
  for (const id of now) a.updateMarker(id, { selected: true });
});

watch(() => complexes.visible, renderMarkers);

onMounted(async () => {
  await Promise.all([settings.load(), regions.load(), complexes.load()]);
  if (!mapEl.value) return; // 불러오는 사이 화면을 떠났으면(보고서로 이동 등) 지도를 만들지 않는다
  let a;
  try {
    a = await createMapAdapter({ engine: settings.mapEngine, ncpKeyId: settings.ncpKeyId });
    await a.mount(mapEl.value, SEOUL);
  } catch (err) {
    if (!mapEl.value) return;
    a = new NullMapAdapter(err.message);
    await a.mount(mapEl.value, SEOUL);
  }
  a.onMarkerClick((id, ev) => selection.select(id, { multi: ev.ctrlKey || ev.metaKey }));
  a.onAreaSelect(onAreaSelect);
  a.onMapRightClick(onMapRightClick);
  a.onMapClick((pos) => {
    place.value = null;
    if (!pickingPin.value) return;
    pickedPin.value = pos;
    pickingPin.value = false;
  });
  adapter.value = a;
  a.setMapType(mapPrefs.type);
  for (const [k, on] of Object.entries(mapPrefs.layers)) if (on) a.setLayer(k, true);
  renderMarkers();
  openFromQuery();
});

/** 보고서 화면의 "수정"·"이력" 링크: /?edit=ID, /?history=ID */
function openFromQuery() {
  const q = new URLSearchParams(location.search);
  const id = Number(q.get('edit') || q.get('history'));
  if (!id || !complexes.byId.has(id)) return;
  selection.select(id);
  if (q.get('edit')) editLatest(id);
  else historyFor.value = id;
  history.replaceState(null, '', location.pathname);
}

// "/" 키로 구/시 검색칸으로 (입력 중일 때는 무시)
function onSlash(e) {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]') || document.querySelector('.backdrop')) return;
  const input = document.querySelector('.topbar .region-search input');
  if (!input) return;
  e.preventDefault();
  input.focus();
}
window.addEventListener('keydown', onSlash);

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onPickKey, true);
  window.removeEventListener('keydown', onSlash);
  adapter.value?.destroy();
});
</script>

<template>
  <div class="layout" :class="{ 'with-panel': selectedIds.length > 0 && !pickingPin, picking: pickingPin }">
    <header class="topbar">
      <strong class="logo"><img src="/icon.svg" alt="" width="26" height="26" />AptLog</strong>
      <span class="divider" aria-hidden="true" />
      <RegionSearch :items="regions.items" :current="currentRegion" @select="onSelectRegion" @clear="onClearRegion" />
      <FilterBar
        :status-filter="complexes.statusFilter"
        :tag-filter="complexes.tagFilter"
        :tags="complexes.allTags"
        :flagged-only="complexes.flaggedOnly"
        :flagged-count="complexes.flaggedCount"
        :favorite-only="complexes.favoriteOnly"
        :favorite-count="complexes.favoriteCount"
        @toggle-flagged="complexes.flaggedOnly = !complexes.flaggedOnly"
        @toggle-favorite="complexes.favoriteOnly = !complexes.favoriteOnly"
        @toggle-status="complexes.toggleStatus"
        @toggle-tag="complexes.toggleTag"
      />
      <span class="spacer" />
      <button type="button" class="btn ghost" @click="showBudget = true">매수 검토</button>
      <button type="button" class="btn ghost" @click="showCalendar = true">일정</button>
      <button type="button" class="btn ghost" @click="showSettings = true">설정</button>
      <button type="button" class="btn primary add" @click="showManual = true"><span aria-hidden="true">＋</span> 단지 추가</button>
    </header>
    <SettingsModal v-if="showSettings" @close="showSettings = false" @saved="onDataChanged" />
    <BudgetReviewModal
      v-if="showBudget"
      @close="showBudget = false"
      @select="(id) => ((showBudget = false), focusComplex(complexes.byId.get(id)))"
      @open-settings="(showBudget = false), (showSettings = true)"
    />
    <CalendarModal
      v-if="showCalendar"
      :complexes="complexes.list"
      @close="showCalendar = false"
      @open-complex="(id) => ((showCalendar = false), selection.select(id))"
    />

    <main class="map-wrap" :class="{ picking: pickingPin }">
      <div ref="mapEl" class="map" />
      <ComplexListPanel
        v-if="showList && !pickingPin"
        :items="complexes.visible"
        :selected-ids="selectedIds"
        :stale-days="settings.staleDays"
        @focus="focusComplex"
        @collapse="showList = false"
      />
      <button v-else-if="!pickingPin" type="button" class="list-open" title="내 단지 목록 열기" @click="showList = true">
        <span aria-hidden="true">☰</span> 내 단지 <b>{{ complexes.visible.length }}</b>
      </button>
      <MapControls v-show="!pickingPin" @map-type="onMapType" @layer="onLayer" @fit-all="fitAll" />
      <div v-if="pickingPin" class="pick-bar" role="status">
        <span class="pick-icon" aria-hidden="true" />
        <span><b>단지 위치 지정</b> 지도에서 단지 위치를 클릭하세요</span>
        <button type="button" class="btn" @click="cancelPickPin">취소 <kbd>Esc</kbd></button>
      </div>
      <div class="status-line" :class="{ 'beside-list': showList && !pickingPin }">
        <span v-if="notice" :title="lastRegionMs != null ? `구 선택 ${lastRegionMs}ms` : undefined">{{ notice }}</span>
        <span v-if="regions.error" class="warn">{{ regions.error }}</span>
        <span v-if="complexes.error" class="warn">단지 목록: {{ complexes.error }}</span>
        <span v-if="settings.error" class="warn">설정: {{ settings.error }}</span>
      </div>
      <MapPlaceCard
        v-if="place"
        :point="place.point"
        :loading="place.loading"
        :error="place.error"
        :place="place.place"
        :candidates="place.candidates"
        @close="place = null"
        @add="onPlaceAdd"
        @open="onPlaceOpen"
      />
    </main>

    <SidePanel
      v-if="selectedIds.length"
      v-show="!pickingPin"
      :ids="selectedIds"
      :reload-key="reloadKey"
      :warning="selection.lastWarning"
      @close="selection.clear()"
      @remove="selection.remove"
      @detail="detailIds = [...selectedIds]"
      @new-snapshot="(id) => (snapshotFor = id)"
      @edit-snapshot="editLatest"
      @history="(id) => (historyFor = id)"
    />

    <DetailModal
      v-if="detailIds"
      ref="detailRef"
      :ids="detailIds"
      :names="detailIds.map(nameOf)"
      :initial-snapshot-id="detailSnapshotId"
      @close="(detailIds = null), (detailSnapshotId = null)"
      @correct="(sid) => openCorrect(sid)"
      @changed="onDataChanged"
      @new-snapshot="(id) => (snapshotFor = id)"
      @history="(id) => (historyFor = id)"
    />
    <HistoryModal
      v-if="historyFor"
      :key="historyFor"
      :complex-id="historyFor"
      :name="nameOf(historyFor)"
      @close="historyFor = null"
      @open-snapshot="openHistorySnapshot"
      @correct="correctFromHistory"
    />
    <SnapshotForm
      v-if="snapshotFor"
      :complex-id="snapshotFor"
      :correct-of="correctOf"
      @close="(snapshotFor = null), (correctOf = null)"
      @saved="onSnapshotSaved"
    />
    <AreaPickModal v-if="areaPick" :items="areaPick" @close="areaPick = null" @pick="onAreaPicked" />
    <ComplexManualForm
      v-if="showManual"
      v-show="!pickingPin"
      :region-items="regions.items"
      :default-sigungu-cd="currentRegion?.kind === 'SIGUNGU' ? currentRegion.key : null"
      :picked-pin="pickedPin"
      :initial-danji-id="manualDanjiId"
      :initial-place="manualPlace"
      @close="closeManual"
      @saved="onManualSaved"
      @pick-pin="startPickPin"
    />
  </div>
</template>

<style scoped>
.layout {
  display: grid; height: 100%;
  grid-template-columns: 1fr;
  grid-template-rows: auto 1fr;
  grid-template-areas: 'top' 'map';
}
.layout.picking .topbar { display: none; }
.layout.with-panel {
  grid-template-columns: 1fr 420px;
  grid-template-areas: 'top top' 'map panel';
}
.topbar {
  grid-area: top; display: flex; align-items: center; gap: 12px;
  padding: 9px 20px 9px 16px; background: var(--panel); border-bottom: 1px solid var(--line); z-index: 20;
  box-shadow: 0 1px 0 rgb(27 36 48 / 0.03), 0 4px 14px rgb(27 36 48 / 0.05);
}
.logo { display: flex; align-items: center; gap: 8px; font-family: var(--serif); font-size: 20px; font-weight: 700; letter-spacing: -0.03em; color: var(--ink); }
.logo img { border-radius: 7px; display: block; }
.topbar .btn.add { border-radius: 999px; padding: 6px 16px; font-weight: 600; }
.topbar .btn.add span { font-weight: 400; margin-right: 2px; }
/* 목록을 접었을 때 다시 여는 버튼 */
.list-open {
  position: absolute; top: 12px; left: 12px; z-index: 15; display: flex; align-items: center; gap: 6px;
  border: 0; background: var(--panel); color: var(--ink); border-radius: 999px; padding: 8px 14px;
  box-shadow: var(--shadow-float); font-size: 13.5px; font-weight: 600;
}
.list-open b { color: var(--accent); }
.divider { width: 1px; height: 20px; background: var(--line-strong); }
.spacer { flex: 1; }
/* 태그가 늘어도 버튼이 다음 줄로 밀리지 않게 필터 칩 줄만 줄어들고 가로 스크롤 */
.topbar :deep(.filters) { flex: 0 1 auto; min-width: 0; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: thin; scrollbar-color: transparent transparent; padding: 2px 0; }
.topbar :deep(.filters:hover) { scrollbar-color: var(--line-strong) transparent; }
.topbar :deep(.filters .chip) { flex: none; }
.topbar > .btn { flex: none; }
.map-wrap { grid-area: map; position: relative; min-height: 0; }
/* 네이버 SDK가 인라인 position: relative 를 넣으므로 inset 대신 크기를 직접 지정 */
.map { position: absolute; inset: 0; width: 100%; height: 100%; }
/* 위치 지정 모드 */
.pick-bar {
  position: absolute; top: 16px; left: 50%; transform: translateX(-50%); z-index: 25;
  display: flex; align-items: center; gap: 12px; padding: 8px 8px 8px 14px; max-width: calc(100% - 24px);
  background: var(--ink); color: #fff; border-radius: 999px; box-shadow: var(--shadow-float); font-size: 13.5px;
}
.pick-bar b { margin-right: 6px; color: var(--champagne); }
.pick-bar .btn { border-radius: 999px; background: rgb(255 255 255 / 0.1); border-color: rgb(255 255 255 / 0.25); color: #fff; padding: 5px 12px; }
.pick-bar kbd { font: inherit; font-size: 11px; opacity: 0.6; margin-left: 4px; }
.pick-icon { width: 14px; height: 18px; flex: none; background: var(--pin-cursor) center / contain no-repeat; }
.map-wrap.picking .map, .map-wrap.picking .map :deep(*) { cursor: var(--pin-cursor) 14 35, crosshair !important; }
.status-line.beside-list { left: 364px; }
.status-line {
  position: absolute; left: 12px; bottom: 12px; display: flex; gap: 12px; flex-wrap: wrap;
  background: rgb(255 255 255 / 0.88); backdrop-filter: blur(6px); border: 1px solid var(--line);
  padding: 6px 12px; border-radius: 999px; font-size: 12.5px;
  pointer-events: none; max-width: calc(100% - 24px);
}
.status-line:empty { display: none; }
.warn { color: var(--warn); }
:deep(.side-panel) { grid-area: panel; }
</style>
