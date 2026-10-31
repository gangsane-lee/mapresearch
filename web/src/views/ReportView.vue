<script setup>
// 임장 보고서 (계획서 §10 A5): 첨부 양식 구조 — 기본정보 → 가치평가(교통·환경·학군 + 등급) → 가격 → 부문별 결론 → 종합
// 1개면 단지 보고서, 2~4개면 단지 비교표 + 비교평가 결론. 브라우저 인쇄 → "PDF로 저장"으로 내보낸다.
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api/client.js';
import { formatMan } from '../util/format.js';
import { enumLabel, ageLabel } from '../util/compare.js';
import { weightedScores, weightsFromSettings } from '../util/score.js';

const route = useRoute();
const ids = String(route.params.ids).split(',').map(Number).filter(Boolean).slice(0, 4);
const asOf = route.query.asOf;

const data = ref(null);
const schools = ref(new Map());
const notes = ref(new Map());
const error = ref(null);

onMounted(async () => {
  try {
    data.value = await api(`/api/compare?ids=${ids.join(',')}${asOf ? `&asOf=${asOf}` : ''}`);
    const [sc, nt] = await Promise.all([
      Promise.all(ids.map((id) => api(`/api/complexes/${id}/schools`))),
      Promise.all(ids.map((id) => api(`/api/complexes/${id}/series?fields=note_traffic,note_env,note_edu,note_overall`))),
    ]);
    schools.value = new Map(ids.map((id, i) => [id, sc[i].items.filter((s) => s.current)]));
    // 결론은 기준일 이전 가장 최근 값
    notes.value = new Map(
      ids.map((id, i) => {
        const latest = {};
        for (const s of nt[i].items) if (s.observedAt <= data.value.asOf) latest[s.fieldCd] = s.value;
        return [id, latest];
      }),
    );
    document.title = `임장 보고서 — ${data.value.items.map((x) => x.displayNm).join(' · ')}`;
  } catch (err) {
    error.value = err.message;
  }
});

const printReport = () => window.print();
const items = computed(() => data.value?.items ?? []);
const enums = computed(() => data.value?.enums ?? []);
const v = (i, cd) => i.values[cd]?.value ?? null;
const grade = (i, cd) => enumLabel(enums.value, cd, v(i, cd));
const area = (i) => i.areaTypes.find((a) => a.areaTypeId === i.areaTypeId);
const anchorName = (id) => data.value?.anchors.find((a) => a.anchorId === id)?.name ?? '';
const scores = computed(() => (data.value ? weightedScores(items.value, enums.value, weightsFromSettings(data.value.weights)) : new Map()));
const pct = (n) => (n == null ? '-' : `${n > 0 ? '+' : ''}${n}%`);
const money = (n) => (n == null ? '-' : formatMan(n));
const signed = (n) => (n == null ? '-' : `${n > 0 ? '+' : ''}${formatMan(n)}`);
const conveniences = (i) =>
  [['env_dept', '백화점'], ['env_mart', '대형마트'], ['env_hospital', '종합병원']]
    .map(([cd, l]) => `${l}${v(i, cd) ?? '-'}`)
    .join(', ');
const commuteText = (i) =>
  i.commutes
    .filter((c) => c.mode === 'TRANSIT')
    .map((c) => `${anchorName(c.anchorId)} ${c.minutes}분${c.transfers ? `(환승 ${c.transfers})` : ''}`)
    .join(' / ') || '-';
const distText = (i) => i.distances.map((d) => `${anchorName(d.anchorId)} ${d.km}km`).join(' / ') || '-';
const schoolText = (i) =>
  (schools.value.get(i.complexId) ?? [])
    .map((s) => `${s.schoolNm}${s.latestStat ? ` ${s.latestStat.value}%` : ''}${s.walkMin != null ? ` (도보 ${s.walkMin}분)` : ''}`)
    .join(', ') || '-';
</script>

<template>
  <div class="report">
    <div class="no-print bar">
      <button type="button" class="btn primary" @click="printReport">인쇄 / PDF로 저장</button>
      <span class="muted">인쇄 대화상자에서 "PDF로 저장"을 고르면 파일로 내보낼 수 있습니다.</span>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <template v-if="data">
      <header>
        <h1>{{ items.length === 1 ? '임장 보고서' : '단지 비교 보고서' }}</h1>
        <p>기준일 {{ data.asOf }} · 작성 AptLog</p>
      </header>

      <!-- 단지별 보고서 -->
      <article v-for="i in items" :key="i.complexId" class="complex">
        <h2>{{ i.displayNm }}</h2>

        <h3>1. 기본정보</h3>
        <table>
          <tr><th>위치</th><td>{{ i.sggNm ?? '-' }}</td><th>연식</th><td>{{ ageLabel(i.master.useAprDay) }}</td></tr>
          <tr><th>세대수</th><td>{{ i.master.hhldCnt ?? '-' }}세대</td><th>복도/계단</th><td>{{ i.master.hallType ?? '-' }}</td></tr>
          <tr>
            <th>평형</th><td>{{ area(i)?.label ?? '-' }}{{ area(i)?.rooms != null ? ` 방${area(i).rooms}화${area(i).baths ?? '-'}` : '' }}</td>
            <th>용적률</th><td>{{ i.master.farRatio ?? '-' }}%</td>
          </tr>
          <tr><th>기준점 직선거리</th><td colspan="3">{{ distText(i) }}</td></tr>
        </table>

        <h3>2. 가치평가</h3>
        <table>
          <tr><th>교통 <b class="g">{{ grade(i, 'grade_traffic') }}</b></th>
            <td>{{ commuteText(i) }}<br />최근접 역: {{ v(i, 'trn_station') ?? '-' }}{{ v(i, 'trn_station_walk_min') != null ? ` 도보 ${v(i, 'trn_station_walk_min')}분` : '' }}</td></tr>
          <tr><th>환경 <b class="g">{{ grade(i, 'grade_env') }}</b></th>
            <td>유해시설(반경 3km) {{ v(i, 'env_hazard') == null ? '-' : v(i, 'env_hazard') ? '있음' : '없음' }}{{ v(i, 'env_hazard_memo') ? ` — ${v(i, 'env_hazard_memo')}` : '' }}<br />편의시설: {{ conveniences(i) }}</td></tr>
          <tr><th>학군 <b class="g">{{ grade(i, 'grade_edu') }}</b></th>
            <td>배정 학교: {{ schoolText(i) }}<br />학원가: {{ v(i, 'edu_academy_cnt') ?? '-' }}개</td></tr>
        </table>

        <h3>3. 가격 ({{ area(i)?.label ?? '대표 평형' }})</h3>
        <table>
          <tr><th>현재 호가</th><td>{{ money(v(i, 'price_ask')) }}</td><th>최근 실거래</th><td>{{ money(v(i, 'price_last_trade')) }} {{ v(i, 'price_last_trade_ym') ? `(${String(v(i, 'price_last_trade_ym')).slice(2, 7).replace('-', '.')})` : '' }}</td></tr>
          <tr><th>호가 괴리율</th><td>{{ pct(i.derived.gapPct) }}</td><th>예산 대비</th><td>{{ signed(i.derived.budgetDiff) }}</td></tr>
        </table>

        <h3>4. 부문별 결론</h3>
        <dl>
          <dt>교통</dt><dd>{{ notes.get(i.complexId)?.note_traffic ?? '-' }}</dd>
          <dt>환경</dt><dd>{{ notes.get(i.complexId)?.note_env ?? '-' }}</dd>
          <dt>학군</dt><dd>{{ notes.get(i.complexId)?.note_edu ?? '-' }}</dd>
        </dl>
        <h3>5. 종합 및 느낀점</h3>
        <p class="pre">{{ notes.get(i.complexId)?.note_overall ?? '-' }}</p>
      </article>

      <!-- 비교표 -->
      <article v-if="items.length > 1" class="compare">
        <h2>단지 비교표</h2>
        <table>
          <thead><tr><th /><th v-for="i in items" :key="i.complexId">{{ i.displayNm }}</th></tr></thead>
          <tbody>
            <tr><th>위치·연식</th><td v-for="i in items" :key="i.complexId">{{ i.sggNm }} · {{ ageLabel(i.master.useAprDay) }}</td></tr>
            <tr><th>세대수·복도</th><td v-for="i in items" :key="i.complexId">{{ i.master.hhldCnt ?? '-' }} · {{ i.master.hallType ?? '-' }}</td></tr>
            <tr><th>교통</th><td v-for="i in items" :key="i.complexId"><b>{{ grade(i, 'grade_traffic') }}</b> {{ commuteText(i) }}</td></tr>
            <tr><th>환경</th><td v-for="i in items" :key="i.complexId"><b>{{ grade(i, 'grade_env') }}</b> {{ conveniences(i) }}</td></tr>
            <tr><th>학군</th><td v-for="i in items" :key="i.complexId"><b>{{ grade(i, 'grade_edu') }}</b> {{ schoolText(i) }}</td></tr>
            <tr><th>호가</th><td v-for="i in items" :key="i.complexId">{{ money(v(i, 'price_ask')) }}</td></tr>
            <tr><th>최근 실거래</th><td v-for="i in items" :key="i.complexId">{{ money(v(i, 'price_last_trade')) }}</td></tr>
            <tr><th>괴리율</th><td v-for="i in items" :key="i.complexId">{{ pct(i.derived.gapPct) }}</td></tr>
            <tr><th>예산 대비</th><td v-for="i in items" :key="i.complexId">{{ signed(i.derived.budgetDiff) }}</td></tr>
            <tr><th>가중 점수</th><td v-for="i in items" :key="i.complexId">{{ scores.get(i.complexId)?.score ?? '-' }}</td></tr>
          </tbody>
        </table>
      </article>
    </template>
  </div>
</template>

<style scoped>
.report { max-width: 900px; margin: 0 auto; padding: 24px; background: #fff; color: #111; font-size: 13px; }
.bar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
header { border-bottom: 3px solid #111; margin-bottom: 16px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 18px; margin: 24px 0 8px; padding: 6px 10px; background: #f1f5f9; border-left: 4px solid #111; }
h3 { font-size: 14px; margin: 14px 0 6px; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #cbd5e1; padding: 5px 8px; text-align: left; vertical-align: top; }
th { background: #f8fafc; width: 120px; font-weight: 600; }
.compare th { width: auto; }
.g { display: inline-block; min-width: 22px; text-align: center; border: 1px solid #111; border-radius: 4px; margin-left: 4px; }
dl { display: grid; grid-template-columns: 60px 1fr; gap: 4px 12px; margin: 0; }
dt { font-weight: 600; }
dd { margin: 0; white-space: pre-wrap; }
.pre { white-space: pre-wrap; margin: 0; }
.err { color: #dc2626; }
.complex { break-inside: avoid-page; }
.complex + .complex, .compare { break-before: page; }
@media print {
  .no-print { display: none; }
  .report { padding: 0; max-width: none; }
}
</style>
