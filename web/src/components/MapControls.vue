<script setup>
// 지도 오른쪽 아래 컨트롤 (네이버 지도의 레이어 버튼처럼): 지도 유형, 지적편집도·교통 레이어, 내 단지 전체 보기
// 선택은 이 브라우저에 기억한다.
import { onMounted, ref, watch } from 'vue';

const emit = defineEmits(['map-type', 'layer', 'fit-all']);
const TYPES = { NORMAL: '일반', SATELLITE: '위성', HYBRID: '위성+지명', TERRAIN: '지형' };
const KEY = 'aptlog.mapControls';

const type = ref('NORMAL');
const layers = ref({ cadastral: false, traffic: false });
const open = ref(false);

onMounted(() => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s?.type && TYPES[s.type]) type.value = s.type;
    if (s?.layers) layers.value = { ...layers.value, ...s.layers };
  } catch {
    /* 기본값 */
  }
  emit('map-type', type.value);
  for (const [k, on] of Object.entries(layers.value)) if (on) emit('layer', k, true);
});
watch([type, layers], () => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ type: type.value, layers: layers.value }));
  } catch {
    /* 무시 */
  }
}, { deep: true });

function setType(t) {
  type.value = t;
  emit('map-type', t);
}
function toggle(name) {
  layers.value = { ...layers.value, [name]: !layers.value[name] };
  emit('layer', name, layers.value[name]);
}
</script>

<template>
  <div class="map-controls">
    <div v-if="open" class="sheet" role="group" aria-label="지도 설정">
      <p class="cap">지도 유형</p>
      <div class="seg">
        <button v-for="(l, t) in TYPES" :key="t" type="button" :class="{ on: type === t }" :aria-pressed="type === t" @click="setType(t)">{{ l }}</button>
      </div>
      <p class="cap">겹쳐 보기</p>
      <label class="tg"><input type="checkbox" :checked="layers.cadastral" @change="toggle('cadastral')" /> 지적편집도 <small>필지·용도지역</small></label>
      <label class="tg"><input type="checkbox" :checked="layers.traffic" @change="toggle('traffic')" /> 실시간 교통</label>
    </div>
    <div class="stack">
      <button type="button" class="ctl" :class="{ on: open || type !== 'NORMAL' || layers.cadastral || layers.traffic }" title="지도 유형·레이어" aria-label="지도 유형·레이어" @click="open = !open">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 8l10 5 10-5-10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
      </button>
      <button type="button" class="ctl" title="내 단지 모두 보기" aria-label="내 단지 모두 보기" @click="emit('fit-all')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /><circle cx="12" cy="12" r="2.4" fill="currentColor" /></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.map-controls { position: absolute; right: 12px; bottom: 36px; z-index: 15; display: flex; align-items: flex-end; gap: 8px; }
.stack { display: flex; flex-direction: column; border-radius: 10px; overflow: hidden; box-shadow: var(--shadow-float); background: var(--panel); }
.ctl { width: 40px; height: 40px; border: 0; background: var(--panel); color: var(--ink); display: grid; place-items: center; }
.ctl + .ctl { border-top: 1px solid var(--line); }
.ctl:hover { background: var(--surface-2); }
.ctl.on { color: var(--accent); }
.ctl svg { width: 20px; height: 20px; }
.sheet { width: 236px; background: var(--panel); border-radius: 12px; box-shadow: var(--shadow-float); padding: 12px 14px 10px; }
.cap { margin: 0 0 6px; font-size: 11.5px; color: var(--muted); font-weight: 600; }
.cap + .seg { margin-bottom: 12px; }
.seg { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; }
.seg button { border: 1px solid var(--line); background: var(--panel); border-radius: 8px; padding: 6px 4px; font-size: 12.5px; }
.seg button.on { background: var(--ink); border-color: var(--ink); color: #fff; }
.tg { display: flex; align-items: center; gap: 6px; font-size: 13px; padding: 4px 0; cursor: pointer; }
.tg small { color: var(--muted); font-size: 11.5px; }
</style>
