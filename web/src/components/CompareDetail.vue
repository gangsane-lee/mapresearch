<script setup>
// 다중 단지 상세 비교 (계획서 §7.3): 지표 겹침 라인, 기준일 바, 등급 레이더, 변경분 행렬, 비교 결론 저장
import { computed, onMounted, ref, watch } from 'vue';
import EChart from '../charts/EChart.vue';
import { multiLineOption, barOption, radarOption, eok } from '../charts/options.js';
import { api } from '../api/client.js';
import { formatMan, formatDeltaMan } from '../util/format.js';
import { enumOrd } from '../util/compare.js';

const props = defineProps({ ids: { type: Array, required: true } });

const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const asOf = ref(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
const cmp = ref(null);
const series = ref(new Map()); // complexId → price_ask 관측값
const error = ref(null);
const saved = ref(null);
const form = ref({ title: '', conclusion: '' });
const history = ref([]);

async function load() {
  error.value = null;
  try {
    cmp.value = await api(`/api/compare?ids=${props.ids.join(',')}&asOf=${asOf.value}`);
    const all = await Promise.all(props.ids.map((id) => api(`/api/complexes/${id}/series?fields=price_ask`)));
    series.value = new Map(props.ids.map((id, i) => [id, all[i].items]));
    history.value = (await api('/api/comparisons')).items.filter((c) => c.items.some((i) => props.ids.includes(i.complexId)));
  } catch (err) {
    error.value = err.message;
  }
}
onMounted(load);
watch(() => props.ids.join(','), load);

const items = computed(() => cmp.value?.items ?? []);

const lineOpt = computed(() =>
  multiLineOption(
    items.value.map((it) => ({
      name: `${it.displayNm} ${it.areaTypes.find((a) => a.areaTypeId === it.areaTypeId)?.label ?? ''}`,
      points: (series.value.get(it.complexId) ?? []).filter((s) => s.areaTypeId === it.areaTypeId && s.observedAt <= asOf.value),
    })),
    { unit: '억', valueFmt: eok, step: true },
  ),
);
const barOpt = computed(() => barOption(items.value.map((i) => i.displayNm), items.value.map((i) => i.values.price_ask?.value ?? null), { unit: '억', valueFmt: eok }));
const GRADES = ['grade_traffic', 'grade_env', 'grade_edu'];
const radarOpt = computed(() =>
  radarOption(
    items.value.map((i) => ({ name: i.displayNm, values: GRADES.map((cd) => enumOrd(cmp.value.enums, cd, i.values[cd]?.value)) })),
    ['교통', '환경', '학군'],
  ),
);

/** 변경분 행렬: 직전 대비 호가 증감 + 각 항목 관측일 */
const MATRIX = [
  ['price_ask', '호가'],
  ['price_last_trade', '최근 실거래'],
  ['grade_traffic', '교통 등급'],
  ['grade_env', '환경 등급'],
  ['grade_edu', '학군 등급'],
];

async function saveComparison() {
  saved.value = null;
  try {
    const r = await api('/api/comparisons', {
      method: 'POST',
      body: {
        asOf: asOf.value,
        title: form.value.title.trim() || `${items.value.map((i) => i.displayNm).join(' vs ')}`,
        conclusion: form.value.conclusion.trim() || null,
        items: items.value.map((i) => ({ complexId: i.complexId, areaTypeId: i.areaTypeId })),
      },
    });
    saved.value = `비교 기록 #${r.comparisonId} 저장됨`;
    await load();
  } catch (err) {
    error.value = err.message;
  }
}
</script>

<template>
  <div class="cmp">
    <div class="toolbar">
      <label>기준일 <input v-model="asOf" type="date" @change="load" /></label>
      <span class="muted small">각 단지의 기준일 이전 최신 스냅샷 값으로 비교합니다.</span>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <div v-if="cmp" class="grid2">
      <section>
        <h3>호가 추이 (대표/선택 평형)</h3>
        <EChart :option="lineOpt" :empty="![...series.values()].some((s) => s.length)" empty-text="호가 기록이 없습니다" />
      </section>
      <section>
        <h3>기준일 호가</h3>
        <EChart :option="barOpt" :empty="!items.some((i) => i.values.price_ask)" empty-text="기준일 이전 호가가 없습니다" />
      </section>
      <section>
        <h3>등급 레이더</h3>
        <EChart :option="radarOpt" height="300px" :empty="!items.some((i) => GRADES.some((g) => i.values[g]))" empty-text="등급 기록이 없습니다" />
      </section>
      <section>
        <h3>변경분·관측일</h3>
        <table class="tbl">
          <thead>
            <tr><th /><th v-for="i in items" :key="i.complexId">{{ i.displayNm }}</th></tr>
          </thead>
          <tbody>
            <tr>
              <th>호가 직전 대비</th>
              <td v-for="i in items" :key="i.complexId" :class="i.derived.askDelta > 0 ? 'up' : i.derived.askDelta < 0 ? 'down' : ''">
                {{ formatDeltaMan(i.derived.askDelta) || '-' }} <small v-if="i.derived.askDeltaPrevAt" class="muted">vs {{ i.derived.askDeltaPrevAt }}</small>
              </td>
            </tr>
            <tr>
              <th>괴리율</th>
              <td v-for="i in items" :key="i.complexId">{{ i.derived.gapPct == null ? '-' : `${i.derived.gapPct}%` }}</td>
            </tr>
            <tr v-for="[cd, label] in MATRIX" :key="cd">
              <th>{{ label }}</th>
              <td v-for="i in items" :key="i.complexId">
                {{ cd.startsWith('price') ? formatMan(i.values[cd]?.value) : (i.values[cd]?.value ?? '-') }}
                <small class="muted">{{ i.values[cd]?.observedAt ?? '' }}{{ i.values[cd]?.carried ? ' 복사' : '' }}</small>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <section class="conclusion">
      <h3>비교평가 결론</h3>
      <input v-model="form.title" maxlength="100" placeholder="제목 (비우면 단지명 나열)" />
      <textarea v-model="form.conclusion" rows="4" maxlength="4000" placeholder="교통·학군·환경·가격을 종합한 결론" />
      <div class="toolbar">
        <button type="button" class="btn primary" :disabled="!items.length" @click="saveComparison">비교 기록 저장</button>
        <span v-if="saved" class="muted">{{ saved }}</span>
      </div>
      <div v-if="history.length">
        <h4>이 단지들이 포함된 비교 기록</h4>
        <article v-for="h in history" :key="h.comparisonId" class="hist">
          <b>{{ h.title }}</b> <small class="muted">기준일 {{ h.asOf }} · {{ h.items.map((i) => i.displayNm).join(', ') }}</small>
          <p v-if="h.conclusion">{{ h.conclusion }}</p>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
@media (max-width: 900px) { .grid2 { grid-template-columns: 1fr; } }
h3 { font-size: 15px; margin: 0 0 8px; }
h4 { font-size: 14px; margin: 16px 0 6px; }
.tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.tbl th, .tbl td { padding: 5px 6px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
.tbl tbody th { color: var(--muted); font-weight: 500; }
.conclusion { margin-top: 24px; display: flex; flex-direction: column; gap: 8px; }
.conclusion input, .conclusion textarea { padding: 8px; border: 1px solid var(--line); border-radius: 6px; font: inherit; }
.hist { border-top: 1px solid var(--line); padding: 6px 0; }
.hist p { margin: 4px 0; white-space: pre-wrap; }
.small { font-size: 12px; }
.err { color: var(--up); }
input[type='date'] { padding: 4px 6px; border: 1px solid var(--line); border-radius: 6px; }
</style>
