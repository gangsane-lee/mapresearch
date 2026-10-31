<script setup>
// 스냅샷 입력 (계획서 §7.4): field_def 기반 동적 폼, 직전 값 복사, 바뀐 항목 표시, 저장 전 복사값 확인
import { computed, onMounted, reactive, ref } from 'vue';
import Modal from './Modal.vue';
import { api } from '../api/client.js';
import { formatMan } from '../util/format.js';
import {
  CATEGORY_ORDER,
  buildFormState,
  fromInput,
  gapPct,
  isCarried,
  isChanged,
  rowErrors,
  toPayload,
  unconfirmedCarried,
} from '../util/snapshotDraft.js';

const props = defineProps({
  complexId: { type: Number, required: true },
  /** 정정 모드: 원본 스냅샷 id (값은 원본으로 채움) */
  correctOf: { type: Number, default: null },
});
const emit = defineEmits(['close', 'saved']);

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

const draft = ref(null);
const state = ref(null);
const error = ref(null);
const saving = ref(false);
const confirmList = ref(null);
const head = reactive({ observedAt: today, source: 'VISIT', memo: '', reason: '' });

const enumsOf = (fieldCd) => draft.value.enums.filter((e) => e.fieldCd === fieldCd);
const areaLabel = (id) => draft.value.areaTypes.find((a) => a.areaTypeId === id)?.label ?? '';

const groups = computed(() => {
  if (!state.value) return [];
  return CATEGORY_ORDER.map(([cat, label]) => ({
    cat,
    label,
    rows: state.value.rows.filter((r) => r.field.category === cat),
  })).filter((g) => g.rows.length || g.cat === 'TRAFFIC');
});

const errors = computed(() => (state.value ? rowErrors(state.value) : []));

/** 평형별 호가·실거래 → 괴리율 즉시 계산 */
function gapOf(areaTypeId) {
  const row = (cd) => state.value.rows.find((r) => r.field.fieldCd === cd && r.areaTypeId === areaTypeId);
  const ask = row('price_ask') && fromInput(row('price_ask').field, row('price_ask').input).value;
  const lt = row('price_last_trade') && fromInput(row('price_last_trade').field, row('price_last_trade').input).value;
  return gapPct(ask, lt);
}

async function load() {
  try {
    const d = await api(`/api/complexes/${props.complexId}/snapshots/draft?observedAt=${head.observedAt}`);
    if (props.correctOf) {
      // 정정: 원본 값으로 덮어쓰기 (원본 값 자체는 복사값이 아니라 다시 확정하는 값)
      const orig = await api(`/api/snapshots/${props.correctOf}`);
      head.observedAt = orig.observedAt;
      head.source = orig.source;
      head.memo = orig.memo ?? '';
      for (const v of d.values) {
        const o = orig.values.find((x) => x.fieldCd === v.fieldCd && (x.areaTypeId ?? null) === (v.areaTypeId ?? null));
        v.value = o ? o.value : null;
        v.carriedFromValueId = o?.carriedFromValueId ?? null;
        v.carriedObservedAt = o?.carried ? o.effObservedAt : null;
      }
      d.commutes = orig.commutes.map((c) => ({ ...c, carriedFromCommuteId: null }));
    }
    draft.value = d;
    state.value = buildFormState(d);
  } catch (err) {
    error.value = err.message;
  }
}

async function save(force = false) {
  error.value = null;
  if (errors.value.length) {
    error.value = `입력 오류 ${errors.value.length}건: ${errors.value.map((e) => e.label).join(', ')}`;
    return;
  }
  const pending = unconfirmedCarried(state.value);
  if (pending.length && !force) {
    confirmList.value = pending;
    return;
  }
  confirmList.value = null;
  saving.value = true;
  try {
    const body = toPayload(state.value, head);
    const res = props.correctOf
      ? await api(`/api/snapshots/${props.correctOf}/correct`, { method: 'POST', body: { ...body, reason: head.reason } })
      : await api(`/api/complexes/${props.complexId}/snapshots`, { method: 'POST', body });
    emit('saved', res);
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <Modal :title="correctOf ? `스냅샷 정정 #${correctOf}` : `새 스냅샷 — ${draft?.displayNm ?? ''}`" size="lg" @close="emit('close')">
    <p v-if="!state && !error" class="muted">불러오는 중…</p>
    <template v-if="state">
      <div v-if="draft.pendingMasterRevId" class="banner warn">
        단지 정보 변경이 감지되었습니다 (리비전 #{{ draft.pendingMasterRevId }}). 반영/무시는 단지 상세에서 처리하세요.
      </div>

      <section class="head">
        <label>관측일 <input v-model="head.observedAt" type="date" :max="today" /></label>
        <label>
          출처
          <select v-model="head.source">
            <option value="VISIT">임장</option>
            <option value="ONLINE">온라인</option>
            <option value="AGENT">중개사</option>
          </select>
        </label>
        <label class="grow">메모 <input v-model="head.memo" maxlength="1000" /></label>
        <label v-if="correctOf" class="grow">정정 사유 <input v-model="head.reason" maxlength="500" placeholder="예: 호가 오기 수정" /></label>
      </section>
      <p v-if="draft.prevObservedAt" class="muted small">
        직전 스냅샷({{ draft.prevObservedAt }}) 값이 복사되었습니다. 바뀐 항목만 수정하세요. 복사값은 <span class="badge">복사</span>로 표시됩니다.
      </p>

      <section v-if="draft.master" class="master">
        <h3>기본정보 <small class="muted">(자동·읽기 전용)</small></h3>
        <span>사용승인 {{ draft.master.use_apr_day ? String(draft.master.use_apr_day).slice(0, 10) : '-' }}</span>
        <span>세대수 {{ draft.master.hhld_cnt ?? '-' }}</span>
        <span>복도 {{ draft.master.hall_type ?? '-' }}</span>
        <span>용적률 {{ draft.master.far_ratio ?? '-' }}%</span>
      </section>

      <section v-for="g in groups" :key="g.cat" class="group">
        <h3>{{ g.label }}</h3>

        <table v-if="g.cat === 'TRAFFIC'" class="commute">
          <thead>
            <tr><th>기준점</th><th>대중교통(분)</th><th>환승</th><th>경로 메모</th></tr>
          </thead>
          <tbody>
            <tr v-for="c in state.commutes" :key="c.anchor.anchorId">
              <th scope="row">{{ c.anchor.name }}</th>
              <td>
                <input v-model="c.minutes" inputmode="numeric" class="num" :aria-label="`${c.anchor.name} 소요시간`" />
                <span v-if="c.carriedFromCommuteId && c.original && String(c.minutes) === String(c.original.minutes)" class="badge" :title="`원 관측일 ${c.carriedObservedAt}`">복사</span>
              </td>
              <td><input v-model="c.transfers" inputmode="numeric" class="num" :aria-label="`${c.anchor.name} 환승`" /></td>
              <td><input v-model="c.routeDesc" maxlength="300" :aria-label="`${c.anchor.name} 경로`" /></td>
            </tr>
          </tbody>
        </table>

        <div
          v-for="r in g.rows"
          :key="r.key"
          class="row"
          :class="{ changed: isChanged(r) && r.original != null, carried: isCarried(r) }"
        >
          <label :for="r.key">
            {{ r.field.label }}<template v-if="r.areaTypeId"> · {{ areaLabel(r.areaTypeId) }}</template>
            <small v-if="r.field.unit && r.field.unit !== '만원'" class="muted">({{ r.field.unit }})</small>
          </label>

          <div class="control">
            <select v-if="r.field.dataType === 'enum'" :id="r.key" v-model="r.input">
              <option value="">-</option>
              <option v-for="e in enumsOf(r.field.fieldCd)" :key="e.code" :value="e.code">{{ e.code.length <= 2 ? `${e.code} ${e.label}` : e.label }}</option>
            </select>
            <span v-else-if="r.field.dataType === 'bool'" class="bool">
              <label><input v-model="r.input" type="radio" :name="r.key" :value="true" /> 있음</label>
              <label><input v-model="r.input" type="radio" :name="r.key" :value="false" /> 없음</label>
            </span>
            <input v-else-if="r.field.dataType === 'date'" :id="r.key" v-model="r.input" type="month" />
            <textarea v-else-if="r.field.dataType === 'text' && r.field.fieldCd.startsWith('note')" :id="r.key" v-model="r.input" rows="2" maxlength="4000" />
            <input
              v-else
              :id="r.key"
              v-model="r.input"
              :inputmode="r.field.unit === '만원' ? 'text' : r.field.dataType === 'num' ? 'decimal' : 'text'"
              :placeholder="r.field.unit === '만원' ? '10.7억 / 107000 / 10억7천' : ''"
            />

            <small v-if="r.field.unit === '만원' && fromInput(r.field, r.input).value != null" class="muted">
              = {{ formatMan(fromInput(r.field, r.input).value) }}
            </small>
            <small v-if="fromInput(r.field, r.input).error" class="err">{{ fromInput(r.field, r.input).error }}</small>
            <small v-if="r.auto" class="muted">실거래 자동 ({{ r.auto.dealDate }})</small>
            <span v-if="r.prefill && !isChanged(r)" class="badge prefill" :title="`같은 법정동 ${r.prefill.complexNm} ${r.prefill.observedAt} 값`">
              같은 동 {{ r.prefill.complexNm }} 값 — 확인 필요
            </span>
            <template v-if="isCarried(r)">
              <span class="badge" :title="`원 관측일 ${r.carriedObservedAt}`">복사 · {{ r.carriedObservedAt }}</span>
              <label class="confirm"><input v-model="r.confirmed" type="checkbox" /> 이번에 확인함</label>
            </template>
            <small v-if="r.field.fieldCd === 'price_ask' && gapOf(r.areaTypeId) != null" :class="gapOf(r.areaTypeId) > 0 ? 'up' : 'down'">
              괴리율 {{ gapOf(r.areaTypeId) > 0 ? '+' : '' }}{{ gapOf(r.areaTypeId) }}%
            </small>
          </div>
        </div>
      </section>
    </template>

    <div v-if="confirmList" class="banner warn">
      <p>다음 항목은 직전 값을 그대로 복사했습니다. 이번에 확인한 값이 맞나요?</p>
      <ul>
        <li v-for="r in confirmList" :key="r.key">
          {{ r.field.label }}<template v-if="r.areaTypeId"> · {{ areaLabel(r.areaTypeId) }}</template> (원 관측일 {{ r.carriedObservedAt }})
        </li>
      </ul>
      <button type="button" class="btn" @click="confirmList = null">돌아가서 수정</button>
      <button type="button" class="btn primary" @click="save(true)">복사값 그대로 저장</button>
    </div>

    <template #footer>
      <span v-if="error" class="err">{{ error }}</span>
      <button type="button" class="btn" @click="emit('close')">취소</button>
      <button type="button" class="btn primary" :disabled="!state || saving" @click="save()">
        {{ saving ? '저장 중…' : correctOf ? '정정본 저장' : '저장' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.head { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; margin-bottom: 8px; }
.head label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
.head .grow { flex: 1; min-width: 200px; }
input, select, textarea { padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; font: inherit; color: var(--text); }
textarea { width: 100%; resize: vertical; }
.small { font-size: 13px; }
.master { display: flex; gap: 16px; flex-wrap: wrap; padding: 10px 12px; background: #f1f5f9; border-radius: var(--radius); margin: 12px 0; }
.master h3 { width: 100%; margin: 0; font-size: 14px; }
.group { margin-top: 18px; }
.group h3 { font-size: 15px; margin: 0 0 8px; border-bottom: 2px solid var(--text); padding-bottom: 4px; }
.row { display: grid; grid-template-columns: 180px 1fr; gap: 12px; align-items: center; padding: 6px 4px; border-bottom: 1px solid var(--line); }
.row.changed { background: #fefce8; }
.control { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.control > input:not([type='checkbox']):not([type='radio']), .control > select { min-width: 200px; }
.bool { display: flex; gap: 12px; }
.badge { font-size: 11px; background: #e2e8f0; color: var(--muted); border-radius: 4px; padding: 1px 6px; }
.badge.prefill { background: #e0f2fe; color: #0369a1; }
.confirm { font-size: 12px; color: var(--muted); display: flex; gap: 4px; align-items: center; }
.commute { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 14px; }
.commute th, .commute td { padding: 4px 6px; border-bottom: 1px solid var(--line); text-align: left; }
.commute input.num { width: 70px; }
.commute td:last-child input { width: 100%; }
.banner { padding: 10px 12px; border-radius: var(--radius); margin: 8px 0; }
.banner.warn { background: #fffbeb; border: 1px solid #fcd34d; }
.banner ul { margin: 6px 0 10px; }
.banner .btn { margin-right: 8px; }
.err { color: var(--up); font-size: 13px; }
footer .err { margin-right: auto; }
@media (max-width: 640px) { .row { grid-template-columns: 1fr; } }
</style>
