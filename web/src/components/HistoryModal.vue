<script setup>
// 저장 이력 — 스냅샷(=보고서의 원본)을 저장한 시각 순으로 보여 주고, 고르면 그 시점의 스냅샷·보고서로 이동한다.
// 스냅샷은 수정되지 않으므로(INSERT만) 이력이 곧 보고서 버전 이력이다: 정정본은 원본을 대체한 새 버전, 무효화는 목록에서 빠진 버전.
import { computed, onMounted, ref } from 'vue';
import Modal from './Modal.vue';
import { api } from '../api/client.js';

const props = defineProps({
  complexId: { type: Number, required: true },
  name: { type: String, default: '' },
});
const emit = defineEmits(['close', 'open-snapshot', 'correct']);

const items = ref(null);
const error = ref(null);
const showVoided = ref(false);
const SOURCE = { VISIT: '임장', ONLINE: '온라인', AGENT: '중개사' };

onMounted(async () => {
  try {
    items.value = (await api(`/api/complexes/${props.complexId}/snapshots?includeVoid=1`)).items;
  } catch (err) {
    error.value = err.message;
  }
});

// 저장 시각(입력 시각) 최신순
const rows = computed(() =>
  (items.value ?? [])
    .filter((s) => showVoided.value || !s.voided)
    .toSorted((a, b) => String(b.inputAt).localeCompare(String(a.inputAt)) || b.snapshotId - a.snapshotId),
);
const voidedCount = computed(() => (items.value ?? []).filter((s) => s.voided).length);
const latestActive = computed(() => rows.value.find((s) => !s.voided)?.snapshotId ?? null);

const pad = (n) => String(n).padStart(2, '0');
function savedAt(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v ?? '-');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const reportUrl = (s) => `/report/${props.complexId}?asOf=${s.observedAt}`;
</script>

<template>
  <Modal :title="`저장 이력 — ${name}`" size="lg" @close="emit('close')">
    <p v-if="error" class="err">{{ error }}</p>
    <p v-else-if="!items" class="muted">불러오는 중…</p>
    <template v-else>
      <div class="toolbar">
        <span class="muted">저장 {{ rows.length }}건 · 스냅샷은 고치지 않고 정정본을 새로 저장해 이력을 남깁니다.</span>
        <label v-if="voidedCount" class="small"><input v-model="showVoided" type="checkbox" /> 무효화 {{ voidedCount }}건 표시</label>
      </div>
      <p v-if="!rows.length" class="muted empty">저장한 스냅샷이 없습니다. 요약 패널의 "새 스냅샷"으로 첫 기록을 남기세요.</p>
      <table v-else class="tbl">
        <thead>
          <tr><th>저장 시각</th><th>관측일</th><th>출처</th><th>구분</th><th>메모</th><th>값</th><th /></tr>
        </thead>
        <tbody>
          <tr v-for="s in rows" :key="s.snapshotId" :class="{ voided: s.voided, latest: s.snapshotId === latestActive }" @click="emit('open-snapshot', s.snapshotId)">
            <td class="nowrap"><b>{{ savedAt(s.inputAt) }}</b></td>
            <td class="nowrap">{{ s.observedAt }}</td>
            <td>{{ SOURCE[s.source] ?? s.source }}</td>
            <td class="nowrap">
              <span v-if="s.voided" class="tag bad" :title="s.voidReason">무효</span>
              <span v-else-if="s.supersedesId" class="tag">정정본 · 원본 #{{ s.supersedesId }}</span>
              <span v-else class="tag plain">기록</span>
              <span v-if="s.snapshotId === latestActive" class="tag now">최신</span>
            </td>
            <td class="memo">{{ s.memo ?? '' }}<small v-if="s.voided && s.voidReason" class="err"> 사유: {{ s.voidReason }}</small></td>
            <td class="nowrap muted small">관측 {{ s.observedCnt }} · 복사 {{ s.carriedCnt }}</td>
            <td class="act" @click.stop>
              <button type="button" class="btn ghost" @click="emit('open-snapshot', s.snapshotId)">스냅샷</button>
              <a class="btn ghost" :href="reportUrl(s)" target="_blank" rel="noopener">보고서</a>
              <button v-if="!s.voided" type="button" class="btn ghost" @click="emit('correct', s.snapshotId)">수정</button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </Modal>
</template>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; font-size: 13px; }
.small { font-size: 12.5px; color: var(--muted); display: flex; gap: 4px; align-items: center; }
.empty { padding: 24px 0; }
.tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.tbl th { text-align: left; font-weight: 600; color: var(--muted); font-size: 12px; padding: 6px 8px; border-bottom: 1px solid var(--line-strong); }
.tbl td { padding: 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.tbl tbody tr { cursor: pointer; }
.tbl tbody tr:hover { background: var(--surface-2); }
.tbl tr.latest td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
.tbl tr.voided { opacity: 0.55; }
.nowrap { white-space: nowrap; }
.memo { max-width: 260px; color: var(--muted); }
.tag { display: inline-block; font-size: 11.5px; padding: 1px 7px; border-radius: 999px; background: var(--tint-info); color: var(--down); margin-right: 4px; }
.tag.plain { background: var(--surface-2); color: var(--muted); }
.tag.bad { background: var(--tint-bad); color: var(--up); }
.tag.now { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.act { white-space: nowrap; text-align: right; }
.act .btn { padding: 3px 8px; font-size: 12.5px; }
.err { color: var(--up); }
</style>
