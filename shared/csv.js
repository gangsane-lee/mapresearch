// CSV 파싱·인코딩 판별 (공공데이터 CSV는 CP949(EUC-KR)인 경우가 많다)

/** UTF-8로 해석 가능하면 UTF-8, 아니면 EUC-KR (Node 24 full-ICU TextDecoder) */
export function decodeText(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('euc-kr').decode(bytes);
  }
}

/** RFC 4180 수준 CSV 파서 (따옴표 안 쉼표·줄바꿈·"" 이스케이프) */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

/**
 * 헤더 → 대상 컬럼 매핑 (키워드 포함 여부, 앞선 후보 우선)
 * @param {string[]} header
 * @param {Record<string, string[]>} rules  target → 키워드 목록
 * @returns {{ map: Record<string, number>, unmapped: string[] }}
 */
export function mapHeader(header, rules) {
  const norm = (s) => s.replace(/\s|\(|\)|_/g, '');
  const map = {};
  for (const [target, keys] of Object.entries(rules)) {
    for (const k of keys) {
      const i = header.findIndex((h, idx) => norm(h).includes(k) && !Object.values(map).includes(idx));
      if (i >= 0) {
        map[target] = i;
        break;
      }
    }
  }
  const used = new Set(Object.values(map));
  return { map, unmapped: header.filter((_, i) => !used.has(i)) };
}
