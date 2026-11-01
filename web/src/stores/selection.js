// 단지 선택 상태 (계획서 §7.2): 0 = 패널 닫힘, 1 = 요약, 2~4 = 비교
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export const MAX_COMPARE = 4;

export const useSelectionStore = defineStore('selection', () => {
  const selectedIds = ref([]);
  const lastWarning = ref(null);

  const mode = computed(() =>
    selectedIds.value.length === 0 ? 'NONE' : selectedIds.value.length === 1 ? 'SUMMARY' : 'COMPARE',
  );

  /** 일반 클릭: 단일 선택으로 교체. 다중(Ctrl+클릭/비교 담기): 토글 */
  function select(id, { multi = false } = {}) {
    lastWarning.value = null;
    if (!multi) {
      selectedIds.value = [id];
      return;
    }
    const i = selectedIds.value.indexOf(id);
    if (i >= 0) {
      selectedIds.value = selectedIds.value.filter((x) => x !== id);
    } else if (selectedIds.value.length >= MAX_COMPARE) {
      lastWarning.value = `비교는 최대 ${MAX_COMPARE}개까지 가능합니다`;
    } else {
      selectedIds.value = [...selectedIds.value, id];
    }
  }

  /** 영역 선택 등으로 여러 단지를 한 번에 선택 (기존 선택 교체) */
  function replace(ids) {
    lastWarning.value = null;
    selectedIds.value = [...new Set(ids)].slice(0, MAX_COMPARE);
  }

  function remove(id) {
    selectedIds.value = selectedIds.value.filter((x) => x !== id);
  }

  function clear() {
    selectedIds.value = [];
    lastWarning.value = null;
  }

  const isSelected = (id) => selectedIds.value.includes(id);

  return { selectedIds, mode, lastWarning, select, replace, remove, clear, isSelected };
});
