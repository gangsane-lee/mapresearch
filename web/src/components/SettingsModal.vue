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

const KIND = { HOME: '현재 집', WORK: '직장', CBD: '업무지구·역' };

/** 주소·건물명 → 좌표 후보 (네이버 지오코딩, 쿼터 가드). 고른 후보는 입력칸만 채우고, "저장"을 눌러야 반영 */
async function findCoord(a) {
  const query = String(a.q ?? '').trim();
  if (!query) return;
  a.searching = true;
  a.found = null;
  a.findError = null;
  try {
    a.found = (await api('/api/kapt/geocode', { method: 'POST', body: { query } })).items;
    if (!a.found.length) a.findError = '찾은 주소가 없습니다. 도로명주소나 "동 + 번지"로 다시 입력하세요';
  } catch (err) {
    a.findError = err.message;
  } finally {
    a.searching = false;
  }
}
function pickCoord(a, f) {
  a.lat = f.lat;
  a.lng = f.lng;
  a.addr = f.roadAddress ?? f.jibunAddress;
  a.found = null;
  a.dirty = true;
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
      <h3>기준점 <small class="muted">현재 집·직장·주요 역 — 단지마다 직선거리와 대중교통 시간(스냅샷 자동 계산)을 잽니다. 삭제 대신 "사용" 해제</small></h3>
      <div class="anchors">
        <div v-for="(a, i) in anchors" :key="a.anchorId ?? `new${i}`" class="anchor" :class="{ off: !a.active, missing: a.lat === '' || a.lat == null }">
          <div class="a-head">
            <select v-model="a.kind" class="kind" aria-label="구분">
              <option v-for="(l, k) in KIND" :key="k" :value="k">{{ l }}</option>
            </select>
            <input v-model="a.name" maxlength="50" class="name" placeholder="이름 (예: 우리 집, 판교 회사)" aria-label="기준점 이름" />
            <span class="coord-state">{{ a.lat === '' || a.lat == null ? '좌표 없음' : `${Number(a.lat).toFixed(5)}, ${Number(a.lng).toFixed(5)}` }}</span>
            <label class="use"><input v-model="a.active" type="checkbox" /> 사용</label>
            <button type="button" class="btn" :class="{ primary: a.dirty }" @click="saveAnchor(a)">저장</button>
          </div>
          <div class="a-find">
            <input v-model="a.q" placeholder="주소·건물명으로 좌표 찾기 (예: 판교역로 166, 테헤란로 152)" aria-label="주소 검색" @keydown.enter.prevent="findCoord(a)" />
            <button type="button" class="btn" :disabled="a.searching || !a.q" @click="findCoord(a)">{{ a.searching ? '찾는 중…' : '좌표 찾기' }}</button>
            <details class="manual">
              <summary>직접 입력</summary>
              <input v-model="a.lat" type="number" step="0.000001" class="m" placeholder="위도" aria-label="위도" @input="a.dirty = true" />
              <input v-model="a.lng" type="number" step="0.000001" class="m" placeholder="경도" aria-label="경도" @input="a.dirty = true" />
              <input v-model="a.sort" type="number" class="s" aria-label="순서" title="순서" />
            </details>
          </div>
          <ul v-if="a.found?.length" class="found">
            <li v-for="(f, j) in a.found" :key="j">
              <button type="button" @click="pickCoord(a, f)">
                <b>{{ f.roadAddress ?? f.jibunAddress }}</b>
                <small v-if="f.roadAddress && f.jibunAddress">{{ f.jibunAddress }}</small>
              </button>
            </li>
          </ul>
          <p v-if="a.addr && a.dirty" class="picked">✓ {{ a.addr }} — "저장"을 눌러 반영</p>
          <p v-if="a.findError" class="err small">{{ a.findError }}</p>
        </div>
      </div>
      <button type="button" class="btn" @click="addAnchor">＋ 기준점 추가</button>
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
.anchors { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.anchor { border: 1px solid var(--line); border-radius: var(--radius); padding: 10px 12px; background: var(--panel); }
.anchor.missing { border-color: var(--warn-line); background: var(--tint-warn); }
.anchor.off { opacity: 0.55; }
.a-head, .a-find { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.a-find { margin-top: 8px; }
.a-head .kind { width: 112px; }
.a-head .name { flex: 1; min-width: 160px; font-weight: 600; }
.coord-state { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; min-width: 150px; }
.missing .coord-state { color: var(--warn); font-weight: 600; }
.use { font-size: 12.5px; color: var(--muted); display: flex; gap: 4px; align-items: center; }
.a-find > input { flex: 1; min-width: 240px; }
.manual { font-size: 12.5px; color: var(--muted); }
.manual summary { cursor: pointer; }
.manual[open] { display: flex; gap: 6px; align-items: center; }
.found { list-style: none; margin: 8px 0 0; padding: 0; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.found li + li { border-top: 1px solid var(--line); }
.found button { width: 100%; text-align: left; border: 0; background: var(--panel); padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
.found button:hover { background: var(--accent-soft); }
.found small { color: var(--muted); font-size: 12px; }
.picked { margin: 6px 0 0; font-size: 12.5px; color: var(--good); }
.small { font-size: 12.5px; margin: 6px 0 0; }
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
