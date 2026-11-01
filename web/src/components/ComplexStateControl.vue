<script setup>
// ★ 관심 토글 + 진행 상태 변경 (요약 패널·상세 팝업 공용). 저장 즉시 지도 마커·필터에 반영
import { ref } from 'vue';
import { STATUS } from '../util/format.js';
import { useComplexesStore } from '../stores/complexes.js';

const props = defineProps({
  complexId: { type: Number, required: true },
  status: { type: String, required: true },
  isFavorite: { type: Boolean, default: false },
  /** 잉크 바탕(요약 패널 히어로) 위에 놓일 때 */
  dark: { type: Boolean, default: false },
});
const emit = defineEmits(['changed']);
const store = useComplexesStore();
const busy = ref(false);
const error = ref(null);

async function patch(body) {
  busy.value = true;
  error.value = null;
  try {
    await store.patch(props.complexId, body);
    emit('changed', body);
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="state" :class="{ dark }">
    <button
      type="button"
      class="fav"
      :class="{ on: isFavorite }"
      :aria-pressed="isFavorite"
      :disabled="busy"
      :title="isFavorite ? '관심 해제' : '관심 등록'"
      @click="patch({ isFavorite: !isFavorite })"
    >
      {{ isFavorite ? '★' : '☆' }} 관심
    </button>
    <label class="status">
      <span class="dot" :style="{ background: STATUS[status]?.color }" aria-hidden="true" />
      <select :value="status" :disabled="busy" aria-label="진행 상태" @change="patch({ status: $event.target.value })">
        <option v-for="(s, code) in STATUS" :key="code" :value="code">{{ s.label }}</option>
      </select>
    </label>
    <small v-if="error" class="err">{{ error }}</small>
  </div>
</template>

<style scoped>
.state { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fav {
  border: 1px solid var(--line-strong); background: var(--panel); color: var(--muted);
  border-radius: 999px; padding: 3px 11px; font-size: 12.5px; font-weight: 600;
}
.fav.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.fav:not(.on):hover { color: var(--accent); border-color: var(--accent); }
.status { position: relative; display: inline-flex; align-items: center; }
.status .dot { position: absolute; left: 10px; width: 7px; height: 7px; border-radius: 50%; pointer-events: none; }
.status select {
  appearance: none; border: 1px solid var(--line-strong); background: var(--panel); color: var(--text);
  border-radius: 999px; padding: 3px 24px 3px 23px; font-size: 12.5px; cursor: pointer;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position: calc(100% - 12px) 50%, calc(100% - 8px) 50%; background-size: 4px 4px; background-repeat: no-repeat;
}
.dark .fav { background: rgb(255 255 255 / 0.08); border-color: rgb(255 255 255 / 0.25); color: rgb(255 255 255 / 0.85); }
.dark .fav.on { background: var(--champagne); border-color: var(--champagne); color: var(--ink); }
.dark .status select { background-color: rgb(255 255 255 / 0.08); border-color: rgb(255 255 255 / 0.25); color: #fff; }
.dark .status select option { color: var(--text); }
.err { color: var(--up); font-size: 12px; }
.dark .err { color: #f5a493; }
</style>
