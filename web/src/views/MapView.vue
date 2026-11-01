<script setup>
// 메인 지도 화면 (계획서 §7.1)
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import RegionSearch from '../components/RegionSearch.vue';
import FilterBar from '../components/FilterBar.vue';
import SidePanel from '../components/SidePanel.vue';
import SnapshotForm from '../components/SnapshotForm.vue';
import ComplexManualForm from '../components/ComplexManualForm.vue';
// 차트(ECharts)가 포함된 상세 팝업은 지연 로딩 — 첫 화면 번들에서 제외 (계획서 §1.2 첫 화면 1.5초)
const DetailModal = defineAsyncComponent(() => import('../components/DetailModal.vue'));
const SettingsModal = defineAsyncComponent(() => import('../components/SettingsModal.vue'));
const CalendarModal = defineAsyncComponent(() => import('../components/CalendarModal.vue'));
import { createMapAdapter, NullMapAdapter } from '../map/MapAdapter.js';
import { pointInGeometry } from '../map/mask.js';
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
const detailIds = ref(null); // 상세 팝업 대상
const detailRef = ref(null);
const correctOf = ref(null); // 정정 대상 스냅샷

const nameOf = (id) => complexes.byId.get(id)?.displayNm ?? `#${id}`;

function openCorrect(snapshotId) {
  correctOf.value = snapshotId;
  snapshotFor.value = detailIds.value[0];
}

function startPickPin() {
  pickingPin.value = true;
  notice.value = '지도를 클릭해 단지 위치를 지정하세요';
}

async function onManualSaved({ complexId }) {
  showManual.value = false;
  pickedPin.value = null;
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
    adapter.value.fitBounds(item.bbox);
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
  let a;
  try {
    a = await createMapAdapter({ engine: settings.mapEngine, ncpKeyId: settings.ncpKeyId });
    await a.mount(mapEl.value, SEOUL);
  } catch (err) {
    a = new NullMapAdapter(err.message);
    await a.mount(mapEl.value, SEOUL);
  }
  a.onMarkerClick((id, ev) => selection.select(id, { multi: ev.ctrlKey || ev.metaKey }));
  a.onMapClick((pos) => {
    if (!pickingPin.value) return;
    pickedPin.value = pos;
    pickingPin.value = false;
    notice.value = null;
  });
  adapter.value = a;
  renderMarkers();
});

onBeforeUnmount(() => adapter.value?.destroy());
</script>

<template>
  <div class="layout" :class="{ 'with-panel': selectedIds.length > 0 }">
    <header class="topbar">
      <strong class="logo">AptLog</strong>
      <RegionSearch :items="regions.items" :current="currentRegion" @select="onSelectRegion" @clear="onClearRegion" />
      <FilterBar
        :status-filter="complexes.statusFilter"
        :tag-filter="complexes.tagFilter"
        :tags="complexes.allTags"
        :flagged-only="complexes.flaggedOnly"
        :flagged-count="complexes.flaggedCount"
        @toggle-flagged="complexes.flaggedOnly = !complexes.flaggedOnly"
        @toggle-status="complexes.toggleStatus"
        @toggle-tag="complexes.toggleTag"
      />
      <span class="spacer" />
      <button type="button" class="btn" @click="showCalendar = true">일정</button>
      <button type="button" class="btn" @click="showSettings = true">설정</button>
      <button type="button" class="btn primary" @click="showManual = true">단지 추가</button>
    </header>
    <SettingsModal v-if="showSettings" @close="showSettings = false" @saved="onDataChanged" />
    <CalendarModal
      v-if="showCalendar"
      :complexes="complexes.list"
      @close="showCalendar = false"
      @open-complex="(id) => ((showCalendar = false), selection.select(id))"
    />

    <main class="map-wrap">
      <div ref="mapEl" class="map" />
      <div class="status-line">
        <span v-if="notice">{{ notice }}</span>
        <span v-if="lastRegionMs != null" class="muted">구 선택 {{ lastRegionMs }}ms</span>
        <span v-if="regions.error" class="warn">{{ regions.error }}</span>
        <span v-if="complexes.error" class="warn">단지 목록: {{ complexes.error }}</span>
        <span v-if="settings.error" class="warn">설정: {{ settings.error }}</span>
      </div>
    </main>

    <SidePanel
      v-if="selectedIds.length"
      :ids="selectedIds"
      :reload-key="reloadKey"
      :warning="selection.lastWarning"
      @close="selection.clear()"
      @remove="selection.remove"
      @detail="detailIds = [...selectedIds]"
      @new-snapshot="(id) => (snapshotFor = id)"
    />

    <DetailModal
      v-if="detailIds"
      ref="detailRef"
      :ids="detailIds"
      :names="detailIds.map(nameOf)"
      @close="detailIds = null"
      @correct="openCorrect"
      @changed="onDataChanged"
    />
    <SnapshotForm
      v-if="snapshotFor"
      :complex-id="snapshotFor"
      :correct-of="correctOf"
      @close="(snapshotFor = null), (correctOf = null)"
      @saved="onSnapshotSaved"
    />
    <ComplexManualForm
      v-if="showManual"
      v-show="!pickingPin"
      :region-items="regions.items"
      :default-sigungu-cd="currentRegion?.kind === 'SIGUNGU' ? currentRegion.key : null"
      :picked-pin="pickedPin"
      @close="(showManual = false), (pickingPin = false)"
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
.layout.with-panel {
  grid-template-columns: 1fr 420px;
  grid-template-areas: 'top top' 'map panel';
}
.topbar {
  grid-area: top; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 8px 16px; background: var(--panel); border-bottom: 1px solid var(--line); z-index: 20;
}
.logo { font-size: 18px; }
.spacer { flex: 1; }
.map-wrap { grid-area: map; position: relative; min-height: 0; }
/* 네이버 SDK가 인라인 position: relative 를 넣으므로 inset 대신 크기를 직접 지정 */
.map { position: absolute; inset: 0; width: 100%; height: 100%; }
.status-line {
  position: absolute; left: 12px; bottom: 12px; display: flex; gap: 12px; flex-wrap: wrap;
  background: rgb(255 255 255 / 0.92); padding: 6px 10px; border-radius: var(--radius); font-size: 13px;
  pointer-events: none; max-width: calc(100% - 24px);
}
.status-line:empty { display: none; }
.warn { color: var(--warn); }
:deep(.side-panel) { grid-area: panel; }
/* A9 휴대폰: 상단바를 2줄(로고·버튼 / 검색)+1줄(필터 가로 스크롤)로 압축 */
@media (max-width: 640px) {
  .topbar { gap: 6px 8px; padding: 6px 10px; }
  .logo { font-size: 16px; }
  .topbar :deep(.region-search) { order: 10; width: 100%; }
  .topbar :deep(.region-search input) { width: 100%; }
  .topbar :deep(.region-search .dropdown) { width: 100%; }
  .topbar :deep(.filters) { order: 11; width: 100%; flex-wrap: nowrap; overflow-x: auto; padding-bottom: 2px; }
  .topbar :deep(.filters .chip) { flex: none; }
  .spacer { display: none; }
  .topbar .btn { padding: 4px 8px; }
}
@media (max-width: 900px) {
  .layout.with-panel { grid-template-columns: 1fr; grid-template-areas: 'top' 'map'; }
  :deep(.side-panel) { position: fixed; right: 0; top: 0; bottom: 0; z-index: 40; }
}
</style>
