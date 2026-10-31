// 행정경계 (정적 GeoJSON, 계획서 §9 /geo/*) — 한 번 받은 경계는 메모리 캐시
import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import { getStatic } from '../api/client.js';
import { buildRegionItems } from '../util/regionSearch.js';
import { mergeGeometries } from '../map/mask.js';

export const useRegionsStore = defineStore('regions', () => {
  const items = shallowRef([]);
  const loaded = ref(false);
  const error = ref(null);
  const current = shallowRef(null); // { item, geometry }
  const cache = new Map();

  async function load() {
    if (loaded.value) return;
    try {
      const index = await getStatic('/geo/index.json');
      items.value = buildRegionItems(index);
      loaded.value = true;
    } catch (err) {
      error.value = `행정경계가 없습니다 (npm run geo:build): ${err.message}`;
    }
  }

  async function geometryOf(item) {
    if (cache.has(item.key)) return cache.get(item.key);
    const url = item.kind === 'CITY' ? `/geo/city/${encodeURIComponent(item.key.slice(5))}.json` : `/geo/sigungu/${item.key}.json`;
    const f = await getStatic(url);
    cache.set(item.key, f.geometry);
    return f.geometry;
  }

  async function select(item) {
    const geometry = await geometryOf(item);
    current.value = { item, geometry };
    return current.value;
  }

  function clear() {
    current.value = null;
  }

  /** 여러 구를 함께 강조할 때 */
  async function geometryOfCodes(codes) {
    const gs = await Promise.all(codes.map((c) => geometryOf(items.value.find((i) => i.key === c))));
    return mergeGeometries(gs);
  }

  return { items, loaded, error, current, load, select, clear, geometryOfCodes };
});
