<script setup>
// 지도 우클릭 위치의 단지 정보 카드 — 후보를 보여주고 바로 단지 추가로 이어준다.
// 후보·주소는 역지오코딩 + 단지 식별정보로 만든 제안값 (저장은 단지 추가 폼에서 확인 후).
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { formatMan } from '../util/format.js';
import { ageLabel } from '../util/compare.js';

const props = defineProps({
  point: { type: Object, required: true }, // { x, y } 지도 요소 기준 px
  loading: { type: Boolean, default: false },
  error: { type: String, default: null },
  place: { type: Object, default: null },
  candidates: { type: Array, default: () => [] },
});
const emit = defineEmits(['close', 'add', 'open']);

const MATCH = { EXACT: '같은 지번', SAME_BON: '같은 본번', NAME: '건물명 일치', NEARBY: '주변 필지' };
// 정확히 맞는 후보가 있으면 주변 필지 후보는 접어서 혼동을 줄인다
const exact = computed(() => props.candidates.filter((c) => c.match !== 'NEARBY'));
const nearby = computed(() => props.candidates.filter((c) => c.match === 'NEARBY'));

const style = computed(() => ({
  left: `clamp(8px, ${props.point.x + 14}px, calc(100% - 348px))`,
  top: `clamp(8px, ${props.point.y - 20}px, calc(100% - 440px))`,
}));

const onKey = (e) => e.key === 'Escape' && emit('close');
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <aside class="place-card" :style="style" aria-label="이 위치의 단지" @contextmenu.prevent>
    <header>
      <div>
        <small>이 위치</small>
        <b>{{ place?.jibunAddr ?? (loading ? '주소 찾는 중…' : '주소 없음') }}</b>
        <small v-if="place?.roadAddr" class="road">{{ place.roadAddr }}</small>
      </div>
      <button type="button" class="close" aria-label="닫기" @click="emit('close')">×</button>
    </header>

    <p v-if="loading" class="state">단지 식별정보를 찾는 중…</p>
    <p v-else-if="error" class="state err">{{ error }}</p>
    <template v-else>
      <ul v-if="candidates.length" class="cands">
        <li v-for="c in exact.length ? exact : nearby" :key="c.danjiId">
          <div class="top">
            <b class="nm">{{ c.name }}</b>
            <span class="badge" :class="c.match.toLowerCase()">{{ MATCH[c.match] }}</span>
          </div>
          <p class="meta">
            <span>{{ c.useAprDay ? ageLabel(c.useAprDay) : '연식 -' }}</span>
            <span>{{ c.hhldCnt ? `${c.hhldCnt.toLocaleString()}세대` : '세대 -' }}</span>
            <span>{{ c.dongCnt ? `${c.dongCnt}개 동` : '동 -' }}</span>
          </p>
          <p class="trade">
            <template v-if="c.lastTrade">
              최근 실거래 <b>{{ formatMan(c.lastTrade.amountMan) }}</b>
              <small>{{ c.lastTrade.dealDate }} · 전용 {{ c.lastTrade.exclM2 }}㎡ · 수집 {{ c.tradeCnt }}건</small>
            </template>
            <small v-else>수집된 실거래 없음 (등록 화면에서 받기)</small>
          </p>
          <div class="act">
            <button v-if="c.complexId" type="button" class="btn" @click="emit('open', c.complexId)">등록된 단지 보기</button>
            <button v-else type="button" class="btn primary" @click="emit('add', c.danjiId)">이 단지 추가</button>
          </div>
        </li>
        <li v-if="exact.length && nearby.length" class="more">주변 필지 후보 {{ nearby.length }}개는 단지 추가 화면에서 검색할 수 있습니다.</li>
      </ul>
      <div v-else class="empty">
        <p>단지 식별정보에 없는 위치입니다.</p>
        <button type="button" class="btn" @click="emit('add', null)">이 위치로 직접 추가</button>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.place-card {
  position: absolute; z-index: 30; width: 340px; max-height: 440px; display: flex; flex-direction: column;
  background: var(--panel); border-radius: 12px; box-shadow: var(--shadow-float); overflow: hidden;
  animation: pop 0.16s ease-out;
}
header { display: flex; align-items: flex-start; gap: 8px; padding: 14px 16px 12px; background: var(--ink); color: #fff; }
header div { flex: 1; min-width: 0; }
header small { display: block; font-size: 11.5px; color: var(--champagne); }
header small.road { color: rgb(255 255 255 / 0.6); margin-top: 2px; }
header b { display: block; font-size: 14px; font-weight: 600; line-height: 1.4; }
.close { border: 0; background: none; color: rgb(255 255 255 / 0.7); font-size: 20px; line-height: 1; padding: 0 2px; }
.close:hover { color: #fff; }
.state { margin: 0; padding: 18px 16px; color: var(--muted); font-size: 13px; }
.state.err { color: var(--up); }
.cands { list-style: none; margin: 0; padding: 0; overflow: auto; }
.cands li { padding: 14px 16px; }
.cands li + li { border-top: 1px solid var(--line); }
.top { display: flex; align-items: center; gap: 8px; }
.nm { font-family: var(--serif); font-size: 16px; font-weight: 700; letter-spacing: -0.02em; flex: 1; }
.badge { font-size: 11px; padding: 2px 7px; border-radius: 999px; background: var(--surface-2); color: var(--muted); border: 1px solid var(--line); white-space: nowrap; }
.badge.exact { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.badge.same_bon, .badge.name { background: var(--tint-info); color: var(--down); border-color: transparent; }
.meta { display: flex; margin: 6px 0 0; font-size: 12.5px; color: var(--muted); }
.meta span + span::before { content: ''; display: inline-block; width: 1px; height: 9px; background: var(--line-strong); margin: 0 8px; }
.trade { margin: 8px 0 0; font-size: 12.5px; }
.trade b { font-size: 14px; margin: 0 4px; }
.trade small { color: var(--muted); }
.act { margin-top: 10px; display: flex; justify-content: flex-end; }
.more { font-size: 12px; color: var(--muted); background: var(--surface-2); }
.empty { padding: 16px; }
.empty p { margin: 0 0 10px; color: var(--muted); font-size: 13px; }
@keyframes pop { from { opacity: 0; transform: translateY(4px); } }
</style>
