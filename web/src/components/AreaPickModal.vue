<script setup>
// Ctrl+드래그 영역에 단지가 AREA_PICK개를 넘을 때: 기본 정보를 보고 비교할 단지를 고른다.
import { computed, ref } from 'vue';
import Modal from './Modal.vue';
import { STATUS, formatMan, formatDeltaMan } from '../util/format.js';
import { ageLabel } from '../util/compare.js';
import { AREA_PICK } from '../map/areaSelect.js';

const props = defineProps({
  items: { type: Array, required: true }, // complexes 요약 (listSummary)
});
const emit = defineEmits(['close', 'pick']);

const picked = ref([]);
const full = computed(() => picked.value.length >= AREA_PICK);

function toggle(id) {
  if (picked.value.includes(id)) picked.value = picked.value.filter((x) => x !== id);
  else if (!full.value) picked.value = [...picked.value, id];
}

const statusOf = (c) => STATUS[c.status] ?? STATUS.INTEREST;
const signCls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
</script>

<template>
  <Modal :title="`영역 안 단지 ${items.length}개`" size="lg" @close="emit('close')">
    <p class="lead">비교할 단지 {{ AREA_PICK }}개를 고르세요.</p>
    <ul class="list">
      <li v-for="c in items" :key="c.complexId">
        <label class="row" :class="{ on: picked.includes(c.complexId), off: full && !picked.includes(c.complexId) }">
          <input
            type="checkbox"
            :checked="picked.includes(c.complexId)"
            :disabled="full && !picked.includes(c.complexId)"
            :aria-label="`${c.displayNm} 선택`"
            @change="toggle(c.complexId)"
          />
          <span class="name">
            <b>{{ c.displayNm }}</b>
            <small><i class="dot" :style="{ background: statusOf(c).color }" />{{ statusOf(c).label }}<template v-if="c.sggNm"> · {{ c.sggNm }}</template></small>
          </span>
          <span class="cell">
            <small>{{ c.areaLabel ?? '대표 평형' }} 호가</small>
            <b>{{ formatMan(c.priceAsk) }}</b>
            <em v-if="c.priceAskDelta" :class="signCls(c.priceAskDelta)">{{ formatDeltaMan(c.priceAskDelta) }}</em>
          </span>
          <span class="cell">
            <small>최근 실거래</small>
            <b>{{ formatMan(c.lastTrade?.amountMan) }}</b>
            <em v-if="c.lastTrade">{{ c.lastTrade.dealDate }}</em>
          </span>
          <span class="cell">
            <small>연식</small>
            <b>{{ c.useAprDay ? ageLabel(c.useAprDay) : '-' }}</b>
          </span>
          <span class="cell">
            <small>세대수</small>
            <b>{{ c.hhldCnt ? c.hhldCnt.toLocaleString() : '-' }}</b>
          </span>
        </label>
      </li>
    </ul>
    <template #footer>
      <span class="count">{{ picked.length }} / {{ AREA_PICK }} 선택</span>
      <button type="button" class="btn" @click="emit('close')">취소</button>
      <button type="button" class="btn primary" :disabled="picked.length !== AREA_PICK" @click="emit('pick', picked)">비교하기</button>
    </template>
  </Modal>
</template>

<style scoped>
.lead { margin: 0 0 12px; color: var(--muted); font-size: 13.5px; }
.list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
.list li + li { border-top: 1px solid var(--line); }
.row {
  display: grid; grid-template-columns: 22px minmax(150px, 1.6fr) repeat(2, minmax(96px, 1fr)) repeat(2, minmax(64px, 0.6fr));
  gap: 12px; align-items: center; padding: 12px 14px; cursor: pointer; transition: background-color 0.12s;
}
.row:hover { background: var(--surface-2); }
.row.on { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
.row.off { opacity: 0.5; cursor: not-allowed; }
.name b { display: block; font-family: var(--serif); font-size: 15px; font-weight: 700; letter-spacing: -0.02em; }
.name small { color: var(--muted); font-size: 12px; }
.dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; vertical-align: 1px; }
.cell small { display: block; color: var(--muted); font-size: 11.5px; }
.cell b { font-size: 14px; font-weight: 600; }
.cell em { display: block; font-style: normal; font-size: 11.5px; color: var(--muted); }
.cell em.up { color: var(--up); }
.cell em.down { color: var(--down); }
.count { margin-right: auto; color: var(--muted); font-size: 13px; }
</style>
