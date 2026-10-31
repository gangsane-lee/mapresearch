// 실거래 중복 제거·평형 매칭 (계획서 §4.2)
import { createHash } from 'node:crypto';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/**
 * 해제 여부·해제일을 제외한 자연키 해시.
 * 같은 거래가 나중에 해제되어도 해시가 같아 기존 행을 UPDATE 하게 된다.
 * @param {{aptSeq:string, dealDate:string, exclM2:number, floor:number|null, dong:string|null, amountMan:number}} t
 */
export function tradeKeyHash(t) {
  return sha256(
    [t.aptSeq, t.dealDate, Number(t.exclM2).toFixed(2), t.floor ?? '', (t.dong ?? '').trim(), t.amountMan].join('|'),
  );
}

/** 전월세 자연키 (보증금·월세·계약구분 포함, 해제 관련 필드 없음) */
export function rentKeyHash(t) {
  return sha256(
    [t.aptSeq ?? t.aptNm, t.dealDate, Number(t.exclM2).toFixed(2), t.floor ?? '', t.depositMan, t.monthlyMan, t.contractType ?? ''].join('|'),
  );
}

/**
 * 같은 응답 안에서 자연키가 같은 정상 거래들에 dup_seq 1,2,… 부여 (응답 내 순서 기준).
 * @template T
 * @param {T[]} rows
 * @param {(r:T)=>string} keyFn
 * @returns {Array<T & {naturalKeyHash:string, dupSeq:number}>}
 */
export function assignDupSeq(rows, keyFn) {
  const seen = new Map();
  return rows.map((r) => {
    const k = keyFn(r);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return { ...r, naturalKeyHash: k, dupSeq: n };
  });
}

/**
 * 실거래 전용면적 → area_type 매칭. 허용 오차 이내 중 가장 가까운 평형, 없으면 null.
 * @param {number} exclM2
 * @param {Array<{areaTypeId:number, exclM2:number}>} areaTypes
 */
export function matchAreaType(exclM2, areaTypes, tolerance = 0.5) {
  let best = null;
  let bestDiff = Infinity;
  for (const a of areaTypes) {
    const d = Math.abs(Number(a.exclM2) - Number(exclM2));
    if (d <= tolerance + 1e-9 && d < bestDiff) {
      best = a;
      bestDiff = d;
    }
  }
  return best;
}

/**
 * 거래 전용면적 고유값을 허용 오차 안에서 묶어 평형 후보 생성 (단지 등록 시).
 * @param {number[]} areas
 * @returns {Array<{exclM2:number, count:number, members:number[]}>} 대표값 = 최빈 면적
 */
export function clusterAreas(areas, tolerance = 0.5) {
  const sorted = [...areas].map(Number).sort((a, b) => a - b);
  const groups = [];
  for (const a of sorted) {
    const g = groups.at(-1);
    if (g && a - g.min <= tolerance * 2 + 1e-9) {
      g.members.push(a);
    } else {
      groups.push({ min: a, members: [a] });
    }
  }
  return groups.map((g) => {
    const freq = new Map();
    for (const m of g.members) freq.set(m, (freq.get(m) ?? 0) + 1);
    const [mode] = [...freq.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0];
    return { exclM2: mode, count: g.members.length, members: [...new Set(g.members)] };
  });
}
