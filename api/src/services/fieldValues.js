// field_def 기반 값 검증·변환 (DB 없이 테스트 가능한 순수 함수)
import { AppError } from '../util/errors.js';
import { parseManwon } from '../util/unit.js';

/**
 * 화면 입력값 → snapshot_value 컬럼 { num_val, text_val, date_val }
 * @param {object} def   field_def 행 (data_type, unit, label, field_cd)
 * @param {any} value
 * @param {Map<string, Set<string>>} enumCodes  field_cd → 허용 code
 * @returns {{num:number|null, text:string|null, date:string|null}|null}  null = 값 없음(저장 안 함)
 */
export function toColumns(def, value, enumCodes) {
  if (value === undefined || value === null || value === '') return null;
  const bad = (msg) => new AppError('VALIDATION', `${def.label}: ${msg}`, 400);
  switch (def.data_type) {
    case 'num': {
      let n;
      if (def.unit === '만원') {
        try {
          n = parseManwon(value);
        } catch (e) {
          throw bad(e.message);
        }
      } else {
        n = Number(value);
      }
      if (!Number.isFinite(n) || n < 0) throw bad('0 이상의 숫자여야 합니다');
      return { num: n, text: null, date: null };
    }
    case 'bool':
      if (typeof value !== 'boolean') throw bad('예/아니오 값이어야 합니다');
      return { num: value ? 1 : 0, text: null, date: null };
    case 'enum': {
      const allowed = enumCodes.get(def.field_cd);
      if (!allowed?.has(String(value))) throw bad(`허용되지 않은 값: ${value}`);
      return { num: null, text: String(value), date: null };
    }
    case 'date': {
      const s = String(value);
      const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s);
      if (!m) throw bad('YYYY-MM 또는 YYYY-MM-DD 형식이어야 합니다');
      return { num: null, text: null, date: `${m[1]}-${m[2]}-${m[3] ?? '01'}` };
    }
    case 'text': {
      const s = String(value).trim();
      if (!s) return null;
      if (s.length > 4000) throw bad('4000자 이하');
      return { num: null, text: s, date: null };
    }
    default:
      throw bad(`알 수 없는 형식 ${def.data_type}`);
  }
}

/** snapshot_value 행 → 화면 값 */
export function fromColumns(def, row) {
  switch (def.data_type) {
    case 'num':
      return row.num_val == null ? null : Number(row.num_val);
    case 'bool':
      return row.num_val == null ? null : Number(row.num_val) === 1;
    case 'date': {
      const d = row.date_val;
      if (d == null) return null;
      const s = d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10);
      return s;
    }
    default:
      return row.text_val ?? null;
  }
}

/** 두 컬럼 값이 같은지 (복사값 판정) */
export function sameColumns(a, b) {
  if (!a || !b) return false;
  return (
    (a.num == null ? null : Number(a.num)) === (b.num == null ? null : Number(b.num)) &&
    (a.text ?? null) === (b.text ?? null) &&
    (a.date ?? null) === (b.date ?? null)
  );
}
