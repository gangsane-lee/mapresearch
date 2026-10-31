// 공개 설정 (GET /api/public-config): 지도 엔진, ncpKeyId(도메인 제한 키), 표시 기준값
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api/client.js';

export const useSettingsStore = defineStore('settings', () => {
  const mapEngine = ref('NAVER');
  const ncpKeyId = ref(null);
  const staleDays = ref(30);
  const loaded = ref(false);
  const error = ref(null);

  async function load() {
    try {
      const c = await api('/api/public-config');
      mapEngine.value = c.mapEngine;
      ncpKeyId.value = c.ncpKeyId;
      staleDays.value = c.staleDays;
    } catch (err) {
      error.value = err.message;
    } finally {
      loaded.value = true;
    }
  }

  return { mapEngine, ncpKeyId, staleDays, loaded, error, load };
});
