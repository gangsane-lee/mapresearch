// 평형 입력 보조 — 라벨 "평" 자동 붙이기, 라벨(공급 평) → 전용㎡ 추정

const PYEONG_M2 = 3.3058;
// 공급/전용 비율 근사 (단지 등록 초안의 "전용×1.33 → 평" 라벨과 같은 비율, 24평≈59.6㎡·34평≈84.5㎡)
const SUPPLY_RATIO = 1.33;

/** 숫자만 입력하면 "평"을 붙인다: "24" → "24평", "24A" 등은 그대로 */
export function normalizeAreaLabel(v) {
  const t = String(v ?? '').trim();
  return /^\d+(\.\d+)?$/.test(t) ? `${t}평` : t;
}

/** 라벨 앞의 평 숫자로 전용㎡ 추정 (소수 둘째 자리). 숫자가 없으면 null */
export function estimateExclM2(label) {
  const m = /^(\d+(?:\.\d+)?)/.exec(String(label ?? '').trim());
  if (!m || Number(m[1]) <= 0) return null;
  return Math.round(((Number(m[1]) * PYEONG_M2) / SUPPLY_RATIO) * 100) / 100;
}
