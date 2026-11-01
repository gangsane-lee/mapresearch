<script setup>
// 공용 모달. size="xl" 은 상세 팝업용 95vw × 95vh (계획서 §7.3)
import { onBeforeUnmount, onMounted } from 'vue';

defineProps({
  title: { type: String, required: true },
  size: { type: String, default: 'md' }, // md | lg | xl
});
const emit = defineEmits(['close']);

const onKey = (e) => e.key === 'Escape' && emit('close');
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="backdrop" @mousedown.self="emit('close')">
    <div class="modal" :class="size" role="dialog" aria-modal="true" :aria-label="title">
      <header>
        <h2>{{ title }}</h2>
        <slot name="header-extra" />
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
