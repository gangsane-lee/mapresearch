// 단지 요약 (앱 시작 시 1회 GET /api/complexes/summary, 이후 메모리) — 마커·패널은 이 데이터로 즉시 표시
import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { api } from '../api/client.js';

export const useComplexesStore = defineStore('complexes', () => {
  const list = shallowRef([]);
  const loading = ref(false);
  const error = ref(null);
  const statusFilter = ref(new Set()); // 비어 있으면 전체
  const tagFilter = ref(new Set());
  const flaggedOnly = ref(false); // A3 알림 있는 단지만

  const byId = computed(() => new Map(list.value.map((c) => [c.complexId, c])));
  const allTags = computed(() => [...new Set(list.value.flatMap((c) => c.tags))].sort((a, b) => a.localeCompare(b, 'ko')));

  const visible = computed(() =>
    list.value.filter(
      (c) =>
        (statusFilter.value.size === 0 || statusFilter.value.has(c.status)) &&
        (tagFilter.value.size === 0 || c.tags.some((t) => tagFilter.value.has(t))) &&
        (!flaggedOnly.value || c.flags?.length > 0),
    ),
  );

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      list.value = (await api('/api/complexes/summary')).items;
    } catch (err) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  }

  function toggleStatus(s) {
    const next = new Set(statusFilter.value);
    next.has(s) ? next.delete(s) : next.add(s);
    statusFilter.value = next;
  }

  function toggleTag(t) {
    const next = new Set(tagFilter.value);
    next.has(t) ? next.delete(t) : next.add(t);
    tagFilter.value = next;
  }

  const flaggedCount = computed(() => list.value.filter((c) => c.flags?.length).length);

  return { list, loading, error, byId, visible, allTags, statusFilter, tagFilter, flaggedOnly, flaggedCount, load, toggleStatus, toggleTag };
});
