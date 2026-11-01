<script setup>
// 단일 단지 상세 (계획서 §7.3) — 개요 / 시세 추이 / 스냅샷 이력 / 가치평가 / 실거래 / 사진 / 정비 / 메모·결론
import { computed, onMounted, ref, watch } from 'vue';
import EChart from '../charts/EChart.vue';
import PhotoGallery from './PhotoGallery.vue';
import SchoolPanel from './SchoolPanel.vue';
import RedevRefPanel from './RedevRefPanel.vue';
import ComplexStateControl from './ComplexStateControl.vue';
import { useComplexesStore } from '../stores/complexes.js';
import { priceTrendOption, multiLineOption, gradeTrendOption } from '../charts/options.js';
import { api } from '../api/client.js';
import { STATUS, formatMan, formatDeltaMan } from '../util/format.js';
import { enumLabel, enumOrd, ageLabel } from '../util/compare.js';

const pct = (v) => (v == null ? '-' : `${v}%`);

const props = defineProps({
  complexId: { type: Number, required: true },
  /** 이력에서 고른 스냅샷 — 열 때 "스냅샷 이력" 탭에서 바로 보여 준다 */
  initialSnapshotId: { type: Number, default: null },
});
const emit = defineEmits(['correct', 'changed', 'new-snapshot', 'history']);
const complexStore = useComplexesStore();
/** ★·상태는 바꾸면 목록(store)에 바로 반영 */
const live = computed(() => complexStore.byId.get(props.complexId) ?? detail.value);

const TABS = ['개요', '시세 추이', '스냅샷 이력', '가치평가', '실거래', '사진', '정비 타임라인', '메모·결론'];
const tab = ref(TABS[0]);
const SERIES_FIELDS = ['price_ask', 'grade_traffic', 'grade_env', 'grade_edu', 'redev_stage', 'note_traffic', 'note_env', 'note_edu', 'note_overall'];

const detail = ref(null);
const cmp = ref(null);
const series = ref([]);
const trades = ref(null);
const commutes = ref([]);
const snapshots = ref([]);
const masterDiff = ref(null);
const error = ref(null);
const areaTypeId = ref(null);
const selectedSnap = ref(null);
const diff = ref(null);
const showVoided = ref(false);

async function load() {
  error.value = null;
  try {
    const id = props.complexId;
    const [d, c, s, t, cm, sn, md] = await Promise.all([
      api(`/api/complexes/${id}`),
      api(`/api/compare?ids=${id}`),
      api(`/api/complexes/${id}/series?fields=${SERIES_FIELDS.join(',')}`),
      api(`/api/complexes/${id}/trades`),
      api(`/api/complexes/${id}/commutes`),
      api(`/api/complexes/${id}/snapshots?includeVoid=1`),
      api(`/api/complexes/${id}/master-diff`),
    ]);
    detail.value = d;
    cmp.value = c;
    series.value = s.items;
    trades.value = t;
    commutes.value = cm.items;
    snapshots.value = sn.items;
    masterDiff.value = md;
    areaTypeId.value ??= d.areaTypes.find((a) => a.isPrimary)?.areaTypeId ?? d.areaTypes[0]?.areaTypeId ?? null;
    if (!selectedSnap.value) focusSnapshot(props.initialSnapshotId);
  } catch (err) {
    error.value = err.message;
  }
}
onMounted(load);
watch(() => props.complexId, load);
// 이미 열린 상세에서 이력의 다른 스냅샷을 고른 경우
watch(() => props.initialSnapshotId, (id) => focusSnapshot(id));

/** 이력에서 고른 스냅샷을 "스냅샷 이력" 탭에서 펼친다 */
function focusSnapshot(id) {
  const s = id && snapshots.value.find((x) => x.snapshotId === id);
  if (!s) return;
  tab.value = '스냅샷 이력';
  if (s.voided) showVoided.value = true;
  selectSnap(s);
}

const item = computed(() => cmp.value?.items[0]);
const enums = computed(() => cmp.value?.enums ?? []);
const labelOf = (cd) => cmp.value?.fields.find((f) => f.fieldCd === cd)?.label ?? cd;
const areaLabel = (id) => detail.value?.areaTypes.find((a) => a.areaTypeId === id)?.label ?? '';
const anchorName = (id) => cmp.value?.anchors.find((a) => a.anchorId === id)?.name ?? `#${id}`;
const of = (cd) => series.value.filter((s) => s.fieldCd === cd);

// ── 시세 추이 ───────────────────────────────────────
const priceOpt = computed(() =>
  priceTrendOption({
    ask: of('price_ask').filter((s) => s.areaTypeId === areaTypeId.value),
    sales: (trades.value?.sales ?? []).filter((x) => x.areaTypeId === areaTypeId.value),
    rents: (trades.value?.rents ?? []).filter((x) => x.areaTypeId === areaTypeId.value),
  }),
);
const priceEmpty = computed(
  () => !of('price_ask').some((s) => s.areaTypeId === areaTypeId.value) && !(trades.value?.sales ?? []).some((x) => x.areaTypeId === areaTypeId.value),
);

// ── 가치평가 ───────────────────────────────────────
const commuteOpt = computed(() => {
  const by = new Map();
  for (const c of commutes.value.filter((x) => x.mode === 'TRANSIT')) {
    if (!by.has(c.anchorId)) by.set(c.anchorId, []);
    by.get(c.anchorId).push({ observedAt: c.observedAt, value: c.minutes });
  }
  return multiLineOption([...by].map(([id, points]) => ({ name: anchorName(id), points })), { unit: '분' });
});
const gradeOpt = computed(() =>
  gradeTrendOption(
    ['grade_traffic', 'grade_env', 'grade_edu'].map((cd) => ({
      name: labelOf(cd).replace(' 등급', ''),
      points: of(cd).map((s) => ({ observedAt: s.observedAt, value: enumOrd(enums.value, cd, s.value) })),
    })),
    enums.value,
  ),
);

// ── 정비 타임라인: 단계가 바뀐 시점만 ───────────────
const redevTimeline = computed(() => {
  const out = [];
  for (const s of of('redev_stage')) if (out.at(-1)?.value !== s.value) out.push(s);
  return out;
});

// ── 메모·결론: 관측일별 묶음 ────────────────────────
const notes = computed(() => {
  const m = new Map();
  for (const cd of ['note_traffic', 'note_env', 'note_edu', 'note_overall']) {
    for (const s of of(cd)) {
      if (!m.has(s.observedAt)) m.set(s.observedAt, []);
      m.get(s.observedAt).push({ label: labelOf(cd), text: s.value });
    }
  }
  return [...m].sort(([a], [b]) => b.localeCompare(a));
});

// ── 스냅샷 이력 ────────────────────────────────────
const visibleSnaps = computed(() => snapshots.value.filter((s) => showVoided.value || !s.voided));
async function selectSnap(s) {
  selectedSnap.value = s;
  diff.value = null;
  if (!s.voided) diff.value = await api(`/api/snapshots/${s.snapshotId}/diff`).catch((e) => ({ error: e.message }));
}
async function voidSnap(s) {
  const reason = window.prompt('무효화 사유 (원본은 보존되고 목록·증감에서 제외됩니다)');
  if (!reason) return;
  try {
    await api(`/api/snapshots/${s.snapshotId}/void`, { method: 'POST', body: { reason } });
    selectedSnap.value = null;
    await load();
    emit('changed');
  } catch (err) {
    error.value = err.message;
  }
}

// ── 마스터 변경 반영/무시 ───────────────────────────
async function decide(action) {
  try {
    await api(`/api/master-revisions/${masterDiff.value.pendingRevId}/${action}`, { method: 'POST' });
    await load();
    emit('changed');
  } catch (err) {
    error.value = err.message;
  }
}

const SOURCE = { VISIT: '임장', ONLINE: '온라인', AGENT: '중개사' };

// ── 평형 면적을 실거래 실제 면적에 맞추기 (등록 때 평→㎡ 추정값이 달라 시세·실거래가 안 붙는 경우) ──
const TOL = 0.5;
const tradeMatch = (a) => (detail.value?.tradeAreas ?? []).find((t) => Math.abs(t.exclM2 - a.exclM2) <= TOL) ?? null;
const areaChoice = ref({});
function tradeOptions(a) {
  return (detail.value?.tradeAreas ?? []).toSorted((x, y) => Math.abs(x.exclM2 - a.exclM2) - Math.abs(y.exclM2 - a.exclM2));
}
async function fixArea(a) {
  const exclM2 = Number(areaChoice.value[a.areaTypeId] ?? tradeOptions(a)[0]?.exclM2);
  if (!exclM2) return;
  try {
    await api(`/api/complexes/${props.complexId}/area-types/${a.areaTypeId}`, { method: 'PATCH', body: { exclM2 } });
    await load();
    emit('changed');
  } catch (err) {
    error.value = err.message;
  }
}
const pad2 = (n) => String(n).padStart(2, '0');
function savedAt(v) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
const latestActiveId = computed(() => snapshots.value.find((s) => !s.voided)?.snapshotId ?? null);
const reportUrl = (s) => `/report/${props.complexId}?asOf=${s.observedAt}`;
defineExpose({ reload: load });
</script>

<template>
  <div class="detail">
    <p v-if="error" class="err">{{ error }}</p>
    <div v-if="detail" class="actions">
      <ComplexStateControl :complex-id="complexId" :status="live.status" :is-favorite="!!live.isFavorite" @changed="emit('changed')" />
      <span class="spacer" />
      <button type="button" class="btn" @click="emit('new-snapshot', complexId)">새 스냅샷</button>
      <button type="button" class="btn" :disabled="!latestActiveId" title="가장 최근 스냅샷을 고쳐 정정본으로 저장" @click="emit('correct', latestActiveId)">최근 스냅샷 수정</button>
      <button type="button" class="btn" @click="emit('history', complexId)">저장 이력</button>
      <a class="btn" :href="`/report/${complexId}`" target="_blank" rel="noopener">보고서</a>
    </div>
    <nav class="tabs" role="tablist">
      <button v-for="t in TABS" :key="t" type="button" role="tab" :aria-selected="tab === t" :class="{ on: tab === t }" @click="tab = t">{{ t }}</button>
    </nav>

    <div v-if="!detail" class="muted">불러오는 중…</div>
    <template v-else>
      <!-- 개요 -->
      <section v-if="tab === '개요'" class="grid2">
        <div>
          <h3>단지 정보 <small class="muted">({{ detail.master ? '현재 리비전 #' + detail.master.revId : '없음' }})</small></h3>
          <dl>
            <dt>상태</dt><dd>{{ STATUS[live.status]?.label }}{{ live.isFavorite ? ' · ★ 관심' : '' }}</dd>
            <dt>주소</dt><dd>{{ detail.jibunAddr ?? '-' }}</dd>
            <dt>연식</dt><dd>{{ ageLabel(detail.master?.useAprDay) }}</dd>
            <dt>세대수 / 동</dt><dd>{{ detail.master?.hhldCnt?.toLocaleString() ?? '-' }} / {{ detail.master?.dongCnt ?? '-' }}</dd>
            <dt>최고층</dt><dd>{{ detail.master?.maxFloor ?? '-' }}</dd>
            <dt>복도유형</dt><dd>{{ detail.master?.hallType ?? '-' }}</dd>
            <dt>용적률 / 건폐율</dt><dd>{{ pct(detail.master?.farRatio) }} / {{ pct(detail.master?.bcRatio) }}</dd>
            <dt>시공사</dt><dd>{{ detail.master?.builder ?? '-' }}</dd>
            <dt>태그</dt><dd><span v-for="t in detail.tags" :key="t" class="chip">#{{ t }}</span></dd>
          </dl>
          <h3>평형</h3>
          <table class="tbl">
            <thead><tr><th>라벨</th><th>전용㎡</th><th>방/화</th><th>비고</th><th /><th>실거래 면적</th></tr></thead>
            <tbody>
              <tr v-for="a in detail.areaTypes" :key="a.areaTypeId">
                <td>{{ a.label }}</td><td>{{ a.exclM2 }}</td><td>{{ a.rooms ?? '-' }}/{{ a.baths ?? '-' }}</td><td>{{ a.note ?? '' }}</td><td>{{ a.isPrimary ? '대표' : '' }}</td>
                <td class="trade-area">
                  <span v-if="tradeMatch(a)" class="ok">✓ {{ tradeMatch(a).cnt }}건</span>
                  <template v-else-if="detail.tradeAreas?.length">
                    <select v-model="areaChoice[a.areaTypeId]" :aria-label="`${a.label} 실거래 면적`">
                      <option v-for="t in tradeOptions(a)" :key="t.exclM2" :value="t.exclM2">{{ t.exclM2 }}㎡ · {{ t.cnt }}건</option>
                    </select>
                    <button type="button" class="btn" title="이 평형의 전용㎡를 실거래 면적으로 바꿔 시세·실거래가 붙게 합니다" @click="fixArea(a)">맞추기</button>
                  </template>
                  <span v-else class="muted">-</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="detail.tradeAreas?.length && detail.areaTypes.some((a) => !tradeMatch(a))" class="hint">
            일부 평형의 전용㎡가 실거래 면적과 달라 실거래가 붙지 않습니다(±{{ TOL }}㎡). "맞추기"로 실제 면적을 고르세요.
          </p>
        </div>
        <div>
          <div v-if="masterDiff?.pendingRevId" class="banner warn">
            <b>단지 정보 변경 감지</b> (리비전 #{{ masterDiff.pendingRevId }})
            <table class="tbl">
              <thead><tr><th>항목</th><th>현재</th><th>신규</th></tr></thead>
              <tbody>
                <tr v-for="c in masterDiff.changes" :key="c.field"><td>{{ c.label }}</td><td>{{ c.current ?? '-' }}</td><td><b>{{ c.pending ?? '-' }}</b></td></tr>
              </tbody>
            </table>
            <button type="button" class="btn primary" @click="decide('accept')">반영</button>
            <button type="button" class="btn" @click="decide('reject')">무시</button>
          </div>
          <h3>기준점 직선거리</h3>
          <dl>
            <template v-for="d in item?.distances ?? []" :key="d.anchorId">
              <dt>{{ anchorName(d.anchorId) }}</dt><dd>{{ d.km }}km</dd>
            </template>
          </dl>
          <h3>리비전 이력</h3>
          <table class="tbl">
            <thead><tr><th>#</th><th>상태</th><th>세대수</th><th>용적률</th><th>결정</th></tr></thead>
            <tbody>
              <tr v-for="r in detail.revisions" :key="r.revId">
                <td>{{ r.revId }}</td><td>{{ r.status }}</td><td>{{ r.hhldCnt ?? '-' }}</td><td>{{ r.farRatio ?? '-' }}</td>
                <td>{{ r.decidedAt ? String(r.decidedAt).slice(0, 10) : '-' }}</td>
              </tr>
            </tbody>
          </table>
          <p class="muted small">위치 {{ detail.lat }}, {{ detail.lng }} (내가 확정한 핀)</p>
        </div>
      </section>

      <!-- 시세 추이 -->
      <section v-else-if="tab === '시세 추이'">
        <div class="toolbar">
          <label>평형
            <select v-model.number="areaTypeId">
              <option v-for="a in detail.areaTypes" :key="a.areaTypeId" :value="a.areaTypeId">{{ a.label }} ({{ a.exclM2 }}㎡)</option>
            </select>
          </label>
          <span class="muted small">호가는 내가 기록한 실제 관측값만, 실거래는 해제 건 제외</span>
        </div>
        <EChart :option="priceOpt" height="420px" :empty="priceEmpty" empty-text="호가·실거래 데이터가 없습니다" />
      </section>

      <!-- 스냅샷 이력 -->
      <section v-else-if="tab === '스냅샷 이력'" class="grid2">
        <div>
          <label class="small"><input v-model="showVoided" type="checkbox" /> 무효화된 스냅샷 표시</label>
          <ol class="timeline">
            <li v-for="s in visibleSnaps" :key="s.snapshotId" :class="{ on: selectedSnap?.snapshotId === s.snapshotId, voided: s.voided }" @click="selectSnap(s)">
              <b>{{ s.observedAt }}</b> <span class="muted">{{ SOURCE[s.source] }}</span>
              <small class="muted">저장 {{ savedAt(s.inputAt) }}</small>
              <small v-if="s.snapshotId === latestActiveId" class="now">최신</small>
              <small class="muted">관측 {{ s.observedCnt }} · 복사 {{ s.carriedCnt }}</small>
              <small v-if="s.supersedesId" class="muted">정정본 (원본 #{{ s.supersedesId }})</small>
              <small v-if="s.voided" class="err">무효: {{ s.voidReason }}</small>
            </li>
          </ol>
          <p v-if="!visibleSnaps.length" class="muted">스냅샷이 없습니다.</p>
        </div>
        <div v-if="selectedSnap">
          <h3>#{{ selectedSnap.snapshotId }} {{ selectedSnap.observedAt }}</h3>
          <p v-if="selectedSnap.memo">{{ selectedSnap.memo }}</p>
          <div class="toolbar">
            <a class="btn" :href="reportUrl(selectedSnap)" target="_blank" rel="noopener">이 시점 보고서</a>
          </div>
          <div v-if="!selectedSnap.voided" class="toolbar">
            <button type="button" class="btn primary" @click="emit('correct', selectedSnap.snapshotId)">수정 (정정본 저장)</button>
            <button type="button" class="btn" @click="voidSnap(selectedSnap)">무효화</button>
          </div>
          <template v-if="diff && !diff.error">
            <h4>직전 관측 대비 변경</h4>
            <table class="tbl">
              <thead><tr><th>항목</th><th>이전</th><th>현재</th><th>증감</th></tr></thead>
              <tbody>
                <tr v-for="n in diff.numeric.filter((x) => x.prevValue != null && x.delta !== 0)" :key="n.fieldCd + n.areaTypeId">
                  <td>{{ n.label }}<template v-if="n.areaTypeId"> · {{ areaLabel(n.areaTypeId) }}</template></td>
                  <td>{{ n.fieldCd.startsWith('price') ? formatMan(n.prevValue) : n.prevValue }} <small class="muted">{{ n.prevAt }}</small></td>
                  <td>{{ n.fieldCd.startsWith('price') ? formatMan(n.value) : n.value }}</td>
                  <td :class="n.delta > 0 ? 'up' : 'down'">{{ n.fieldCd.startsWith('price') ? formatDeltaMan(n.delta) : n.delta }} <small v-if="n.deltaPct != null">({{ n.deltaPct }}%)</small></td>
                </tr>
                <tr v-for="c in diff.changed" :key="'t' + c.fieldCd + c.areaTypeId">
                  <td>{{ c.label }}</td><td>{{ c.fieldCd.startsWith('note') ? '…' : enumLabel(enums, c.fieldCd, c.prevValue) }}</td>
                  <td>{{ c.fieldCd.startsWith('note') ? '(수정됨)' : enumLabel(enums, c.fieldCd, c.value) }}</td><td>변경</td>
                </tr>
              </tbody>
            </table>
            <p v-if="!diff.numeric.some((x) => x.prevValue != null && x.delta !== 0) && !diff.changed.length" class="muted">직전 관측 대비 바뀐 값이 없습니다.</p>
            <p v-if="diff.unconfirmed.length" class="muted small">
              복사값(이번에 확인 안 함): {{ diff.unconfirmed.map((u) => u.label).join(', ') }}
            </p>
          </template>
        </div>
      </section>

      <!-- 가치평가 -->
      <section v-else-if="tab === '가치평가'" class="grid2">
        <div>
          <h3>기준점별 대중교통 소요시간</h3>
          <EChart :option="commuteOpt" :empty="!commutes.length" empty-text="소요시간 기록이 없습니다" />
          <table class="tbl">
            <thead><tr><th>기준점</th><th>최근</th><th>환승</th><th>관측일</th></tr></thead>
            <tbody>
              <tr v-for="c in item?.commutes ?? []" :key="c.anchorId + c.mode">
                <td>{{ anchorName(c.anchorId) }}</td><td>{{ c.minutes }}분</td><td>{{ c.transfers ?? '-' }}</td><td>{{ c.observedAt }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h3>등급 추이</h3>
          <EChart :option="gradeOpt" :empty="!of('grade_traffic').length && !of('grade_env').length && !of('grade_edu').length" empty-text="등급 기록이 없습니다" />
          <h3>환경·학군 (최근)</h3>
          <dl>
            <template v-for="cd in ['env_hazard', 'env_dept', 'env_mart', 'env_hospital', 'env_park', 'edu_academy_cnt', 'trn_station', 'trn_station_walk_min']" :key="cd">
              <dt>{{ labelOf(cd) }}</dt>
              <dd>
                {{ item?.values[cd]?.value === true ? '있음' : item?.values[cd]?.value === false ? '없음' : (item?.values[cd]?.value ?? '-') }}
                <span v-if="item?.values[`${cd}_memo`]?.value" class="memo">— {{ item.values[`${cd}_memo`].value }}</span>
                <small v-if="item?.values[cd]" class="muted">{{ item.values[cd].observedAt }}</small>
              </dd>
            </template>
          </dl>
          <SchoolPanel :complex-id="complexId" />
        </div>
      </section>

      <!-- 실거래 -->
      <section v-else-if="tab === '실거래'" class="grid2">
        <div>
          <h3>매매 <small class="muted">{{ trades.from }} 이후</small></h3>
          <table class="tbl">
            <thead><tr><th>계약일</th><th>평형</th><th>층</th><th>금액</th></tr></thead>
            <tbody>
              <tr v-for="s in trades.sales" :key="s.tradeId" :class="{ canceled: s.canceled }">
                <td>{{ s.dealDate }}</td><td>{{ areaLabel(s.areaTypeId) || `${s.exclM2}㎡` }}</td><td>{{ s.floor ?? '-' }}</td>
                <td>{{ formatMan(s.amountMan) }} <small v-if="s.canceled" class="err">해제 {{ s.cancelDate ?? '' }}</small></td>
              </tr>
            </tbody>
          </table>
          <p v-if="!trades.sales.length" class="muted">수집된 매매 실거래가 없습니다 (단지 식별정보로 등록해 법정동·지번이 있는 단지만 연결되며, 설정에서 실거래를 동기화).</p>
        </div>
        <div>
          <h3>전월세</h3>
          <table class="tbl">
            <thead><tr><th>계약일</th><th>평형</th><th>보증금</th><th>월세</th><th>구분</th></tr></thead>
            <tbody>
              <tr v-for="r in trades.rents" :key="r.rentId">
                <td>{{ r.dealDate }}</td><td>{{ areaLabel(r.areaTypeId) || `${r.exclM2}㎡` }}</td><td>{{ formatMan(r.depositMan) }}</td>
                <td>{{ r.monthlyMan ? `${r.monthlyMan}만` : '-' }}</td><td>{{ r.contractType ?? '' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!trades.rents.length" class="muted">수집된 전월세 실거래가 없습니다.</p>
        </div>
      </section>

      <section v-else-if="tab === '사진'">
        <PhotoGallery :complex-id="complexId" :snapshots="snapshots.filter((s) => !s.voided)" />
      </section>

      <section v-else-if="tab === '정비 타임라인'">
        <ol class="timeline">
          <li v-for="s in redevTimeline" :key="s.snapshotId"><b>{{ s.observedAt }}</b> {{ enumLabel(enums, 'redev_stage', s.value) }}</li>
        </ol>
        <p v-if="!redevTimeline.length" class="muted">정비사업 단계 기록이 없습니다.</p>
        <RedevRefPanel :complex-id="complexId" />
      </section>

      <section v-else-if="tab === '메모·결론'">
        <article v-for="[date, list] in notes" :key="date" class="note">
          <h4>{{ date }}</h4>
          <p v-for="n in list" :key="n.label"><b>{{ n.label }}</b> {{ n.text }}</p>
        </article>
        <p v-if="!notes.length" class="muted">기록된 결론이 없습니다.</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.memo { color: var(--muted); }
.trade-area { white-space: nowrap; }
.trade-area select { font-size: 12px; padding: 2px 4px; margin-right: 4px; }
.trade-area .btn { padding: 2px 8px; font-size: 12px; }
.trade-area .ok { color: var(--good); font-size: 12.5px; font-weight: 600; }
.hint { font-size: 12.5px; color: var(--warn); background: var(--tint-warn); border-radius: 6px; padding: 6px 10px; margin: 6px 0 0; }
.actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.actions .spacer { flex: 1; }
.timeline .now { font-size: 11px; color: var(--accent); font-weight: 600; }
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 16px; flex-wrap: wrap; }
.tabs button { border: 0; background: none; padding: 8px 12px; border-bottom: 2px solid transparent; color: var(--muted); }
.tabs button.on { border-color: var(--accent); color: var(--text); font-weight: 600; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
@media (max-width: 900px) { .grid2 { grid-template-columns: 1fr; } }
h3 { font-size: 15px; margin: 0 0 8px; }
h4 { font-size: 14px; margin: 12px 0 6px; }
dl { display: grid; grid-template-columns: 130px 1fr; gap: 6px 12px; margin: 0 0 16px; font-size: 14px; }
dt { color: var(--muted); }
dd { margin: 0; }
.tbl { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 12px; }
.tbl th, .tbl td { padding: 5px 6px; border-bottom: 1px solid var(--line); text-align: left; }
.tbl tr.canceled td { color: var(--muted); text-decoration: line-through; }
.tbl tr.canceled td small { text-decoration: none; display: inline-block; }
.toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.timeline { list-style: none; padding: 0; margin: 8px 0; }
.timeline li { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; padding: 8px 10px; border-left: 3px solid var(--line); cursor: pointer; }
.timeline li.on { border-color: var(--accent); background: var(--accent-soft); }
.timeline li.voided { opacity: 0.55; }
.banner { padding: 10px 12px; border-radius: var(--radius); margin-bottom: 16px; }
.banner.warn { background: var(--tint-warn); border: 1px solid var(--warn-line); }
.banner .btn { margin-right: 8px; }
.note { border-bottom: 1px solid var(--line); padding-bottom: 8px; }
.note p { margin: 4px 0; white-space: pre-wrap; }
.small { font-size: 12px; }
.err { color: var(--up); }
</style>
