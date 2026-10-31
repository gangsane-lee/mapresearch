<script setup>
// A7 임장 일정 (계획서 §10): 월 달력에 계획(●)과 실제 스냅샷 기록(■)을 함께 표시
import { computed, onMounted, reactive, ref } from 'vue';
import Modal from './Modal.vue';
import { api } from '../api/client.js';
import { monthGrid, ymdOf } from '../util/calendar.js';

const props = defineProps({ complexes: { type: Array, required: true } }); // 요약 목록 (단지 선택용)
const emit = defineEmits(['close', 'open-complex']);

const today = ymdOf(new Date());
const cur = reactive({ y: new Date().getFullYear(), m: new Date().getMonth() + 1 });
const data = ref({ visits: [], snapshots: [] });
const error = ref(null);
const selectedDate = ref(today);
const form = reactive({ complexId: '', plannedTime: '', memo: '' });

const grid = computed(() => monthGrid(cur.y, cur.m));

async function load() {
  error.value = null;
  try {
    data.value = await api(`/api/visits?from=${grid.value.from}&to=${grid.value.to}`);
  } catch (err) {
    error.value = err.message;
  }
}
onMounted(load);

function move(delta) {
  const d = new Date(cur.y, cur.m - 1 + delta, 1);
  cur.y = d.getFullYear();
  cur.m = d.getMonth() + 1;
  load();
}

const visitsOn = (date) => data.value.visits.filter((v) => v.plannedOn === date);
const snapsOn = (date) => data.value.snapshots.filter((s) => s.observedAt === date);

async function add() {
  error.value = null;
  try {
    await api('/api/visits', {
      method: 'POST',
      body: { complexId: Number(form.complexId), plannedOn: selectedDate.value, plannedTime: form.plannedTime || null, memo: form.memo || null },
    });
    form.memo = '';
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

async function setStatus(v, status) {
  try {
    const r = await api(`/api/visits/${v.visitId}`, { method: 'PATCH', body: { status } });
    if (status === 'DONE' && !r.snapshotId) error.value = `${v.displayNm}: 같은 날 스냅샷이 없어 연결하지 못했습니다 (스냅샷 입력 후 다시 완료 처리)`;
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

const STATUS = { PLANNED: '예정', DONE: '완료', CANCELED: '취소' };
</script>

<template>
  <Modal title="임장 일정" size="lg" @close="emit('close')">
    <div class="head">
      <button type="button" class="btn" aria-label="이전 달" @click="move(-1)">‹</button>
      <b>{{ cur.y }}년 {{ cur.m }}월</b>
      <button type="button" class="btn" aria-label="다음 달" @click="move(1)">›</button>
      <span class="muted small">● 계획 ■ 스냅샷 기록</span>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <table class="cal">
      <thead><tr><th v-for="d in ['월', '화', '수', '목', '금', '토', '일']" :key="d">{{ d }}</th></tr></thead>
      <tbody>
        <tr v-for="(w, wi) in grid.weeks" :key="wi">
          <td
            v-for="c in w"
            :key="c.date"
            :class="{ out: !c.inMonth, today: c.date === today, sel: c.date === selectedDate }"
            @click="selectedDate = c.date"
          >
            <span class="day">{{ c.day }}</span>
            <span v-for="v in visitsOn(c.date)" :key="'v' + v.visitId" class="ev plan" :class="v.status.toLowerCase()">● {{ v.displayNm }}</span>
            <span v-for="s in snapsOn(c.date)" :key="'s' + s.snapshotId" class="ev snap">■ {{ s.displayNm }}</span>
          </td>
        </tr>
      </tbody>
    </table>

    <section class="day-detail">
      <h3>{{ selectedDate }}</h3>
      <ul>
        <li v-for="v in visitsOn(selectedDate)" :key="v.visitId">
          <b>{{ v.plannedTime ?? '' }} {{ v.displayNm }}</b> <span class="chip">{{ STATUS[v.status] }}</span> {{ v.memo }}
          <template v-if="v.status === 'PLANNED'">
            <button type="button" class="btn" @click="setStatus(v, 'DONE')">완료</button>
            <button type="button" class="btn" @click="setStatus(v, 'CANCELED')">취소</button>
          </template>
          <button type="button" class="btn" @click="emit('open-complex', v.complexId)">단지 보기</button>
        </li>
        <li v-for="s in snapsOn(selectedDate)" :key="'s' + s.snapshotId" class="muted">■ {{ s.displayNm }} 스냅샷 #{{ s.snapshotId }}</li>
      </ul>
      <div class="add">
        <select v-model="form.complexId" aria-label="단지">
          <option value="" disabled>단지 선택</option>
          <option v-for="c in complexes" :key="c.complexId" :value="c.complexId">{{ c.displayNm }}</option>
        </select>
        <input v-model="form.plannedTime" type="time" aria-label="시간" />
        <input v-model="form.memo" maxlength="500" placeholder="메모 (중개사 약속 등)" />
        <button type="button" class="btn primary" :disabled="!form.complexId" @click="add">일정 추가</button>
      </div>
    </section>
  </Modal>
</template>

<style scoped>
.head { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; }
.small { font-size: 12px; }
.cal { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
.cal th { padding: 4px; color: var(--muted); }
.cal td { height: 72px; vertical-align: top; border: 1px solid var(--line); padding: 2px 4px; cursor: pointer; overflow: hidden; }
.cal td.out { background: #f8fafc; color: var(--muted); }
.cal td.today .day { background: var(--accent); color: #fff; border-radius: 50%; padding: 0 5px; }
.cal td.sel { outline: 2px solid var(--accent); outline-offset: -2px; }
.day { display: inline-block; margin-bottom: 2px; }
.ev { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ev.plan { color: var(--accent); }
.ev.plan.done { color: #16a34a; }
.ev.plan.canceled { color: var(--muted); text-decoration: line-through; }
.ev.snap { color: var(--text); }
.day-detail h3 { font-size: 15px; margin: 12px 0 6px; }
.day-detail ul { padding-left: 16px; }
.day-detail li { margin-bottom: 6px; }
.day-detail .btn { margin-left: 4px; padding: 2px 8px; }
.add { display: flex; gap: 8px; flex-wrap: wrap; }
.add input, .add select { padding: 5px 7px; border: 1px solid var(--line); border-radius: 6px; }
.add input[maxlength] { flex: 1; min-width: 160px; }
.err { color: var(--up); }
</style>
