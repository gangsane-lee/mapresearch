<script setup>
// 사진 탭 (계획서 §7.3 6번, §8): 스냅샷별 그룹 갤러리, 다중 업로드, 클립보드 붙여넣기(Ctrl+V), 같은 날 스냅샷 연결 제안
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api, upload, mediaSrc } from '../api/client.js';

const props = defineProps({
  complexId: { type: Number, required: true },
  snapshots: { type: Array, default: () => [] }, // 유효 스냅샷 (연결 선택용)
});

const items = ref([]);
const srcs = ref(new Map());
const kind = ref('PHOTO');
const snapshotId = ref('');
const busy = ref(false);
const results = ref([]);
const error = ref(null);
const viewer = ref(null);

const KIND_LABEL = { PHOTO: '임장 사진', PRICE_CAPTURE: '시세 캡처', MAP_CAPTURE: '지도 캡처', OTHER: '기타' };

async function load() {
  try {
    items.value = (await api(`/api/media?complexId=${props.complexId}`)).items;
    for (const m of items.value) {
      if (!srcs.value.has(m.mediaId)) srcs.value.set(m.mediaId, await mediaSrc(m.thumbUrl));
    }
    srcs.value = new Map(srcs.value);
  } catch (err) {
    error.value = err.message;
  }
}

const groups = computed(() => {
  const m = new Map();
  for (const it of items.value) {
    const k = it.snapshotId ? `${it.snapshotObservedAt} 스냅샷 #${it.snapshotId}` : '스냅샷 미연결';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return [...m];
});

async function send(files) {
  if (!files.length) return;
  busy.value = true;
  error.value = null;
  try {
    const fd = new FormData();
    fd.append('complexId', String(props.complexId));
    fd.append('kind', kind.value);
    if (snapshotId.value) fd.append('snapshotId', String(snapshotId.value));
    for (const f of files) fd.append('files', f, f.name || `paste-${Date.now()}.png`);
    results.value = (await upload('/api/media', fd)).items;
    await load();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

const onPick = (e) => {
  send([...e.target.files]);
  e.target.value = '';
};

function onPaste(e) {
  const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) {
    e.preventDefault();
    kind.value = kind.value === 'PHOTO' ? 'PRICE_CAPTURE' : kind.value; // 붙여넣기는 대개 캡처
    send(files);
  }
}

async function link(mediaId, sid) {
  try {
    await api(`/api/media/${mediaId}`, { method: 'PATCH', body: { snapshotId: sid } });
    results.value = results.value.map((r) => (r.mediaId === mediaId ? { ...r, suggestedSnapshotId: null, linked: true } : r));
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

async function openViewer(m) {
  viewer.value = { ...m, src: await mediaSrc(m.url) };
}

onMounted(() => {
  load();
  window.addEventListener('paste', onPaste);
});
onBeforeUnmount(() => window.removeEventListener('paste', onPaste));
</script>

<template>
  <div class="gallery">
    <div class="toolbar">
      <label>종류
        <select v-model="kind">
          <option v-for="(l, k) in KIND_LABEL" :key="k" :value="k">{{ l }}</option>
        </select>
      </label>
      <label>스냅샷 연결
        <select v-model="snapshotId">
          <option value="">자동 제안(촬영일)</option>
          <option v-for="s in snapshots" :key="s.snapshotId" :value="s.snapshotId">{{ s.observedAt }} #{{ s.snapshotId }}</option>
        </select>
      </label>
      <label class="btn primary file">
        {{ busy ? '업로드 중…' : '사진 선택' }}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple :disabled="busy" @change="onPick" />
      </label>
      <span class="muted small">캡처 이미지는 이 화면에서 Ctrl+V 로 붙여넣을 수 있습니다. 파일당 30MB, 한 번에 20개.</span>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <ul v-if="results.length" class="results">
      <li v-for="r in results" :key="r.name + (r.mediaId ?? '')" :class="{ fail: !r.ok }">
        {{ r.name }} — {{ r.ok ? '업로드됨' : r.message }}
        <template v-if="r.ok && r.suggestedSnapshotId && !r.linked">
          · 촬영일과 같은 날 스냅샷 #{{ r.suggestedSnapshotId }}
          <button type="button" class="btn" @click="link(r.mediaId, r.suggestedSnapshotId)">연결</button>
        </template>
      </li>
    </ul>

    <section v-for="[title, list] in groups" :key="title">
      <h4>{{ title }}</h4>
      <div class="grid">
        <figure v-for="m in list" :key="m.mediaId" @click="openViewer(m)">
          <img :src="srcs.get(m.mediaId)" :alt="m.caption || m.origName || '사진'" loading="lazy" />
          <figcaption>
            <span class="chip">{{ KIND_LABEL[m.kind] }}</span>
            <small class="muted">{{ m.takenAt ? String(m.takenAt).slice(0, 10) : '촬영일 없음' }}</small>
          </figcaption>
        </figure>
      </div>
    </section>
    <p v-if="!items.length" class="muted">사진이 없습니다.</p>

    <div v-if="viewer" class="viewer" @click="viewer = null">
      <img :src="viewer.src" :alt="viewer.caption || viewer.origName || '사진'" />
      <p>{{ viewer.origName }} · {{ viewer.w }}×{{ viewer.h }}{{ viewer.gps ? ` · GPS ${viewer.gps.lat.toFixed(5)}, ${viewer.gps.lng.toFixed(5)}` : '' }}</p>
    </div>
  </div>
</template>

<style scoped>
.toolbar { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; margin-bottom: 12px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
select { padding: 5px 7px; border: 1px solid var(--line); border-radius: 6px; }
.file { position: relative; overflow: hidden; color: #fff; flex-direction: row; }
.file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.small { font-size: 12px; }
.results { font-size: 13px; padding-left: 18px; }
.results li.fail { color: var(--warn); }
h4 { font-size: 14px; margin: 16px 0 8px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
figure { margin: 0; cursor: zoom-in; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; background: #f8fafc; }
figure img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; }
figcaption { display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; }
.viewer { position: fixed; inset: 0; background: rgb(0 0 0 / 0.85); z-index: 200; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: zoom-out; }
.viewer img { max-width: 92vw; max-height: 85vh; }
.viewer p { color: #e2e8f0; font-size: 13px; }
.err { color: var(--up); }
</style>
