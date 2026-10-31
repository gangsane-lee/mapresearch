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
        <button type="button" class="btn" aria-label="닫기" @click="emit('close')">닫기</button>
      </header>
      <div class="body"><slot /></div>
      <footer v-if="$slots.footer"><slot name="footer" /></footer>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; background: rgb(15 23 42 / 0.45); display: grid; place-items: center; z-index: 100; }
.modal { background: var(--panel); border-radius: 12px; display: flex; flex-direction: column; max-height: 95vh; width: min(640px, 95vw); box-shadow: 0 20px 60px rgb(0 0 0 / 0.3); }
.modal.lg { width: min(960px, 95vw); }
.modal.xl { width: 95vw; height: 95vh; }
header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
header h2 { margin: 0; font-size: 17px; flex: 1; }
.body { padding: 16px; overflow: auto; flex: 1; }
footer { padding: 12px 16px; border-top: 1px solid var(--line); display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
</style>
