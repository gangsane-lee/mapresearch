// 금액 정규화 (계획서 §7.4): "10.7억", "107000", "10억7천", "10억 7,000", "7500만" → 만원 정수

const NUM = '(\\d+(?:\\.\\d+)?)';

/**
 * @param {string|number} input
 * @returns {number} 만원 정수
 * @throws {Error} 해석할 수 없는 형식
 */
export function parseManwon(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) throw new Error(`금액 형식 오류: ${input}`);
    return Math.round(input);
  }
  const s = String(input ?? '').replace(/[\s,원]/g, '');
  if (!s) throw new Error('금액이 비어 있습니다');

  // 순수 숫자 → 만원 단위로 간주
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));

  const m = new RegExp(`^(?:${NUM}억)?(?:${NUM}천)?(?:${NUM}(?:만)?)?$`).exec(s);
  if (!m || (!m[1] && !m[2] && !m[3])) throw new Error(`금액 형식 오류: ${input}`);
  // "10억5" 처럼 억 뒤 단위 없는 숫자는 모호 → 거부
  if (m[1] && m[3] && !s.endsWith('만') && !m[2]) throw new Error(`금액 형식이 모호합니다: ${input} (예: 10억5000만)`);
  if (m[2] && m[3] && !s.endsWith('만')) throw new Error(`금액 형식이 모호합니다: ${input}`);

  const eok = m[1] ? Number(m[1]) * 10000 : 0;
  const cheon = m[2] ? Number(m[2]) * 1000 : 0;
  const man = m[3] ? Number(m[3]) : 0;
  return Math.round(eok + cheon + man);
}

/** 공공데이터 dealAmount "113,000" (만원, 쉼표·공백 포함) → 113000 */
export function parseDealAmount(s) {
  const n = Number(String(s ?? '').replace(/[,\s]/g, ''));
  if (!Number.isFinite(n)) throw new Error(`거래금액 형식 오류: ${s}`);
  return Math.round(n);
}

/** ㎡ → 평 (표시·평형 라벨 후보용, 1평 = 3.305785㎡) */
export const m2ToPyeong = (m2) => Math.round((m2 / 3.305785) * 10) / 10;
