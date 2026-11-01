<script setup>
// 공용 모달. size="xl" 은 상세 팝업용 95vw × 95vh (계획서 §7.3)
// resizable="키": 오른쪽 아래 모서리를 끌어 크기 조절, 크기는 이 브라우저에 기억(키별). 헤더의 □ 로 최대화.
import { onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
  title: { type: String, required: true },
  size: { type: String, default: 'md' }, // md | lg | xl
  resizable: { type: String, default: null },
});
const emit = defineEmits(['close']);

const box = ref(null);
const maximized = ref(false);
const storeKey = () => `aptlog.modal.${props.resizable}`;
let ro = null;
let saveTimer = null;

function restoreSize() {
  if (!props.resizable || !box.value) return;
  try {
    const s = JSON.parse(localStorage.getItem(storeKey()) ?? 'null');
    if (s?.w && s?.h) Object.assign(box.value.style, { width: `${Math.min(s.w, innerWidth - 16)}px`, height: `${Math.min(s.h, innerHeight - 16)}px` });
  } catch {
    /* 저장소를 못 쓰면 기본 크기 */
  }
}
function rememberSize() {
  if (maximized.value || !box.value) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(storeKey(), JSON.stringify({ w: box.value.offsetWidth, h: box.value.offsetHeight }));
    } catch {
      /* 무시 */
    }
  }, 300);
}

const onKey = (e) => e.key === 'Escape' && emit('close');
onMounted(() => {
  window.addEventListener('keydown', onKey);
  restoreSize();
  if (props.resizable && box.value && typeof ResizeObserver !== 'undefined') {
    let first = true;
    ro = new ResizeObserver(() => (first ? (first = false) : rememberSize()));
    ro.observe(box.value);
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  ro?.disconnect();
  clearTimeout(saveTimer);
});
</script>

<template>
  <div class="backdrop" @mousedown.self="emit('close')">
    <div ref="box" class="modal" :class="[size, { resizable: !!resizable, max: maximized }]" role="dialog" aria-modal="true" :aria-label="title">
      <header>
        <h2>{{ title }}</h2>
        <slot name="header-extra" />
        <button v-if="resizable" type="button" class="btn ghost" :aria-label="maximized ? '원래 크기' : '최대화'" :title="maximized ? '원래 크기' : '최대화'" @click="maximized = !maximized">{{ maximized ? '❐' : '□' }}</button>
        <button type="button" class="btn ghost" aria-label="닫기" @click="emit('close')">닫기</button>
      </header>
      <div class="body"><slot /></div>
      <footer v-if="$slots.footer"><slot name="footer" /></footer>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed; inset: 0; background: rgb(27 36 48 / 0.42); backdrop-filter: blur(3px);
  display: grid; place-items: center; z-index: 100; animation: fade 0.18s ease-out;
}
.modal {
  background: var(--panel); border-radius: 14px; display: flex; flex-direction: column; max-height: 95vh;
  width: min(640px, 95vw); box-shadow: var(--shadow-float); animation: rise 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.modal.lg { width: min(960px, 95vw); }
.modal.xl { width: 95vw; height: 95vh; }
/* 크기 조절: 오른쪽 아래 모서리 */
.modal.resizable { resize: both; overflow: hidden; min-width: 560px; min-height: 360px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); }
.modal.resizable.lg { width: min(1180px, 95vw); height: 88vh; }
.modal.max { width: calc(100vw - 16px) !important; height: calc(100vh - 16px) !important; resize: none; }
/* 입력·상세 화면 공통 헤더: 잉크 띠 + 명조 제목 (우측 패널 히어로와 같은 언어) */
header {
  display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-radius: 14px 14px 0 0;
  background: var(--ink); color: #fff;
}
header h2 { margin: 0; font-family: var(--serif); font-size: 19px; font-weight: 700; letter-spacing: -0.03em; flex: 1; }
header :deep(.btn) { background: rgb(255 255 255 / 0.08); border-color: rgb(255 255 255 / 0.2); color: #fff; }
header :deep(.btn:hover) { background: rgb(255 255 255 / 0.16); border-color: rgb(255 255 255 / 0.4); }
header :deep(.btn.ghost) { background: transparent; border-color: transparent; color: rgb(255 255 255 / 0.75); }
header :deep(.btn.ghost:hover) { color: #fff; background: rgb(255 255 255 / 0.1); }
header :deep(.muted), header :deep(small) { color: rgb(255 255 255 / 0.65); }
header :deep(select), header :deep(input) { background: rgb(255 255 255 / 0.1); border-color: rgb(255 255 255 / 0.25); color: #fff; }
header :deep(option) { color: var(--text); }
.body { padding: 20px; overflow: auto; flex: 1; }
footer { padding: 14px 20px; border-top: 1px solid var(--line); background: var(--surface-2); border-radius: 0 0 14px 14px; display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
@keyframes fade { from { opacity: 0; } }
@keyframes rise { from { opacity: 0; transform: translateY(8px) scale(0.99); } }
</style>
