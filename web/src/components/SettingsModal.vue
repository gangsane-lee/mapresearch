<script setup>
// 설정 (계획서 §7.5): 예산, 지도 엔진, 표시 기준, 기준점, API 쿼터, 백업 상태
import { computed, onMounted, reactive, ref } from 'vue';
import Modal from './Modal.vue';
import { api } from '../api/client.js';
import { formatMan } from '../util/format.js';
import { parseManwon } from '../../../shared/unit.js';

const emit = defineEmits(['close', 'saved']);

const settings = reactive({});
const anchors = ref([]);
const quota = ref([]);
const backup = ref(null);
const budgetInput = ref('');
const error = ref(null);
const message = ref(null);

const budgetPreview = computed(() => {
  if (!budgetInput.value) return '미설정';
  try {
    return formatMan(parseManwon(budgetInput.value));
  } catch (e) {
    return e.message;
  }
});

async function load() {
  error.value = null;
  try {
    const [s, a, q, b] = await Promise.all([api('/api/settings'), api('/api/anchors'), api('/api/quota'), api('/api/backup/status')]);
    for (const it of s.items) settings[it.key] = it.value;
    budgetInput.value = settings.budget_man ? formatMan(Number(settings.budget_man)).replace(/,/g, '') : '';
    anchors.value = a.items.map((x) => ({ ...x }));
    quota.value = q.items;
    backup.value = b;
  } catch (err) {
    error.value = err.message;
  }
}
onMounted(load);

async function saveSettings() {
  error.value = null;
  message.value = null;
  try {
    let budget = null;
    if (budgetInput.value.trim()) budget = parseManwon(budgetInput.value);
    const body = {
      budget_man: budget,
      budget_source: settings.budget_source,
      map_engine: settings.map_engine,
      stale_days: settings.stale_days,
      area_match_tolerance_m2: settings.area_match_tolerance_m2,
    };
    for (const k of ['traffic', 'env', 'edu', 'price']) if (settings[`weight.${k}`] != null) body[`weight.${k}`] = settings[`weight.${k}`];
    for (const q of quota.value) body[`quota.${q.apiCd}.${q.period}`] = q.limit;
    await api('/api/settings', { method: 'PUT', body });
    message.value = '저장했습니다';
    emit('saved');
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

async function saveAnchor(a) {
  error.value = null;
  try {
    const body = {
      name: a.name,
      kind: a.kind,
      lat: a.lat === '' || a.lat == null ? null : Number(a.lat),
      lng: a.lng === '' || a.lng == null ? null : Number(a.lng),
      sort: Number(a.sort ?? 0),
      active: !!a.active,
    };
    if (a.anchorId) await api(`/api/anchors/${a.anchorId}`, { method: 'PUT', body });
    else await api('/api/anchors', { method: 'POST', body });
    message.value = `기준점 '${a.name}' 저장`;
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

function addAnchor() {
  anchors.value.push({ anchorId: null, name: '', kind: 'WORK', lat: '', lng: '', sort: (anchors.value.length + 1) * 10, active: true });
}

const API_NAMES = {
  KAKAO_TRANSIT: '카카오 대중교통 (초과 시 유료)',
  NCP_GEOCODE: '네이버 지오코딩',
  NCP_RGEOCODE: '네이버 역지오코딩 (지도 우클릭)',
  DATA_GO_KR_KAPT: '공동주택 정보',
  DATA_GO_KR_BLD: '건축물대장',
  DATA_GO_KR_RTMS: '매매 실거래',
  DATA_GO_KR_RENT: '전월세 실거래',
};
const warnRatio = computed(() => Number(settings.quota_warn_ratio ?? 0.7));
</script>

<template>
  <Modal title="설정" size="lg" @close="emit('close')">
    <section>
      <h3>예산</h3>
      <div class="row">
        <label>내 예산 <input v-model="budgetInput" placeholder="10억 / 100000" /></label>
        <span class="muted">= {{ budgetPreview }}</span>
        <label>
          출처
          <select v-model="settings.budget_source">
            <option value="MANUAL">직접 입력</option>
            <option value="HH" disabled>가계 시스템 연동 (P5)</option>
          </select>
        </label>
      </div>
    </section>

    <section>
      <h3>지도·표시</h3>
      <div class="row">
        <label>
          지도 엔진
          <select v-model="settings.map_engine">
            <option value="NAVER">네이버</option>
            <option value="KAKAO" disabled>카카오 (예비)</option>
          </select>
        </label>
        <label>관측일 경과 흐림(일) <input v-model="settings.stale_days" type="number" min="1" max="365" class="s" /></label>
        <label>평형 매칭 오차(㎡) <input v-model="settings.area_match_tolerance_m2" type="number" step="0.1" min="0" max="3" class="s" /></label>
      </div>
    </section>

    <section>
      <h3>종합점수 가중치 <small class="muted">(0~10, 비교 패널의 가중 점수)</small></h3>
      <div class="row">
        <label v-for="[k, l] in [['traffic', '교통'], ['env', '환경'], ['edu', '학군'], ['price', '가격']]" :key="k">
          {{ l }} <input v-model="settings[`weight.${k}`]" type="number" min="0" max="10" class="s" />
        </label>
      </div>
    </section>

    <section>
      <h3>외부 API 쿼터 <small class="muted">(무료 한도보다 낮게 — 서버가 호출 전에 차단)</small></h3>
      <table class="tbl">
        <thead><tr><th>API</th><th>기간</th><th>사용</th><th>한도</th></tr></thead>
        <tbody>
          <tr v-for="q in quota" :key="q.apiCd + q.period" :class="{ warn: q.limit && q.used / q.limit >= warnRatio }">
            <td>{{ API_NAMES[q.apiCd] ?? q.apiCd }}</td>
            <td>{{ q.period === 'DAY' ? '일' : '월' }}</td>
            <td>{{ q.used }}</td>
            <td><input v-model.number="q.limit" type="number" min="0" class="s" /></td>
          </tr>
        </tbody>
      </table>
    </section>

    <div class="actions">
      <span v-if="message" class="muted">{{ message }}</span>
      <span v-if="error" class="err">{{ error }}</span>
      <button type="button" class="btn primary" @click="saveSettings">설정 저장</button>
    </div>

    <section>
      <h3>기준점 <small class="muted">(직선거리·소요시간 기준, 삭제 대신 비활성)</small></h3>
      <table class="tbl">
        <thead><tr><th>이름</th><th>구분</th><th>위도</th><th>경도</th><th>순서</th><th>사용</th><th /></tr></thead>
        <tbody>
          <tr v-for="(a, i) in anchors" :key="a.anchorId ?? `new${i}`">
            <td><input v-model="a.name" maxlength="50" aria-label="기준점 이름" /></td>
            <td>
              <select v-model="a.kind" aria-label="구분">
                <option value="CBD">업무지구</option>
                <option value="WORK">직장</option>
              </select>
            </td>
            <td><input v-model="a.lat" type="number" step="0.000001" class="m" aria-label="위도" /></td>
            <td><input v-model="a.lng" type="number" step="0.000001" class="m" aria-label="경도" /></td>
            <td><input v-model="a.sort" type="number" class="s" aria-label="순서" /></td>
            <td><input v-model="a.active" type="checkbox" aria-label="사용" /></td>
            <td><button type="button" class="btn" @click="saveAnchor(a)">저장</button></td>
          </tr>
        </tbody>
      </table>
      <button type="button" class="btn" @click="addAnchor">기준점 추가</button>
    </section>

    <section>
      <h3>백업</h3>
      <p v-if="!backup?.found" class="muted">백업 기록이 없습니다. <code>npm run backup</code> 을 실행하거나 자동 실행(맥 launchd · 윈도우 작업 스케줄러)에 등록하세요.</p>
      <template v-else>
        <p>
          마지막 백업 {{ String(backup.endedAt ?? backup.startedAt).replace('T', ' ') }} —
          <b :class="backup.ok ? '' : 'err'">{{ backup.ok ? '성공' : `실패: ${backup.error}` }}</b>
        </p>
        <p v-if="backup.sameDisk" class="warn">백업이 원본과 같은 디스크에 있습니다. 디스크 고장 시 함께 손실됩니다.</p>
      </template>
    </section>
  </Modal>
</template>

<style scoped>
section { margin-bottom: 20px; }
h3 { font-size: 15px; margin: 0 0 8px; }
.row { display: flex; gap: 16px; flex-wrap: wrap; align-items: end; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
input, select { padding: 5px 7px; border: 1px solid var(--line); border-radius: 6px; font: inherit; color: var(--text); }
input.s { width: 80px; }
input.m { width: 120px; }
.tbl { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 8px; }
.tbl th, .tbl td { padding: 4px 6px; border-bottom: 1px solid var(--line); text-align: left; }
.tbl tr.warn td { background: var(--tint-warn); }
.actions { display: flex; gap: 12px; justify-content: flex-end; align-items: center; margin-bottom: 20px; }
.err { color: var(--up); }
.warn { color: var(--warn); }
</style>
