<script setup>
// 배정 학교·학업성취도 (계획서 §3.2 #10·#11): 배정은 이력 관리, 성취도는 연도별 + 지표 정의 필수(U10)
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api/client.js';

const props = defineProps({ complexId: { type: Number, required: true } });

const KIND = { ELEM: '초', MIDDLE: '중', HIGH: '고' };
const list = ref([]);
const error = ref(null);
const showAdd = ref(false);
const search = ref('');
const found = ref([]);
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const form = reactive({
  schoolId: null,
  newName: '',
  newKind: 'MIDDLE',
  validFrom: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`,
  walkMin: '',
  busMin: '',
});
const stat = reactive({ schoolId: null, year: now.getFullYear() - 1, metricCd: 'ACHIEVE_AVG', metricDesc: '', value: '' });

async function load() {
  try {
    list.value = (await api(`/api/complexes/${props.complexId}/schools`)).items;
  } catch (err) {
    error.value = err.message;
  }
}
onMounted(load);

async function doSearch() {
  found.value = (await api(`/api/schools?q=${encodeURIComponent(search.value)}`)).items;
}

const opt = (v) => (v === '' || v == null ? null : Number(v));

async function assign() {
  error.value = null;
  try {
    let schoolId = form.schoolId;
    if (!schoolId) {
      if (!form.newName.trim()) throw new Error('학교를 검색해 고르거나 새 학교 이름을 입력하세요');
      schoolId = (await api('/api/schools', { method: 'POST', body: { schoolNm: form.newName.trim(), schoolKind: form.newKind } })).schoolId;
    }
    await api(`/api/complexes/${props.complexId}/schools`, {
      method: 'POST',
      body: { schoolId, validFrom: form.validFrom, walkMin: opt(form.walkMin), busMin: opt(form.busMin) },
    });
    showAdd.value = false;
    Object.assign(form, { schoolId: null, newName: '', walkMin: '', busMin: '' });
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

async function saveStat() {
  error.value = null;
  try {
    await api(`/api/schools/${stat.schoolId}/stats`, {
      method: 'PUT',
      body: { year: Number(stat.year), metricCd: stat.metricCd, metricDesc: stat.metricDesc, value: Number(stat.value) },
    });
    stat.schoolId = null;
    await load();
  } catch (err) {
    error.value = err.message;
  }
}
</script>

<template>
  <div class="schools">
    <h3>배정 학교</h3>
    <p v-if="error" class="err">{{ error }}</p>
    <table class="tbl">
      <thead><tr><th>학교</th><th>기간</th><th>통학</th><th>성취도</th><th /></tr></thead>
      <tbody>
        <tr v-for="s in list" :key="s.complexSchoolId" :class="{ past: !s.current }">
          <td>{{ s.schoolNm }} <small class="muted">{{ KIND[s.schoolKind] }}</small></td>
          <td>{{ s.validFrom }} ~ {{ s.validTo ?? '현재' }}</td>
          <td>{{ s.walkMin != null ? `도보 ${s.walkMin}분` : '' }}{{ s.busMin != null ? ` 버스 ${s.busMin}분` : '' }}</td>
          <td :title="s.latestStat?.metricDesc">{{ s.latestStat ? `${s.latestStat.value}% (${s.latestStat.year})` : '-' }}</td>
          <td><button v-if="s.current" type="button" class="btn" @click="stat.schoolId = s.schoolId">성취도 입력</button></td>
        </tr>
      </tbody>
    </table>
    <p v-if="!list.length" class="muted small">배정 학교가 없습니다.</p>

    <div v-if="stat.schoolId" class="box">
      <b>성취도 입력</b>
      <div class="row">
        <label>연도 <input v-model="stat.year" type="number" class="s" /></label>
        <label>값(%) <input v-model="stat.value" type="number" step="0.1" class="s" /></label>
        <label class="grow">지표 정의·출처 (필수) <input v-model="stat.metricDesc" maxlength="200" placeholder="예: 학교알리미 국영수 보통학력 이상 비율 평균" /></label>
      </div>
      <button type="button" class="btn primary" @click="saveStat">저장</button>
      <button type="button" class="btn" @click="stat.schoolId = null">취소</button>
    </div>

    <button v-if="!showAdd" type="button" class="btn" @click="showAdd = true">학교 배정 추가/변경</button>
    <div v-else class="box">
      <div class="row">
        <label class="grow">학교 검색 <input v-model="search" placeholder="학교명" @keydown.enter.prevent="doSearch" /></label>
        <button type="button" class="btn" @click="doSearch">검색</button>
      </div>
      <ul v-if="found.length" class="found">
        <li v-for="f in found" :key="f.schoolId">
          <label><input v-model="form.schoolId" type="radio" :value="f.schoolId" /> {{ f.schoolNm }} ({{ KIND[f.schoolKind] }})</label>
        </li>
      </ul>
      <div v-if="!form.schoolId" class="row">
        <label class="grow">또는 새 학교 <input v-model="form.newName" maxlength="50" placeholder="구암중학교" /></label>
        <label>급
          <select v-model="form.newKind">
            <option v-for="(l, k) in KIND" :key="k" :value="k">{{ l }}</option>
          </select>
        </label>
      </div>
      <div class="row">
        <label>배정 시작일 <input v-model="form.validFrom" type="date" /></label>
        <label>도보(분) <input v-model="form.walkMin" type="number" class="s" /></label>
        <label>버스(분) <input v-model="form.busMin" type="number" class="s" /></label>
      </div>
      <p class="muted small">같은 급의 기존 배정은 시작일 전날로 마감되어 이력으로 남습니다.</p>
      <button type="button" class="btn primary" @click="assign">배정</button>
      <button type="button" class="btn" @click="showAdd = false">취소</button>
    </div>
  </div>
</template>

<style scoped>
h3 { font-size: 15px; margin: 16px 0 8px; }
.tbl { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 8px; }
.tbl th, .tbl td { padding: 5px 6px; border-bottom: 1px solid var(--line); text-align: left; }
.tbl tr.past td { color: var(--muted); }
.box { border: 1px solid var(--line); border-radius: var(--radius); padding: 10px; margin: 8px 0; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.row { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; width: 100%; }
label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted); }
.grow { flex: 1; min-width: 180px; }
input, select { padding: 5px 7px; border: 1px solid var(--line); border-radius: 6px; font: inherit; color: var(--text); }
input.s { width: 80px; }
.found { list-style: none; padding: 0; margin: 0; font-size: 13px; }
.found label { flex-direction: row; color: var(--text); align-items: center; }
.small { font-size: 12px; }
.err { color: var(--up); }
</style>
