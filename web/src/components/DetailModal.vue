<script setup>
// 상세 팝업 95vw × 95vh (계획서 §7.3) — 1개면 단지 상세, 2개 이상이면 상세 비교
import { computed, ref } from 'vue';
import Modal from './Modal.vue';
import ComplexDetail from './ComplexDetail.vue';
import CompareDetail from './CompareDetail.vue';

const props = defineProps({
  ids: { type: Array, required: true },
  names: { type: Array, default: () => [] },
  initialSnapshotId: { type: Number, default: null },
});
const emit = defineEmits(['close', 'correct', 'changed', 'new-snapshot', 'history']);
const detail = ref(null);
const title = computed(() => (props.ids.length === 1 ? props.names[0] ?? '단지 상세' : `상세 비교 — ${props.names.join(' · ')}`));
defineExpose({ reload: () => detail.value?.reload?.() });
</script>

<template>
  <Modal :title="title" size="xl" @close="emit('close')">
    <ComplexDetail
      v-if="ids.length === 1"
      ref="detail"
      :complex-id="ids[0]"
      :initial-snapshot-id="initialSnapshotId"
      @correct="(id) => emit('correct', id)"
      @changed="emit('changed')"
      @new-snapshot="(id) => emit('new-snapshot', id)"
      @history="(id) => emit('history', id)"
    />
    <CompareDetail v-else :ids="ids" />
  </Modal>
</template>
