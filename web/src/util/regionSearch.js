// 구/시 검색 (geo/index.json 기반, 메모리 검색)

/**
 * @param {{ sigungu: Array, cities: Array }} index
 * @returns {Array<{ kind:'SIGUNGU'|'CITY', key:string, label:string, sub:string, bbox:number[], codes:string[] }>}
 */
export function buildRegionItems(index) {
  const items = index.sigungu.map((s) => ({
    kind: 'SIGUNGU',
    key: s.code,
    label: s.sggNm,
    sub: s.sidoNm,
    bbox: s.bbox,
    codes: [s.code],
  }));
  for (const c of index.cities) {
    const sido = index.sigungu.find((s) => s.code === c.codes[0])?.sidoNm ?? '';
    items.push({ kind: 'CITY', key: `city:${c.name}`, label: `${c.name} 전체`, sub: sido, bbox: c.bbox, codes: c.codes });
  }
  return items;
}

const norm = (s) => s.replace(/\s+/g, '').toLowerCase();

/** 부분 일치. 앞부분 일치 → 시 전체 → 이름 순 */
export function searchRegions(items, query, limit = 12) {
  const q = norm(query ?? '');
  if (!q) return [];
  const scored = [];
  for (const it of items) {
    const hay = norm(`${it.sub}${it.label}`);
    const name = norm(it.label);
    if (!hay.includes(q)) continue;
    const score = (name.startsWith(q) ? 0 : 10) + (it.kind === 'CITY' ? 0 : 1);
    scored.push([score, it]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label, 'ko'));
  return scored.slice(0, limit).map(([, it]) => it);
}
