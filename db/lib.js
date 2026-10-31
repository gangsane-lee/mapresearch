// 마이그레이션 러너의 순수 함수 (테스트 대상)
import { createHash } from 'node:crypto';

const MIGRATION_RE = /^(\d{3})_[a-z0-9_]+\.sql$/;

/** "001_init.sql" → { version: 1, name: "001_init.sql" }, 형식이 아니면 null */
export function parseMigrationName(file) {
  const m = MIGRATION_RE.exec(file);
  return m ? { version: Number(m[1]), name: file } : null;
}

/** 줄 단독 GO 기준으로 배치 분리 (sqlcmd와 같은 규칙, 대소문자 무시) */
export function splitBatches(sql) {
  return sql
    .split(/^[ \t]*GO[ \t]*$/im)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

/** sqlcmd 스타일 $(VAR) 치환. 정의되지 않은 변수가 있으면 오류 */
export function substituteVars(sql, vars) {
  return sql.replace(/\$\((\w+)\)/g, (_, key) => {
    if (!(key in vars) || vars[key] == null || vars[key] === '') {
      throw new Error(`정의되지 않은 마이그레이션 변수: $(${key})`);
    }
    return vars[key];
  });
}

/** 줄바꿈 차이(CRLF/LF)에 영향받지 않는 체크섬 */
export function checksum(sql) {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}
