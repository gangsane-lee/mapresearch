// 화면 표시용 변환. DB·API 금액은 만원 정수, 억 변환은 화면에서만 (CLAUDE.md).

/** 107000 → "10.7억", 7500 → "7,500만", 110500 → "11.05억" */
export function formatMan(man) {
  if (man == null || Number.isNaN(Number(man))) return '-';
  const v = Number(man);
  if (Math.abs(v) >= 10000) {
    const eok = Math.round((v / 10000) * 100) / 100;
    return `${eok.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}억`;
  }
  return `${v.toLocaleString('ko-KR')}만`;
}

/** 증감 표시: +3000 → "▲0.3억", −500 → "▼500만", 0 → "−" */
export function formatDeltaMan(delta) {
  if (delta == null) return '';
  const v = Number(delta);
  if (v === 0) return '−';
  return `${v > 0 ? '▲' : '▼'}${formatMan(Math.abs(v))}`;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** 관측일이 stale_days 넘었는지 */
export function isStale(dateStr, staleDays = 30, today = new Date()) {
  if (!dateStr) return false;
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  return (today - d) / 86400000 > staleDays;
}

export const STATUS = {
  // "관심"은 ★ 즐겨찾기(is_favorite)로 쓰므로 첫 단계는 "검토"로 부른다
  INTEREST: { label: '검토', color: '#7b8494' },
  VISIT_PLANNED: { label: '임장 예정', color: '#4b8aa8' },
  VISITED: { label: '임장 완료', color: '#2b5a96' },
  CANDIDATE: { label: '매수 후보', color: '#2e7552' },
  ON_HOLD: { label: '보류', color: '#c08a2e' },
  EXCLUDED: { label: '제외', color: '#a5a8ad' },
};

/**
 * 지도 명패 HTML — 위 칸: 대표 평형 호가(없으면 단지명)·직전 대비, 아래 칸: 상태 점·단지명·평형.
 * 사용자 입력은 모두 이스케이프
 */
export function markerHtml(c) {
  const st = STATUS[c.status] ?? STATUS.INTEREST;
  const delta = formatDeltaMan(c.priceAskDelta);
  const dCls = c.priceAskDelta > 0 ? 'up' : c.priceAskDelta < 0 ? 'down' : '';
  const hasPrice = c.priceAsk != null;
  const name = escapeHtml(c.displayNm);
  const fav = c.isFavorite ? '<span class="fav" title="관심 단지">★</span>' : '';
  const flag = c.flags?.length ? `<span class="flag" title="${escapeHtml(c.flags.map((f) => f.label).join(', '))}">!</span>` : '';
  const top = hasPrice ? `<b class="amt">${formatMan(c.priceAsk)}</b>` : `<b class="amt nm">${name}</b>`;
  const sub = hasPrice ? `${name}${c.areaLabel ? ` <em>${escapeHtml(c.areaLabel)}</em>` : ''}` : '호가 미입력';
  return (
    `<div class="bubble" style="--st:${st.color}" title="${st.label}">` +
    `<span class="top">${fav}${flag}${top}${delta ? `<i class="${dCls}">${delta}</i>` : ''}</span>` +
    `<span class="sub">${sub}</span>` +
    `</div>`
  );
}
