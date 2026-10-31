// A2 가중치 종합점수 (계획서 §10) — 비교 중인 단지들 사이의 상대 점수 (0~100)
//   교통·환경·학군: 등급 ord / 4 × 100 (S=100, A=75, B=50, C=25)
//   가격 매력도: 비교 대상 중 최저 호가 / 해당 단지 호가 × 100 (최저가 = 100)
//   값이 없는 항목은 빼고 남은 가중치로 정규화, 사용 항목을 함께 반환
import { enumOrd } from './compare.js';

export const SCORE_PARTS = [
  ['traffic', '교통', 'grade_traffic'],
  ['env', '환경', 'grade_env'],
  ['edu', '학군', 'grade_edu'],
  ['price', '가격', 'price_ask'],
];

export const DEFAULT_WEIGHTS = { traffic: 3, env: 2, edu: 2, price: 3 };

/**
 * @param {Array} items  /api/compare items
 * @param {Array} enums
 * @param {Record<string, number>} weights
 * @returns {Map<number, {score:number|null, parts:Record<string,number>, used:string[]}>}
 */
export function weightedScores(items, enums, weights = DEFAULT_WEIGHTS) {
  const asks = items.map((i) => i.values.price_ask?.value).filter((v) => v != null && v > 0);
  const minAsk = asks.length ? Math.min(...asks) : null;
  const out = new Map();
  for (const it of items) {
    const parts = {};
    for (const [key, , cd] of SCORE_PARTS) {
      if (key === 'price') {
        const ask = it.values.price_ask?.value;
        if (ask && minAsk) parts.price = Math.round((minAsk / ask) * 1000) / 10;
      } else {
        const ord = enumOrd(enums, cd, it.values[cd]?.value);
        if (ord != null) parts[key] = (ord / 4) * 100;
      }
    }
    const used = Object.keys(parts).filter((k) => (weights[k] ?? 0) > 0);
    const wSum = used.reduce((s, k) => s + weights[k], 0);
    const score = wSum ? Math.round((used.reduce((s, k) => s + parts[k] * weights[k], 0) / wSum) * 10) / 10 : null;
    out.set(it.complexId, { score, parts, used });
  }
  return out;
}

/** setting 값('3') → 숫자 가중치 */
export function weightsFromSettings(s = {}) {
  const w = {};
  for (const [key] of SCORE_PARTS) {
    const v = Number(s[`weight.${key}`]);
    w[key] = Number.isFinite(v) && v >= 0 ? v : DEFAULT_WEIGHTS[key];
  }
  return w;
}
