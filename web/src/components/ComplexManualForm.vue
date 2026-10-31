<script setup>
// 단지 수동 등록 (계획서 §5.4 9번) — 공공 API 연동 등록은 키·응답 확인(U1~U3) 후 추가
// 핀 좌표는 "지도에서 위치 지정"으로 지도를 클릭해 확정한다 (지오코딩 결과는 저장하지 않음, §5.3).
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

function addArea() {
  form.areaTypes.push({ label: '', exclM2: '', rooms: '', baths: '', isPrimary: false });
}
function setPrimary(i) {
  form.areaTypes.forEach((a, j) => (a.isPrimary = i === j));
}

const optNum = (v) => (v === '' || v == null ? null : Number(v));

async function save() {
  error.value = null;
  if (typeof form.lat !== 'number' || typeof form.lng !== 'number') {
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
      lat: form.lat,
      lng: form.lng,
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
  <Modal title="단지 추가 (수동 입력)" size="lg" @close="emit('close')">
    <p class="muted small">공공 API 연동 등록은 키 발급·응답 확인 후 제공됩니다. 지금은 직접 입력해 등록합니다.</p>
    <div class="grid">
      <label>단지명 <input v-model="form.displayNm" maxlength="100" required /></label>
      <label>
        시군구
        <select v-model="form.sigunguCd">
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
      </div>
      <label>태그 <input v-model="form.tags" placeholder="언덕, 대단지, 역세권" /></label>
    </div>

    <h3>평형</h3>
    <table class="areas">
      <thead>
        <tr><th>대표</th><th>라벨</th><th>전용㎡</th><th>방</th><th>화</th></tr>
      </thead>
      <tbody>
        <tr v-for="(a, i) in form.areaTypes" :key="i">
          <td><input type="radio" name="primary" :checked="a.isPrimary" aria-label="대표 평형" @change="setPrimary(i)" /></td>
          <td><input v-model="a.label" placeholder="23평" maxlength="20" aria-label="평형 라벨" /></td>
          <td><input v-model="a.exclM2" inputmode="decimal" placeholder="59.97" aria-label="전용면적" /></td>
          <td><input v-model="a.rooms" inputmode="numeric" class="s" aria-label="방 수" /></td>
          <td><input v-model="a.baths" inputmode="numeric" class="s" aria-label="화장실 수" /></td>
        </tr>
      </tbody>
    </table>
    <button type="button" class="btn" @click="addArea">평형 추가</button>

    <h3>기본정보 <small class="muted">(선택 — 나중에 공공 API로 대체)</small></h3>
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
</style>
