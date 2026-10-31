<script setup>
// 구/시 검색 자동완성 (계획서 §7.1 상단)
import { computed, ref } from 'vue';
import { searchRegions } from '../util/regionSearch.js';

const props = defineProps({
  items: { type: Array, required: true },
  current: { type: Object, default: null },
});
const emit = defineEmits(['select', 'clear']);

const query = ref('');
const open = ref(false);
const active = ref(0);
const results = computed(() => searchRegions(props.items, query.value));

function choose(item) {
  emit('select', item);
  query.value = '';
  open.value = false;
}

function onKey(e) {
  if (!results.value.length) return;
  if (e.key === 'ArrowDown') {
    active.value = (active.value + 1) % results.value.length;
    e.preventDefault();
  } else if (e.key === 'ArrowUp') {
    active.value = (active.value - 1 + results.value.length) % results.value.length;
    e.preventDefault();
  } else if (e.key === 'Enter') {
    choose(results.value[active.value]);
  } else if (e.key === 'Escape') {
    open.value = false;
  }
}
</script>

<template>
  <div class="region-search">
    <input
      v-model="query"
      type="search"
      placeholder="구/시 검색 (예: 관악구, 성남시)"
      aria-label="구 또는 시 검색"
      @focus="open = true"
      @input="(open = true), (active = 0)"
      @keydown="onKey"
      @blur="open = false"
    />
    <ul v-if="open && results.length" class="dropdown" role="listbox">
      <li
        v-for="(r, i) in results"
        :key="r.key"
        role="option"
        :aria-selected="i === active"
        :class="{ active: i === active }"
        @mousedown.prevent="choose(r)"
      >
        <span>{{ r.label }}</span>
        <small class="muted">{{ r.sub }}</small>
      </li>
    </ul>
    <span v-if="current" class="current chip on">
      {{ current.label }}
      <button type="button" aria-label="구 선택 해제" @click="emit('clear')">×</button>
    </span>
  </div>
</template>

<style scoped>
.region-search { position: relative; display: flex; align-items: center; gap: 8px; }
input { width: 260px; padding: 7px 10px; border: 1px solid var(--line); border-radius: var(--radius); }
.dropdown {
  position: absolute; top: 100%; left: 0; z-index: 50; width: 260px; margin: 4px 0 0; padding: 4px 0;
  list-style: none; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.12); max-height: 360px; overflow: auto;
}
.dropdown li { display: flex; justify-content: space-between; padding: 6px 10px; cursor: pointer; }
.dropdown li.active, .dropdown li:hover { background: #eff6ff; }
.current button { border: 0; background: none; color: inherit; padding: 0 0 0 4px; }
</style>
