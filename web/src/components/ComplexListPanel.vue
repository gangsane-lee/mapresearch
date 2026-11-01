<script setup>
// 지도 왼쪽 "내 단지" 목록 (카카오맵 사이드바처럼 지도 위에 떠 있는 패널)
// 검색·정렬, 오래된 관측(업데이트 필요) 표시. 누르면 지도를 그 단지로 옮기고 선택한다.
import { computed, ref } from 'vue';
import { STATUS, formatMan, formatDeltaMan } from '../util/format.js';

const props = defineProps({
  items: { type: Array, required: true }, // 필터를 거친 요약 목록
  selectedIds: { type: Array, default: () => [] },
  staleDays: { type: Number, default: 30 },
});
const emit = defineEmits(['focus', 'collapse']);

const q = ref('');
const sort = ref('recent');
const SORTS = {
  recent: '최근 기록순',
  stale: '업데이트 필요순',
  priceDesc: '호가 높은순',
  priceAsc: '호가 낮은순',
  name: '이름순',
};

const today = new Date();
const daysSince = (ymd) => (ymd ? Math.floor((today - new Date(`${ymd}T00:00:00`)) / 86400000) : null);
const isStale = (c) => {
  const d = daysSince(c.lastObservedAt);
  return d == null || d > props.staleDays;
};
function ago(ymd) {
  const d = daysSince(ymd);
  if (d == null) return '기록 없음';
  if (d <= 0) return '오늘';
  if (d < 30) return `${d}일 전`;
  if (d < 365) return `${Math.floor(d / 30)}개월 전`;
  return `${Math.floor(d / 365)}년 전`;
}

const rows = computed(() => {
  const k = q.value.trim().toLowerCase();
  const list = props.items.filter(
    (c) => !k || [c.displayNm, c.sggNm, ...(c.tags ?? [])].some((v) => String(v ?? '').toLowerCase().includes(k)),
  );
  const by = {
    recent: (a, b) => String(b.lastObservedAt ?? '').localeCompare(String(a.lastObservedAt ?? '')),
    stale: (a, b) => String(a.lastObservedAt ?? '').localeCompare(String(b.lastObservedAt ?? '')),
    priceDesc: (a, b) => (b.priceAsk ?? -1) - (a.priceAsk ?? -1),
    priceAsc: (a, b) => (a.priceAsk ?? Infinity) - (b.priceAsk ?? Infinity),
    name: (a, b) => a.displayNm.localeCompare(b.displayNm, 'ko'),
  }[sort.value];
  // ★ 관심 단지를 먼저
  return list.toSorted((a, b) => Number(!!b.isFavorite) - Number(!!a.isFavorite) || by(a, b));
});
const staleCount = computed(() => props.items.filter(isStale).length);
</script>

<template>
  <section class="list-panel" aria-label="내 단지 목록">
    <header>
      <h2>내 단지 <b>{{ items.length }}</b></h2>
      <span v-if="staleCount" class="stale-sum" :title="`관측 ${staleDays}일 경과 또는 기록 없음`">업데이트 필요 {{ staleCount }}</span>
      <button type="button" class="fold" aria-label="목록 접기" title="목록 접기" @click="emit('collapse')">‹</button>
    </header>
    <div class="tools">
      <input v-model="q" type="search" placeholder="단지명·지역·태그" aria-label="내 단지 검색" />
      <select v-model="sort" aria-label="정렬">
        <option v-for="(l, k) in SORTS" :key="k" :value="k">{{ l }}</option>
      </select>
    </div>
    <ol v-if="rows.length" class="rows">
      <li v-for="c in rows" :key="c.complexId">
        <button
          type="button"
          class="row"
          :class="{ on: selectedIds.includes(c.complexId) }"
          @click="emit('focus', c, { multi: $event.ctrlKey || $event.metaKey })"
        >
          <span class="dot" :style="{ background: STATUS[c.status]?.color }" :title="STATUS[c.status]?.label" />
          <span class="main">
            <span class="nm">
              <span v-if="c.isFavorite" class="fav" title="관심">★</span>{{ c.displayNm }}
              <span v-if="c.flags?.length" class="flag" :title="c.flags.map((f) => f.label).join(', ')">!</span>
            </span>
            <span class="meta">{{ c.sggNm ?? '' }}{{ c.areaLabel ? ` · ${c.areaLabel}` : '' }}{{ c.hhldCnt ? ` · ${c.hhldCnt.toLocaleString()}세대` : '' }}</span>
          </span>
          <span class="right">
            <span class="price">{{ c.priceAsk != null ? formatMan(c.priceAsk) : '—' }}</span>
            <span v-if="c.priceAskDelta" class="delta" :class="c.priceAskDelta > 0 ? 'up' : 'down'">{{ formatDeltaMan(c.priceAskDelta) }}</span>
            <span class="when" :class="{ stale: isStale(c) }">{{ isStale(c) && c.lastObservedAt ? '업데이트 필요' : ago(c.lastObservedAt) }}</span>
          </span>
        </button>
      </li>
    </ol>
    <p v-else class="empty">
      <template v-if="items.length">"{{ q }}"에 맞는 단지가 없습니다.</template>
      <template v-else>아직 등록한 단지가 없습니다.<br />지도를 <b>우클릭</b>하거나 오른쪽 위 <b>단지 추가</b>로 시작하세요.</template>
    </p>
  </section>
</template>

<style scoped>
.list-panel {
  position: absolute; top: 12px; left: 12px; bottom: 12px; z-index: 15; width: 340px;
  display: flex; flex-direction: column; background: var(--panel); border-radius: 14px;
  box-shadow: var(--shadow-float); overflow: hidden;
}
header { display: flex; align-items: center; gap: 8px; padding: 14px 12px 10px 16px; }
h2 { margin: 0; font-size: 15px; font-weight: 700; flex: 1; letter-spacing: -0.02em; }
h2 b { color: var(--accent); margin-left: 2px; }
.stale-sum { font-size: 11.5px; color: var(--warn); background: var(--tint-warn); border-radius: 999px; padding: 2px 8px; font-weight: 600; }
.fold { border: 0; background: var(--surface-2); color: var(--muted); width: 26px; height: 26px; border-radius: 8px; font-size: 16px; line-height: 1; }
.fold:hover { color: var(--ink); }
.tools { display: flex; gap: 6px; padding: 0 12px 10px; border-bottom: 1px solid var(--line); }
.tools input { flex: 1; min-width: 0; border: 1px solid var(--line); background: var(--surface-2); border-radius: 8px; padding: 7px 10px; font-size: 13px; }
.tools select { border: 1px solid var(--line); background: var(--panel); border-radius: 8px; padding: 6px 6px; font-size: 12.5px; color: var(--muted); }
.rows { list-style: none; margin: 0; padding: 4px 0; overflow: auto; flex: 1; }
.row {
  display: grid; grid-template-columns: 8px 1fr auto; gap: 10px; align-items: center; width: 100%;
  padding: 10px 14px 10px 16px; border: 0; background: none; text-align: left; border-left: 3px solid transparent;
}
.row:hover { background: var(--surface-2); }
.row.on { background: var(--accent-soft); border-left-color: var(--accent); }
.dot { width: 8px; height: 8px; border-radius: 50%; }
.main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.nm { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fav { color: var(--accent); margin-right: 3px; }
.flag { display: inline-grid; place-items: center; width: 15px; height: 15px; border-radius: 50%; background: var(--champagne); color: var(--ink); font-size: 10px; font-weight: 800; margin-left: 4px; vertical-align: 1px; }
.meta { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.right { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }
.price { font-family: var(--serif); font-weight: 700; font-size: 15px; color: var(--ink); }
.delta { font-size: 11px; font-weight: 600; }
.when { font-size: 11px; color: var(--muted); }
.when.stale { color: var(--warn); font-weight: 600; }
.empty { padding: 28px 20px; color: var(--muted); font-size: 13px; line-height: 1.7; text-align: center; }
</style>
