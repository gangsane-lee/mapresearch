<script setup>
// 국토부 정비사업 참고값 (redev_ref) — 같은 시군구 후보 중 이 단지의 구역을 수동 연결
import { onMounted, ref } from 'vue';
import { api } from '../api/client.js';

const props = defineProps({ complexId: { type: Number, required: true } });
const items = ref([]);
const q = ref('');
const error = ref(null);

async function load() {
  try {
    items.value = (await api(`/api/redev-refs?complexId=${props.complexId}&q=${encodeURIComponent(q.value)}`)).items;
  } catch (err) {
    error.value = err.message;
  }
}
onMounted(load);

async function link(r, on) {
  try {
    await api(`/api/redev-refs/${r.redevRefId}`, { method: 'PATCH', body: { complexId: on ? props.complexId : null } });
    await load();
  } catch (err) {
    error.value = err.message;
  }
}
</script>

<template>
  <div class="redev">
    <h3>국토부 정비사업 참고값 <small class="muted">(연 1회 CSV — scripts/import-redev.js)</small></h3>
    <p v-if="error" class="err">{{ error }}</p>
    <div class="row">
      <input v-model="q" placeholder="구역명 검색" @keydown.enter.prevent="load" />
      <button type="button" class="btn" @click="load">검색</button>
    </div>
    <table v-if="items.length" class="tbl">
      <thead><tr><th>기준연도</th><th>구역</th><th>단계</th><th>유형</th><th>공급세대</th><th /></tr></thead>
      <tbody>
        <tr v-for="r in items" :key="r.redevRefId" :class="{ linked: r.linked }">
          <td>{{ r.baseYear }}</td>
          <td>{{ r.zoneNm }} <small class="muted">{{ r.operatorNm ?? '' }}</small></td>
          <td>{{ r.stage ?? '-' }}</td>
          <td>{{ r.bizType ?? '-' }}</td>
          <td>{{ r.supplyHhld ?? '-' }}</td>
          <td>
            <button v-if="r.linked" type="button" class="btn" @click="link(r, false)">연결 해제</button>
            <button v-else type="button" class="btn" @click="link(r, true)">이 단지와 연결</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="muted small">같은 시군구의 정비사업 데이터가 없습니다.</p>
  </div>
</template>

<style scoped>
h3 { font-size: 15px; margin: 20px 0 8px; }
.row { display: flex; gap: 8px; margin-bottom: 8px; }
.row input { padding: 5px 7px; border: 1px solid var(--line); border-radius: 6px; }
.tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.tbl th, .tbl td { padding: 5px 6px; border-bottom: 1px solid var(--line); text-align: left; }
.tbl tr.linked td { background: #ecfdf5; }
.small { font-size: 12px; }
.err { color: var(--up); }
</style>
