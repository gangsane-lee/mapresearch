<script setup>
// 단지 등록 (계획서 §5.4) — 단지 식별정보(한국부동산원 CSV → kapt_ref) 검색으로 채우거나 직접 입력
// 검색 결과·평형 후보는 제안값이며 사용자가 확인·수정한 값만 저장한다.
// 핀 좌표는 "지도에서 위치 지정"으로 지도를 클릭해 확정한다 (지오코딩 결과는 저장하지 않음, §5.3). 지도 키가 없으면 나중에 지정.
import { computed, onMounted, reactive, ref, watch } from 'vue';
import Modal from './Modal.vue';
import { api } from '../api/client.js';
import { STATUS } from '../util/format.js';
import { ageLabel } from '../util/compare.js';
import { normalizeAreaLabel, estimateExclM2 } from '../util/area.js';

const props = defineProps({
  regionItems: { type: Array, required: true }, // 구 목록 (RegionSearch 와 같은 항목)
  defaultSigunguCd: { type: String, default: null },
  pickedPin: { type: Object, default: null }, // 지도 클릭·우클릭으로 받은 좌표
  initialDanjiId: { type: String, default: null }, // 지도 우클릭 카드에서 고른 단지
  initialPlace: { type: Object, default: null }, // 우클릭 위치 주소 (식별정보 없는 위치 직접 추가)
});
const emit = defineEmits(['close', 'saved', 'pick-pin']);

/** exclAuto: 전용㎡를 라벨에서 추정 중 (사용자가 직접 고치면 false) */
function newArea(isPrimary = false) {
  return { label: '', exclM2: '', exclAuto: true, rooms: '', baths: '', note: '', isPrimary };
}

const form = reactive({
  displayNm: '',
  sigunguCd: props.initialPlace?.sigunguCd ?? props.defaultSigunguCd ?? '',
  jibunAddr: props.initialPlace?.jibunAddr ?? '',
  lat: null,
  lng: null,
  status: 'INTEREST',
  tags: '',
  areaTypes: [newArea(true)],
  master: { useAprDay: '', hhldCnt: '', dongCnt: '', maxFloor: '', hallType: '', farRatio: '' },
});
const error = ref(null);
const saving = ref(false);

// 단지 식별정보 검색
const q = ref('');
const results = ref([]);
const searching = ref(false);
const kapt = ref(null); // 선택한 단지 (draft.kapt)
const tradeCnt = ref(null);
const syncing = ref(false);
const syncMsg = ref(null);

async function search() {
  if (!q.value.trim()) return;
  searching.value = true;
  error.value = null;
  try {
    const qs = new URLSearchParams({ q: q.value.trim() });
    if (form.sigunguCd) qs.set('sigunguCd', form.sigunguCd);
    results.value = (await api(`/api/kapt/search?${qs}`)).items;
    if (!results.value.length) error.value = '검색 결과가 없습니다 (시군구 선택을 풀거나 단지 식별정보 적재 여부 확인)';
  } catch (err) {
    error.value = err.message;
  } finally {
    searching.value = false;
  }
}

async function choose(item) {
  if (item.complexId) {
    error.value = `이미 등록된 단지입니다 (#${item.complexId})`;
    return;
  }
  let d;
  try {
    d = await api(`/api/kapt/${item.danjiId}/draft`);
  } catch (err) {
    error.value = err.message;
    return;
  }
  kapt.value = d.kapt;
  tradeCnt.value = d.tradeCnt;
  results.value = [];
  Object.assign(form, { displayNm: d.body.displayNm, sigunguCd: d.body.sigunguCd, jibunAddr: d.body.jibunAddr ?? '' });
  const m = d.body.master;
  Object.assign(form.master, { useAprDay: m.useAprDay ?? '', hhldCnt: m.hhldCnt ?? '', dongCnt: m.dongCnt ?? '' });
  if (d.areaCandidates.length) {
    form.areaTypes = d.areaCandidates.map((a, i) => ({ ...newArea(i === 0), label: a.label, exclM2: a.exclM2, exclAuto: false, count: a.count }));
  }
}

/** 이 시군구 실거래를 받아 평형 후보를 다시 만든다 (외부 API — 등록 경로에서만) */
async function syncTrades() {
  syncing.value = true;
  syncMsg.value = null;
  try {
    const r = await api('/api/sync/trades', { method: 'POST', body: { sigunguCd: kapt.value.sigunguCd, months: 12 } });
    syncMsg.value = `실거래 ${r.results.reduce((s, x) => s + x.inserted, 0)}건 추가`;
    await choose({ danjiId: kapt.value.danjiId });
  } catch (err) {
    syncMsg.value = err.message;
  } finally {
    syncing.value = false;
  }
}

function clearKapt() {
  kapt.value = null;
  tradeCnt.value = null;
}

watch(
  () => props.pickedPin,
  (p) => {
    if (p) {
      form.lat = Math.round(p.lat * 1e6) / 1e6;
      form.lng = Math.round(p.lng * 1e6) / 1e6;
    }
  },
  { immediate: true },
);

onMounted(() => props.initialDanjiId && choose({ danjiId: props.initialDanjiId }));

const sigunguOptions = computed(() => props.regionItems.filter((i) => i.kind === 'SIGUNGU'));
const pinMissing = computed(() => typeof form.lat !== 'number' || typeof form.lng !== 'number');

function addArea() {
  form.areaTypes.push(newArea());
}
/** 라벨 입력: 전용㎡를 직접 고치지 않았으면 평 숫자로 추정값을 채운다 */
function onLabelInput(a, v) {
  a.label = v;
  if (!a.exclAuto) return;
  const est = estimateExclM2(v);
  a.exclM2 = est == null ? '' : String(est);
}
function onExclInput(a, v) {
  a.exclM2 = v;
  a.exclAuto = v.trim() === ''; // 비우면 다시 추정
}
function removeArea(i) {
  const wasPrimary = form.areaTypes[i].isPrimary;
  form.areaTypes.splice(i, 1);
  if (!form.areaTypes.length) addArea();
  if (wasPrimary) form.areaTypes[0].isPrimary = true;
}
function setPrimary(i) {
  form.areaTypes.forEach((a, j) => (a.isPrimary = i === j));
}

const optNum = (v) => (v === '' || v == null ? null : Number(v));
const blankRow = (a) => !String(a.label).trim() && String(a.exclM2).trim() === '';

/** 서버 검증(전용㎡ > 0, 평형 1개 이상) 전에 화면에서 먼저 알려준다 */
function areaError() {
  const rows = form.areaTypes.filter((a) => !blankRow(a));
  if (!rows.length) return '평형을 1개 이상 입력하세요 (전용㎡ 필수)';
  const bad = rows.find((a) => !(Number(String(a.exclM2).trim()) > 0));
  if (bad) return `평형 "${String(bad.label).trim() || '(라벨 없음)'}"의 전용㎡를 입력하세요 (예: 59.97)`;
  if (rows.some((a) => !String(a.label).trim())) return '평형 라벨을 입력하세요 (예: 24평)';
  return null;
}

async function save() {
  error.value = null;
  if (pinMissing.value && !kapt.value) {
    error.value = '위치를 지정하세요 (지도 클릭 또는 좌표 입력)';
    return;
  }
  error.value = areaError();
  if (error.value) return;
  saving.value = true;
  try {
    const m = form.master;
    const body = {
      displayNm: form.displayNm.trim(),
      sigunguCd: form.sigunguCd,
      jibunAddr: form.jibunAddr.trim() || null,
      ...(kapt.value && { kaptDanjiId: kapt.value.danjiId, bjdCd: kapt.value.bjdCd, jibun: kapt.value.jibun, roadAddr: kapt.value.roadAddr }),
      lat: pinMissing.value ? null : form.lat,
      lng: pinMissing.value ? null : form.lng,
      status: form.status,
      tags: form.tags.split(/[,#\s]+/).map((t) => t.trim()).filter(Boolean),
      areaTypes: form.areaTypes
        .filter((a) => !blankRow(a))
        .map((a) => ({
          label: normalizeAreaLabel(a.label),
          exclM2: Number(String(a.exclM2).trim()),
          rooms: optNum(a.rooms),
          baths: optNum(a.baths),
          note: String(a.note ?? '').trim() || null,
          isPrimary: a.isPrimary,
        })),
      master: {
        useAprDay: m.useAprDay || null,
        hhldCnt: optNum(m.hhldCnt),
        dongCnt: optNum(m.dongCnt),
        maxFloor: optNum(m.maxFloor),
        hallType: m.hallType.trim() || null,
        farRatio: optNum(m.farRatio),
      },
    };
    emit('saved', await api('/api/complexes/manual', { method: 'POST', body }));
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal title="단지 추가" size="lg" @close="emit('close')">
    <ol class="steps">
      <!-- 1. 단지 찾기 -->
      <li class="step">
        <h3><span class="no">1</span>단지 찾기</h3>
        <template v-if="!kapt">
          <p class="hint">단지명이나 주소로 찾으면 기본 정보와 평형 후보가 채워집니다. 목록에 없으면 2단계부터 직접 입력하세요.</p>
          <form class="search" @submit.prevent="search">
            <input v-model="q" placeholder="단지명 또는 주소 (예: 벽산블루밍, 봉천동 1718)" aria-label="단지 검색" />
            <button type="submit" class="btn primary" :disabled="searching">{{ searching ? '찾는 중…' : '찾기' }}</button>
          </form>
          <ul v-if="results.length" class="results">
            <li v-for="r in results" :key="r.danjiId">
              <button type="button" class="result" :disabled="!!r.complexId" @click="choose(r)">
                <span class="r-main">
                  <b>{{ r.name }}</b>
                  <small>{{ r.addr }}</small>
                </span>
                <span class="r-meta">
                  <span>{{ r.hhldCnt ? `${r.hhldCnt.toLocaleString()}세대` : '-' }}</span>
                  <span>{{ r.useAprDay?.slice(0, 4) ?? '-' }}년</span>
                </span>
                <span v-if="r.complexId" class="tag">등록됨</span>
              </button>
            </li>
          </ul>
        </template>
        <div v-else class="picked">
          <div class="p-head">
            <div>
              <b>{{ kapt.name }}</b>
              <small>{{ kapt.addr }}</small>
            </div>
            <button type="button" class="btn ghost" @click="clearKapt">다른 단지 찾기</button>
          </div>
          <dl class="p-facts">
            <div><dt>사용승인</dt><dd>{{ kapt.useAprDay ? ageLabel(kapt.useAprDay) : '-' }}</dd></div>
            <div><dt>세대수</dt><dd>{{ kapt.hhldCnt?.toLocaleString() ?? '-' }}</dd></div>
            <div><dt>동 수</dt><dd>{{ kapt.dongCnt ?? '-' }}</dd></div>
            <div><dt>실거래</dt><dd>{{ tradeCnt }}건</dd></div>
          </dl>
          <p class="p-foot">
            <span class="muted">단지고유번호 {{ kapt.danjiId }} · 기준일 {{ kapt.baseDate }}</span>
            <button type="button" class="btn" :disabled="syncing" @click="syncTrades">{{ syncing ? '받는 중…' : '실거래 12개월 받기' }}</button>
            <span v-if="syncMsg" class="sync-msg">{{ syncMsg }}</span>
          </p>
        </div>
      </li>

      <!-- 2. 위치와 상태 -->
      <li class="step">
        <h3><span class="no">2</span>위치와 상태</h3>
        <div class="grid loc">
          <label class="wide">단지명 <input v-model="form.displayNm" maxlength="100" required placeholder="지도에 표시할 이름" /></label>
          <label>
            시군구
            <input v-if="kapt" :value="kapt.sigunguCd" readonly />
            <select v-else v-model="form.sigunguCd">
              <option value="" disabled>선택</option>
              <option v-for="s in sigunguOptions" :key="s.key" :value="s.key">{{ s.sub }} {{ s.label }}</option>
            </select>
          </label>
          <label>지번 주소 <input v-model="form.jibunAddr" maxlength="200" /></label>
        </div>

        <div class="pin" :class="{ set: !pinMissing }">
          <div class="pin-state">
            <b>{{ pinMissing ? '지도 위치 미지정' : '지도 위치 지정됨' }}</b>
            <small v-if="pinMissing">{{ kapt ? '비워 두면 핀 없이 등록하고 나중에 지정할 수 있습니다' : '지도를 클릭하거나 좌표를 입력하세요' }}</small>
          </div>
          <input v-model.number="form.lat" type="number" step="0.000001" class="coord" placeholder="위도" aria-label="위도" />
          <input v-model.number="form.lng" type="number" step="0.000001" class="coord" placeholder="경도" aria-label="경도" />
          <button type="button" class="btn" @click="emit('pick-pin')">지도에서 지정</button>
        </div>

        <div class="field">
          <span class="label">상태</span>
          <div class="seg" role="radiogroup" aria-label="상태">
            <button
              v-for="(s, code) in STATUS"
              :key="code"
              type="button"
              role="radio"
              class="chip status"
              :class="{ on: form.status === code }"
              :aria-checked="form.status === code"
              :style="{ '--dot': s.color }"
              @click="form.status = code"
            >
              {{ s.label }}
            </button>
          </div>
        </div>
        <label class="field">태그 <input v-model="form.tags" placeholder="언덕, 대단지, 역세권 (쉼표로 구분)" /></label>
      </li>

      <!-- 3. 평형 -->
      <li class="step">
        <h3>
          <span class="no">3</span>평형
          <small v-if="kapt && tradeCnt">실거래 면적으로 만든 후보입니다. 라벨·면적을 확인하세요</small>
          <small v-else>라벨에 숫자만 입력하면 '평'이 붙고, 전용㎡ 추정값이 채워집니다</small>
        </h3>
        <table class="areas">
          <thead>
            <tr>
              <th class="c-pri">대표</th><th>라벨</th><th>전용㎡</th><th class="c-s">방</th><th class="c-s">욕실</th>
              <th v-if="kapt" class="c-s">거래</th><th class="c-note">비고</th><th class="c-x" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="(a, i) in form.areaTypes" :key="i" :class="{ primary: a.isPrimary }">
              <td class="c-pri"><input type="radio" name="primary" :checked="a.isPrimary" aria-label="대표 평형" @change="setPrimary(i)" /></td>
              <td class="c-lbl">
                <input :value="a.label" placeholder="24" maxlength="20" aria-label="평형 라벨 (숫자만 입력하면 평이 붙습니다)" @input="onLabelInput(a, $event.target.value)" @blur="a.label = normalizeAreaLabel(a.label)" />
              </td>
              <td class="c-m2">
                <span class="m2">
                  <input :value="a.exclM2" inputmode="decimal" placeholder="59.97" aria-label="전용면적" :class="{ est: a.exclAuto && a.exclM2 !== '' }" @input="onExclInput(a, $event.target.value)" />
                  <small v-if="a.exclAuto && a.exclM2 !== ''" class="est-tag" title="라벨의 평 숫자로 계산한 추정값입니다. 실제 전용면적으로 고쳐 주세요">추정</small>
                </span>
              </td>
              <td class="c-s"><input v-model="a.rooms" inputmode="numeric" aria-label="방 수" /></td>
              <td class="c-s"><input v-model="a.baths" inputmode="numeric" aria-label="욕실 수" /></td>
              <td v-if="kapt" class="c-s muted num">{{ a.count ?? '' }}</td>
              <td class="c-note"><input v-model="a.note" maxlength="200" placeholder="판상형, 확장형 등" aria-label="비고" /></td>
              <td class="c-x">
                <button type="button" class="x" :aria-label="`${a.label || '평형'} 삭제`" @click="removeArea(i)">×</button>
              </td>
            </tr>
          </tbody>
        </table>
        <button type="button" class="btn ghost add" @click="addArea">+ 평형 추가</button>
      </li>

      <!-- 4. 건물 정보 -->
      <li class="step">
        <h3><span class="no">4</span>건물 정보 <small>{{ kapt ? '단지 식별정보 값입니다. 수정할 수 있습니다' : '선택 입력' }}</small></h3>
        <div class="grid">
          <label>사용승인일 <input v-model="form.master.useAprDay" type="date" /></label>
          <label>세대수 <input v-model="form.master.hhldCnt" inputmode="numeric" /></label>
          <label>동 수 <input v-model="form.master.dongCnt" inputmode="numeric" /></label>
          <label>최고층 <input v-model="form.master.maxFloor" inputmode="numeric" /></label>
          <label>복도유형 <input v-model="form.master.hallType" placeholder="복도식 / 계단식 / 혼합식" /></label>
          <label>용적률(%) <input v-model="form.master.farRatio" inputmode="decimal" /></label>
        </div>
      </li>
    </ol>

    <template #footer>
      <span v-if="error" class="err" role="alert">{{ error }}</span>
      <button type="button" class="btn" @click="emit('close')">취소</button>
      <button type="button" class="btn primary" :disabled="saving" @click="save">{{ saving ? '등록 중…' : '단지 등록' }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.steps { list-style: none; margin: 0; padding: 0; }
.step { position: relative; padding: 0 0 26px 40px; }
.step + .step { padding-top: 22px; border-top: 1px solid var(--line); }
/* 단계 사이 세로선 */
.step::before { content: ''; position: absolute; left: 13px; top: 30px; bottom: 0; width: 1px; background: var(--line); }
.step + .step::before { top: 52px; }
.step:last-child { padding-bottom: 4px; }
.step:last-child::before { display: none; }
h3 { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin: 0 0 12px; font-size: 16px; font-weight: 700; letter-spacing: -0.02em; }
h3 small { font-size: 12.5px; font-weight: 400; color: var(--muted); }
.no {
  position: absolute; left: 0; width: 27px; height: 27px; display: grid; place-items: center; transform: translateY(-3px);
  border-radius: 50%; background: var(--ink); color: #fff; font-size: 13px; font-weight: 700;
}
.hint { margin: -4px 0 12px; color: var(--muted); font-size: 13px; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px 16px; }
.grid .wide { grid-column: 1 / -1; }
.grid.loc { grid-template-columns: minmax(150px, 200px) 1fr; }
label, .field { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; font-weight: 500; color: var(--muted); }
.field { margin-top: 14px; }
.label { font-size: 12.5px; }
input, select { padding: 9px 11px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); font: inherit; font-size: 14px; color: var(--text); background: var(--panel); min-width: 0; }
input[readonly] { background: var(--surface-2); color: var(--muted); }
input::placeholder { color: #a9adb4; }

/* 1. 찾기 */
.search { display: flex; gap: 8px; }
.search input { flex: 1; border-radius: 999px; padding-left: 16px; }
.search .btn { border-radius: 999px; padding: 8px 20px; }
.results { list-style: none; margin: 10px 0 0; padding: 4px; max-height: 280px; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius); }
.result {
  display: flex; gap: 12px; align-items: center; width: 100%; text-align: left; border: 0; border-radius: var(--radius-sm);
  background: none; padding: 9px 10px; cursor: pointer; font: inherit; color: var(--text);
}
.result:hover:not(:disabled) { background: var(--surface-2); }
.result:disabled { cursor: default; opacity: 0.55; }
.r-main { flex: 1; min-width: 0; }
.r-main b { display: block; font-family: var(--serif); font-size: 15px; font-weight: 700; }
.r-main small { color: var(--muted); font-size: 12px; }
.r-meta { display: flex; gap: 10px; font-size: 12.5px; color: var(--muted); white-space: nowrap; }
.tag { font-size: 11.5px; color: var(--accent); background: var(--accent-soft); padding: 2px 8px; border-radius: 999px; }
.picked { border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
.p-head { display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: var(--accent-soft); border-bottom: 1px solid var(--line); }
.p-head div { flex: 1; min-width: 0; }
.p-head b { display: block; font-family: var(--serif); font-size: 19px; font-weight: 700; letter-spacing: -0.02em; }
.p-head small { color: var(--muted); font-size: 12.5px; }
.p-facts { display: grid; grid-template-columns: repeat(4, 1fr); margin: 0; }
.p-facts div { padding: 10px 16px; }
.p-facts div + div { border-left: 1px solid var(--line); }
.p-facts dt { font-size: 11.5px; color: var(--muted); }
.p-facts dd { margin: 2px 0 0; font-size: 14px; font-weight: 600; }
.p-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0; padding: 10px 16px; border-top: 1px solid var(--line); font-size: 12px; }
.p-foot .muted { margin-right: auto; }
.sync-msg { color: var(--good); }

/* 2. 위치 */
.pin { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 14px; padding: 12px 14px; border-radius: var(--radius); background: var(--surface-2); border: 1px dashed var(--line-strong); }
.pin.set { border-style: solid; border-color: var(--line); background: var(--tint-good); }
.pin-state { flex: 1; min-width: 180px; }
.pin-state b { display: block; font-size: 13.5px; }
.pin.set .pin-state b { color: var(--good); }
.pin-state small { color: var(--muted); font-size: 12px; }
.coord { width: 120px; font-size: 13px; padding: 7px 9px; }
.seg { display: flex; flex-wrap: wrap; gap: 6px; }
.seg .chip { padding: 6px 13px; font-size: 13px; }

/* 3. 평형 */
.areas { width: 100%; border-collapse: collapse; }
.areas th { padding: 0 8px 6px 0; text-align: left; font-size: 12px; font-weight: 500; color: var(--muted); }
.areas td { padding: 4px 8px 4px 0; }
.areas tr.primary td input:not([type='radio']) { border-color: var(--accent); }
.areas .c-pri { width: 44px; text-align: center; }
.areas .c-s { width: 64px; }
.areas .c-s input { width: 100%; }
.areas .c-x { width: 28px; }
.areas .c-lbl { width: 18%; }
.areas .c-m2 { width: 20%; }
.areas .c-note { width: 30%; }
.m2 { position: relative; display: block; }
.m2 input.est { color: var(--muted); font-style: italic; padding-right: 44px; }
.est-tag {
  position: absolute; right: 7px; top: 50%; transform: translateY(-50%); pointer-events: none;
  font-size: 10.5px; color: var(--accent); background: var(--accent-soft); padding: 1px 6px; border-radius: 999px;
}
.areas td input:not([type='radio']) { width: 100%; }
.num { text-align: right; font-size: 13px; }
.x { border: 0; background: none; color: var(--muted); font-size: 18px; line-height: 1; padding: 2px 4px; border-radius: 4px; }
.x:hover { color: var(--up); background: var(--tint-bad); }
.add { margin-top: 6px; padding-left: 0; color: var(--accent); }

.err { color: var(--up); font-size: 13px; margin-right: auto; }
</style>
