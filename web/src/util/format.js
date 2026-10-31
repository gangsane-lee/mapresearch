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
  INTEREST: { label: '관심', color: '#64748b' },
  VISIT_PLANNED: { label: '임장 예정', color: '#0ea5e9' },
  VISITED: { label: '임장 완료', color: '#2563eb' },
  CANDIDATE: { label: '매수 후보', color: '#16a34a' },
  ON_HOLD: { label: '보류', color: '#d97706' },
  EXCLUDED: { label: '제외', color: '#9ca3af' },
};

/** 지도 말풍선 HTML (단지명·대표 평형 호가·직전 대비·상태 색) — 사용자 입력은 모두 이스케이프 */
export function markerHtml(c) {
  const st = STATUS[c.status] ?? STATUS.INTEREST;
  const delta = formatDeltaMan(c.priceAskDelta);
  const dCls = c.priceAskDelta > 0 ? 'up' : c.priceAskDelta < 0 ? 'down' : '';
  const price = c.priceAsk != null ? `${escapeHtml(c.areaLabel ?? '')} ${formatMan(c.priceAsk)}` : '호가 미입력';
  const flag = c.flags?.length ? `<span class="flag" title="${escapeHtml(c.flags.map((f) => f.label).join(', '))}">!</span>` : '';
  return (
    `<div class="bubble" style="--st:${st.color}">` +
    `<b>${flag}${escapeHtml(c.displayNm)}</b>` +
    `<span class="price">${price}${delta ? ` <i class="${dCls}">${delta}</i>` : ''}</span>` +
    `</div>`
  );
}
