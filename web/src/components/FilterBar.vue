<script setup>
// 상태(파이프라인 A1)·태그 필터
import { STATUS } from '../util/format.js';

defineProps({
  statusFilter: { type: Set, required: true },
  tagFilter: { type: Set, required: true },
  tags: { type: Array, required: true },
  flaggedOnly: { type: Boolean, default: false },
  flaggedCount: { type: Number, default: 0 },
});
const emit = defineEmits(['toggle-status', 'toggle-tag', 'toggle-flagged']);
</script>

<template>
  <div class="filters">
    <button
      v-if="flaggedCount"
      type="button"
      class="chip flag"
      :class="{ on: flaggedOnly }"
      title="호가가 실거래보다 크게 낮거나, 최근 실거래가 하락한 단지"
      @click="emit('toggle-flagged')"
    >
      ! 가격 알림 {{ flaggedCount }}
    </button>
    <button
      v-for="(s, code) in STATUS"
      :key="code"
      type="button"
      class="chip"
      :class="{ on: statusFilter.has(code) }"
      :style="{ borderColor: s.color }"
      @click="emit('toggle-status', code)"
    >
      {{ s.label }}
    </button>
    <template v-if="tags.length">
      <span class="sep" />
      <button
        v-for="t in tags"
        :key="t"
        type="button"
        class="chip"
        :class="{ on: tagFilter.has(t) }"
        @click="emit('toggle-tag', t)"
      >
        #{{ t }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.filters { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.chip.flag { border-color: var(--warn); color: var(--warn); }
.chip.flag.on { background: var(--warn); color: #fff; }
.sep { width: 1px; height: 18px; background: var(--line); margin: 0 4px; }
</style>
