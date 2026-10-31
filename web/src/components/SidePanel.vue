<script setup>
// 우측 패널 (계획서 §7.2) — 1개: 요약, 2~4개: 비교 (첨부 양식 비교표 레이아웃)
// 데이터: GET /api/compare (기준일 이전 최신 값 + 실효 관측일)
import { computed, ref, watch } from 'vue';
import { api } from '../api/client.js';
import { STATUS, formatMan, formatDeltaMan, isStale } from '../util/format.js';
import { rankOf, enumOrd, enumLabel, sparkPath, ageLabel } from '../util/compare.js';
import { weightedScores, weightsFromSettings } from '../util/score.js';
import { useComplexesStore } from '../stores/complexes.js';

const props = defineProps({
  ids: { type: Array, required: true },
  warning: { type: String, default: null },
  reloadKey: { type: Number, default: 0 },
});
const emit = defineEmits(['close', 'remove', 'detail', 'new-snapshot']);

const data = ref(null);
const error = ref(null);
const loading = ref(false);
const areas = ref(new Map()); // complexId → areaTypeId (비교 시 평형 선택)
let seq = 0;

async function load() {
  const my = ++seq;
  loading.value = true;
  error.value = null;
  try {
    const areaQ = [...areas.value].filter(([c]) => props.ids.includes(c)).map(([c, a]) => `${c}:${a}`).join(',');
    const d = await api(`/api/compare?ids=${props.ids.join(',')}${areaQ ? `&areas=${areaQ}` : ''}`);
    if (my === seq) data.value = d;
  } catch (err) {
    if (my === seq) error.value = err.message;
  } finally {
    if (my === seq) loading.value = false;
  }
}
watch(() => [props.ids.join(','), props.reloadKey], load, { immediate: true });

const items = computed(() => data.value?.items ?? []);
const mode = computed(() => (props.ids.length === 1 ? 'SUMMARY' : 'COMPARE'));
const one = computed(() => items.value[0]);
const enums = computed(() => data.value?.enums ?? []);
const fieldOf = (cd) => data.value?.fields.find((f) => f.fieldCd === cd);
const stale = (d) => isStale(d, data.value?.staleDays ?? 30);
const statusOf = (c) => STATUS[c.status] ?? STATUS.INTEREST;
const complexStore = useComplexesStore();
const flagsOf = (id) => complexStore.byId.get(id)?.flags ?? []; // A3 가격 알림 (요약 목록 기준)
const v = (item, cd) => item.values[cd]?.value ?? null;
const obs = (item, cd) => item.values[cd]?.observedAt ?? null;
const areaOf = (item) => item.areaTypes.find((a) => a.areaTypeId === item.areaTypeId);
const signCls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
const pct = (n) => (n == null ? '-' : `${n > 0 ? '+' : ''}${n}%`);

function setArea(complexId, areaTypeId) {
  const m = new Map(areas.value);
  m.set(complexId, Number(areaTypeId));
  areas.value = m;
  load();
}

// ── 비교표 행 정의 ───────────────────────────────────
const commuteOf = (item, anchorId) => item.commutes.find((c) => c.anchorId === anchorId && c.mode === 'TRANSIT');
const rows = computed(() => {
  if (!data.value) return [];
  const anchors = data.value.anchors;
  const R = [];
  const sec = (title) => R.push({ section: title });
  const row = (label, get, opts = {}) => R.push({ label, get, ...opts });
  const grade = (cd) =>
    row(fieldOf(cd)?.label ?? cd, (i) => enumLabel(enums.value, cd, v(i, cd)), {
      rank: (i) => enumOrd(enums.value, cd, v(i, cd)),
      better: 'UP',
      obs: (i) => obs(i, cd),
      badge: true,
    });
  const numRow = (cd, fmt = (x) => x) =>
    row(fieldOf(cd)?.label ?? cd, (i) => (v(i, cd) == null ? '-' : fmt(v(i, cd))), {
      rank: (i) => v(i, cd),
      better: fieldOf(cd)?.better ?? 'NONE',
      obs: (i) => obs(i, cd),
    });

  const scores = weightedScores(items.value, enums.value, weightsFromSettings(data.value.weights));
  sec('종합');
  row('가중 점수', (i) => {
    const s = scores.get(i.complexId);
    return s?.score == null ? '-' : `${s.score}점`;
  }, { rank: (i) => scores.get(i.complexId)?.score ?? null, better: 'UP', title: '교통·환경·학군 등급 + 가격 매력도(최저 호가 대비). 가중치는 설정에서 조정' });

  sec('기본정보');
  row('위치', (i) => i.sggNm ?? '-');
  row('연식', (i) => ageLabel(i.master.useAprDay), { rank: (i) => (i.master.useAprDay ? Number(i.master.useAprDay.slice(0, 4)) : null), better: 'UP' });
  row('세대수', (i) => (i.master.hhldCnt ? `${i.master.hhldCnt.toLocaleString()}세대` : '-'), { rank: (i) => i.master.hhldCnt, better: 'UP' });
  row('복도/계단', (i) => i.master.hallType ?? '-');
  row('평형', (i) => {
    const a = areaOf(i);
    return a ? `${a.label}${a.rooms != null ? ` 방${a.rooms}화${a.baths ?? '-'}` : ''}` : '-';
  }, { areaSelect: true });
  row('용적률', (i) => (i.master.farRatio != null ? `${i.master.farRatio}%` : '-'), { rank: (i) => i.master.farRatio, better: 'DOWN' });

  sec('교통');
  grade('grade_traffic');
  row('최근접 역', (i) => (v(i, 'trn_station') ? `${v(i, 'trn_station')}${v(i, 'trn_station_walk_min') != null ? ` 도보 ${v(i, 'trn_station_walk_min')}분` : ''}` : '-'), {
    rank: (i) => v(i, 'trn_station_walk_min'),
    better: 'DOWN',
    obs: (i) => obs(i, 'trn_station_walk_min') ?? obs(i, 'trn_station'),
  });
  for (const a of anchors) {
    row(`${a.name}`, (i) => {
      const c = commuteOf(i, a.anchorId);
      const d = i.distances.find((x) => x.anchorId === a.anchorId);
      const parts = [];
      if (c) parts.push(`${c.minutes}분${c.transfers ? ` · 환승${c.transfers}` : ''}`);
      if (d) parts.push(`${d.km}km`);
      return parts.join(' / ') || '-';
    }, { rank: (i) => commuteOf(i, a.anchorId)?.minutes ?? null, better: 'DOWN', obs: (i) => commuteOf(i, a.anchorId)?.observedAt });
  }

  sec('환경');
  grade('grade_env');
  row('유해시설', (i) => (v(i, 'env_hazard') == null ? '-' : v(i, 'env_hazard') ? '있음' : '없음'), { obs: (i) => obs(i, 'env_hazard') });
  numRow('env_dept');
  numRow('env_mart');
  numRow('env_hospital');

  sec('학군');
  grade('grade_edu');
  numRow('edu_academy_cnt', (x) => `${x}개`);

  sec('가격');
  numRow('price_ask', formatMan);
  row('최근 실거래', (i) => (v(i, 'price_last_trade') == null ? '-' : `${formatMan(v(i, 'price_last_trade'))}${v(i, 'price_last_trade_ym') ? ` (${String(v(i, 'price_last_trade_ym')).slice(2, 7).replace('-', '.')})` : ''}`), {
    obs: (i) => obs(i, 'price_last_trade'),
  });
  row('호가 괴리율', (i) => pct(i.derived.gapPct), { rank: (i) => i.derived.gapPct, better: 'DOWN', cls: (i) => signCls(i.derived.gapPct) });
  if (data.value.budgetMan != null) {
    row('예산 대비', (i) => (i.derived.budgetDiff == null ? '-' : `${i.derived.budgetDiff > 0 ? '+' : ''}${formatMan(i.derived.budgetDiff)}`), {
      rank: (i) => i.derived.budgetDiff,
      better: 'DOWN',
      cls: (i) => signCls(i.derived.budgetDiff),
    });
  }
  row('직전 대비', (i) => formatDeltaMan(i.derived.askDelta) || '-', { cls: (i) => signCls(i.derived.askDelta) });

  sec('정비사업');
  row('단계', (i) => enumLabel(enums.value, 'redev_stage', v(i, 'redev_stage')), { obs: (i) => obs(i, 'redev_stage') });
  return R;
});

const ranks = computed(() => rows.value.map((r) => (r.rank ? rankOf(items.value, r.rank, r.better) : null)));
</script>

<template>
  <aside class="side-panel" :aria-label="mode === 'SUMMARY' ? '단지 요약' : '단지 비교'">
    <header>
      <h2>{{ mode === 'SUMMARY' ? '요약' : `비교 (${ids.length})` }}</h2>
      <small v-if="data" class="muted">기준일 {{ data.asOf }}</small>
      <button type="button" class="btn" aria-label="패널 닫기" @click="emit('close')">닫기</button>
    </header>
    <p v-if="warning" class="warn">{{ warning }}</p>
    <p v-if="error" class="warn">{{ error }}</p>
    <p v-if="loading && !data" class="muted pad">불러오는 중…</p>

    <!-- 요약 -->
    <section v-if="mode === 'SUMMARY' && one" class="summary">
      <h3>{{ one.displayNm }}</h3>
      <span class="chip" :style="{ borderColor: statusOf(one).color, color: statusOf(one).color }">{{ statusOf(one).label }}</span>
      <span class="muted small sgg">{{ one.sggNm }}</span>

      <p v-for="f in flagsOf(one.complexId)" :key="f.code" class="price-flag">! {{ f.label }}</p>
      <div class="master">
        <span>{{ ageLabel(one.master.useAprDay) }}</span>
        <span>{{ one.master.hhldCnt ? `${one.master.hhldCnt.toLocaleString()}세대` : '세대수 -' }}</span>
        <span>{{ one.master.hallType ?? '복도유형 -' }}</span>
        <span>용적률 {{ one.master.farRatio ?? '-' }}%</span>
      </div>

      <div class="grades">
        <span v-for="cd in ['grade_traffic', 'grade_env', 'grade_edu']" :key="cd" class="grade" :class="[`g-${v(one, cd) ?? 'none'}`, { stale: stale(obs(one, cd)) }]" :title="obs(one, cd) ? `관측 ${obs(one, cd)}` : '미입력'">
          <small>{{ fieldOf(cd)?.label.replace(' 등급', '') }}</small>
          <b>{{ v(one, cd) ?? '-' }}</b>
        </span>
      </div>

      <div class="price">
        <div class="area-line">
          <span class="muted">{{ areaOf(one)?.label ?? '평형 미지정' }}</span>
          <select v-if="one.areaTypes.length > 1" :value="one.areaTypeId" aria-label="평형 선택" @change="setArea(one.complexId, $event.target.value)">
            <option v-for="a in one.areaTypes" :key="a.areaTypeId" :value="a.areaTypeId">{{ a.label }}</option>
          </select>
        </div>
        <div class="ask" :class="{ stale: stale(obs(one, 'price_ask')) }">
          <b>{{ formatMan(v(one, 'price_ask')) }}</b>
          <span :class="signCls(one.derived.askDelta)">{{ formatDeltaMan(one.derived.askDelta) }}</span>
          <small v-if="obs(one, 'price_ask')" class="muted">호가 {{ obs(one, 'price_ask') }}{{ one.values.price_ask?.carried ? ' · 복사값' : '' }}</small>
        </div>
        <svg v-if="one.askSeries.length > 1" class="spark" viewBox="0 0 120 28" role="img" aria-label="호가 추이">
          <path :d="sparkPath(one.askSeries.map((s) => s.value))" />
        </svg>
        <dl>
          <dt>최근 실거래</dt>
          <dd>{{ formatMan(v(one, 'price_last_trade')) }} <small class="muted">{{ v(one, 'price_last_trade_ym') ? String(v(one, 'price_last_trade_ym')).slice(0, 7) : '' }}</small></dd>
          <dt>괴리율</dt>
          <dd :class="signCls(one.derived.gapPct)">{{ pct(one.derived.gapPct) }}</dd>
          <template v-if="data.budgetMan != null">
            <dt>예산 대비</dt>
            <dd :class="signCls(one.derived.budgetDiff)">{{ one.derived.budgetDiff == null ? '-' : `${one.derived.budgetDiff > 0 ? '+' : ''}${formatMan(one.derived.budgetDiff)}` }}</dd>
          </template>
        </dl>
      </div>

      <dl class="dist">
        <template v-for="a in data.anchors" :key="a.anchorId">
          <template v-if="commuteOf(one, a.anchorId) || one.distances.find((d) => d.anchorId === a.anchorId)">
            <dt>{{ a.name }}</dt>
            <dd :class="{ stale: stale(commuteOf(one, a.anchorId)?.observedAt) }">
              <template v-if="commuteOf(one, a.anchorId)">{{ commuteOf(one, a.anchorId).minutes }}분 · </template>
              {{ one.distances.find((d) => d.anchorId === a.anchorId)?.km ?? '-' }}km
            </dd>
          </template>
        </template>
      </dl>
    </section>

    <!-- 비교 -->
    <section v-else-if="mode === 'COMPARE' && items.length" class="compare">
      <table>
        <thead>
          <tr>
            <th scope="col" />
            <th v-for="c in items" :key="c.complexId" scope="col">
              {{ c.displayNm }}
              <button type="button" class="x" :aria-label="`${c.displayNm} 비교에서 빼기`" @click="emit('remove', c.complexId)">×</button>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(r, ri) in rows" :key="ri">
            <tr v-if="r.section" class="sec"><th :colspan="items.length + 1">{{ r.section }}</th></tr>
            <tr v-else>
              <th scope="row" :title="r.title">{{ r.label }}</th>
              <td
                v-for="c in items"
                :key="c.complexId"
                :class="[
                  r.cls ? r.cls(c) : '',
                  { best: ranks[ri]?.best.has(c.complexId), worst: ranks[ri]?.worst.has(c.complexId), stale: r.obs && stale(r.obs(c)) },
                ]"
                :title="r.obs && r.obs(c) ? `관측 ${r.obs(c)}` : undefined"
              >
                <select v-if="r.areaSelect && c.areaTypes.length > 1" :value="c.areaTypeId" :aria-label="`${c.displayNm} 평형`" @change="setArea(c.complexId, $event.target.value)">
                  <option v-for="a in c.areaTypes" :key="a.areaTypeId" :value="a.areaTypeId">{{ a.label }}</option>
                </select>
                <template v-else>{{ r.get(c) }}</template>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <p class="muted small">초록 = 우세, 빨강 = 열세. 흐린 값은 관측 {{ data.staleDays }}일 경과.</p>
    </section>

    <footer>
      <button v-if="mode === 'SUMMARY'" type="button" class="btn" @click="emit('new-snapshot', ids[0])">새 스냅샷</button>
      <a class="btn" :href="`/report/${ids.join(',')}`" target="_blank" rel="noopener">보고서</a>
      <button type="button" class="btn primary" @click="emit('detail')">{{ mode === 'SUMMARY' ? '상세' : '상세 비교' }}</button>
    </footer>
  </aside>
</template>

<style scoped>
.side-panel { width: 420px; max-width: 100vw; height: 100%; background: var(--panel); border-left: 1px solid var(--line); display: flex; flex-direction: column; overflow: hidden; }
header, footer { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
header { border-bottom: 1px solid var(--line); }
header h2 { margin: 0; font-size: 16px; flex: 1; }
footer { border-top: 1px solid var(--line); margin-top: auto; justify-content: flex-end; }
section { padding: 16px; overflow: auto; }
.pad { padding: 16px; }
.small { font-size: 12px; }
.sgg { margin-left: 6px; }
h3 { margin: 0 0 6px; font-size: 18px; }
.warn { margin: 8px 16px 0; color: var(--warn); }
.price-flag { margin: 8px 0 0; padding: 4px 8px; border-radius: 6px; background: #fffbeb; color: var(--warn); font-size: 13px; }
.master { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 12px 0; font-size: 13px; }
.grades { display: flex; gap: 8px; margin-bottom: 12px; }
.grade { flex: 1; text-align: center; border: 1px solid var(--line); border-radius: var(--radius); padding: 6px; }
.grade small { display: block; color: var(--muted); font-size: 11px; }
.grade b { font-size: 20px; }
.g-S b { color: #16a34a; } .g-A b { color: #2563eb; } .g-B b { color: #d97706; } .g-C b { color: #dc2626; }
.price { border: 1px solid var(--line); border-radius: var(--radius); padding: 10px 12px; }
.area-line { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
.ask { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin: 4px 0; }
.ask b { font-size: 22px; }
.spark { width: 100%; height: 32px; }
.spark path { fill: none; stroke: var(--accent); stroke-width: 1.6; }
dl { display: grid; grid-template-columns: 96px 1fr; gap: 6px 12px; margin: 8px 0 0; font-size: 13px; }
dt { color: var(--muted); }
dd { margin: 0; }
.dist { margin-top: 14px; }
table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
th, td { border-bottom: 1px solid var(--line); padding: 5px 6px; text-align: left; vertical-align: top; }
thead th { position: sticky; top: 0; background: var(--panel); padding-right: 18px; }
tbody th { color: var(--muted); font-weight: 500; white-space: nowrap; }
tr.sec th { background: #f1f5f9; color: var(--text); font-weight: 700; }
.best { background: #ecfdf5; font-weight: 600; }
.worst { background: #fef2f2; }
.x { position: absolute; margin-left: 4px; border: 0; background: none; color: var(--muted); }
select { font-size: 12px; padding: 2px 4px; }
</style>
