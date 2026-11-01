<script setup>
// 단지 등록 (계획서 §5.4) — 단지 식별정보(한국부동산원 CSV → kapt_ref) 검색으로 채우거나 직접 입력
// 검색 결과·평형 후보는 제안값이며 사용자가 확인·수정한 값만 저장한다.
// 핀 좌표는 "지도에서 위치 지정"으로 지도를 클릭해 확정한다 (지오코딩 결과는 저장하지 않음, §5.3). 지도 키가 없으면 나중에 지정.
import { computed, reactive, ref, watch } from 'vue';
import Modal from './Modal.vue';
import { api } from '../api/client.js';
import { STATUS } from '../util/format.js';

const props = defineProps({
  regionItems: { type: Array, required: true }, // 구 목록 (RegionSearch 와 같은 항목)
  defaultSigunguCd: { type: String, default: null },
  pickedPin: { type: Object, default: null }, // 지도 클릭으로 받은 좌표
});
const emit = defineEmits(['close', 'saved', 'pick-pin']);

const form = reactive({
  displayNm: '',
  sigunguCd: props.defaultSigunguCd ?? '',
  jibunAddr: '',
  lat: null,
  lng: null,
  status: 'INTEREST',
  tags: '',
  areaTypes: [{ label: '', exclM2: '', rooms: '', baths: '', isPrimary: true }],
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
  const d = await api(`/api/kapt/${item.danjiId}/draft`);
  kapt.value = d.kapt;
  tradeCnt.value = d.tradeCnt;
  results.value = [];
  Object.assign(form, { displayNm: d.body.displayNm, sigunguCd: d.body.sigunguCd, jibunAddr: d.body.jibunAddr ?? '' });
  const m = d.body.master;
  Object.assign(form.master, { useAprDay: m.useAprDay ?? '', hhldCnt: m.hhldCnt ?? '', dongCnt: m.dongCnt ?? '' });
  if (d.areaCandidates.length) {
    form.areaTypes = d.areaCandidates.map((a, i) => ({ label: a.label, exclM2: a.exclM2, rooms: '', baths: '', isPrimary: i === 0, count: a.count }));
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
);

const sigunguOptions = computed(() => props.regionItems.filter((i) => i.kind === 'SIGUNGU'));
const pinMissing = computed(() => typeof form.lat !== 'number' || typeof form.lng !== 'number');

function addArea() {
  form.areaTypes.push({ label: '', exclM2: '', rooms: '', baths: '', isPrimary: false });
}
function setPrimary(i) {
  form.areaTypes.forEach((a, j) => (a.isPrimary = i === j));
}

const optNum = (v) => (v === '' || v == null ? null : Number(v));

async function save() {
  error.value = null;
  if (pinMissing.value && !kapt.value) {
    error.value = '위치를 지정하세요 (지도 클릭 또는 좌표 입력)';
    return;
  }
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
        .filter((a) => a.label.trim() || a.exclM2 !== '')
        .map((a) => ({
          label: a.label.trim(),
          exclM2: Number(a.exclM2),
          rooms: optNum(a.rooms),
          baths: optNum(a.baths),
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
    <section class="kapt">
      <form class="search" @submit.prevent="search">
        <input v-model="q" placeholder="단지명 또는 주소 (예: 벽산블루밍, 봉천동 1718)" aria-label="단지 검색" />
        <button type="submit" class="btn" :disabled="searching">{{ searching ? '검색 중…' : '단지 식별정보 검색' }}</button>
      </form>
      <ul v-if="results.length" class="results">
        <li v-for="r in results" :key="r.danjiId">
          <button type="button" class="result" :disabled="!!r.complexId" @click="choose(r)">
            <b>{{ r.name }}</b>
            <span class="muted">{{ r.addr }} · {{ r.hhldCnt ?? '-' }}세대 · {{ r.useAprDay?.slice(0, 4) ?? '-' }}년</span>
            <span v-if="r.complexId" class="tag">등록됨</span>
          </button>
        </li>
      </ul>
      <p v-if="kapt" class="picked">
        <span>선택: <b>{{ kapt.name }}</b> ({{ kapt.addr }}) — 단지고유번호 {{ kapt.danjiId }}, 기준일 {{ kapt.baseDate }}</span>
        <button type="button" class="btn" @click="clearKapt">선택 해제</button>
      </p>
      <p v-if="kapt" class="muted small">
        평형 후보: 같은 필지 실거래 {{ tradeCnt }}건 기준<template v-if="!tradeCnt"> — 수집된 실거래가 없습니다</template>.
        <button type="button" class="btn" :disabled="syncing" @click="syncTrades">{{ syncing ? '받는 중…' : '이 시군구 실거래 12개월 받기' }}</button>
        <span v-if="syncMsg">{{ syncMsg }}</span>
      </p>
    </section>
    <div class="grid">
      <label>단지명 <input v-model="form.displayNm" maxlength="100" required /></label>
      <label>
        시군구
        <input v-if="kapt" :value="kapt.sigunguCd" readonly />
        <select v-else v-model="form.sigunguCd">
          <option value="" disabled>선택</option>
          <option v-for="s in sigunguOptions" :key="s.key" :value="s.key">{{ s.sub }} {{ s.label }}</option>
        </select>
      </label>
      <label>지번 주소 <input v-model="form.jibunAddr" maxlength="200" /></label>
      <label>
        상태
        <select v-model="form.status">
          <option v-for="(s, code) in STATUS" :key="code" :value="code">{{ s.label }}</option>
        </select>
      </label>
      <div class="pin">
        <span>위치 (위도, 경도)</span>
        <input v-model.number="form.lat" type="number" step="0.000001" class="coord" aria-label="위도" />
        <input v-model.number="form.lng" type="number" step="0.000001" class="coord" aria-label="경도" />
        <button type="button" class="btn" @click="emit('pick-pin')">지도에서 위치 지정</button>
        <span v-if="kapt && pinMissing" class="muted">비워 두면 핀 없이 등록 (나중에 지정)</span>
      </div>
      <label>태그 <input v-model="form.tags" placeholder="언덕, 대단지, 역세권" /></label>
    </div>

    <h3>평형</h3>
    <table class="areas">
      <thead>
        <tr><th>대표</th><th>라벨</th><th>전용㎡</th><th>방</th><th>화</th><th v-if="kapt">거래</th></tr>
      </thead>
      <tbody>
        <tr v-for="(a, i) in form.areaTypes" :key="i">
          <td><input type="radio" name="primary" :checked="a.isPrimary" aria-label="대표 평형" @change="setPrimary(i)" /></td>
          <td><input v-model="a.label" placeholder="23평" maxlength="20" aria-label="평형 라벨" /></td>
          <td><input v-model="a.exclM2" inputmode="decimal" placeholder="59.97" aria-label="전용면적" /></td>
          <td><input v-model="a.rooms" inputmode="numeric" class="s" aria-label="방 수" /></td>
          <td><input v-model="a.baths" inputmode="numeric" class="s" aria-label="화장실 수" /></td>
          <td v-if="kapt" class="muted">{{ a.count ?? '' }}</td>
        </tr>
      </tbody>
    </table>
    <button type="button" class="btn" @click="addArea">평형 추가</button>

    <h3>기본정보 <small class="muted">{{ kapt ? '(단지 식별정보 값 — 수정 가능)' : '(선택)' }}</small></h3>
    <div class="grid">
      <label>사용승인일 <input v-model="form.master.useAprDay" type="date" /></label>
      <label>세대수 <input v-model="form.master.hhldCnt" inputmode="numeric" /></label>
      <label>동 수 <input v-model="form.master.dongCnt" inputmode="numeric" /></label>
      <label>최고층 <input v-model="form.master.maxFloor" inputmode="numeric" /></label>
      <label>복도유형 <input v-model="form.master.hallType" placeholder="복도식/계단식/혼합식" /></label>
      <label>용적률(%) <input v-model="form.master.farRatio" inputmode="decimal" /></label>
    </div>

    <template #footer>
      <span v-if="error" class="err">{{ error }}</span>
      <button type="button" class="btn" @click="emit('close')">취소</button>
      <button type="button" class="btn primary" :disabled="saving" @click="save">{{ saving ? '저장 중…' : '등록' }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.small { font-size: 13px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px 16px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
input, select { padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; font: inherit; color: var(--text); }
.pin { display: flex; gap: 8px; align-items: center; font-size: 13px; flex-wrap: wrap; grid-column: 1 / -1; color: var(--muted); }
.coord { width: 130px; }
h3 { font-size: 15px; margin: 18px 0 8px; }
.areas { border-collapse: collapse; margin-bottom: 8px; }
.areas th, .areas td { padding: 4px; text-align: left; font-size: 13px; }
.areas input.s { width: 56px; }
.err { color: var(--up); font-size: 13px; margin-right: auto; }
.kapt { border: 1px solid var(--line); border-radius: var(--radius); padding: 10px; margin-bottom: 14px; }
.search { display: flex; gap: 8px; }
.search input { flex: 1; min-width: 0; }
.results { list-style: none; margin: 8px 0 0; padding: 0; max-height: 240px; overflow: auto; }
.result { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--line);
  background: none; padding: 6px 4px; cursor: pointer; font: inherit; }
.result:hover:not(:disabled) { background: var(--bg); }
.result:disabled { cursor: default; opacity: 0.6; }
.tag { font-size: 12px; color: var(--accent); }
.picked { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0 0; font-size: 14px; }
</style>
