// AptLog 백업 (계획서 §8) — OS 무관 버전. macOS 는 launchd 로 일 1회 실행 (scripts/mac/install-launchd.sh)
//   node scripts/backup.js [--env-file .env] [--retention 14]
//
// 1. RealtyLog_DEV/PROD 를 BACKUP_ROOT/db/{DB}_{yyyyMMdd}.bak 로 백업 (CHECKSUM + VERIFYONLY)
//    MSSQL_SA_PASSWORD 가 있으면 sa 로 있는 DB 전부, 없으면 .env 의 DB_NAME 하나를 MIGRATE_USER 로
//    SQL Server 가 Docker 컨테이너 안에 있으면 서버가 보는 경로가 다르다 → BACKUP_SQL_DIR (예: /var/opt/mssql/backup,
//    docker-compose.yml 에서 BACKUP_ROOT/db 를 그 경로로 마운트). 같은 PC 에 설치된 SQL Server 면 비워 둔다.
// 2. 보관 정리: BACKUP_ROOT/db 의 RealtyLog_{DEV|PROD}_yyyyMMdd.bak 중 보관일 경과분만 삭제 (유일한 자동 삭제 예외)
// 3. 미디어: 새 파일·더 최신 파일만 복사 (원본에서 지운 파일을 백업에서 지우지 않는다 — robocopy /MIR 금지와 같은 원칙)
// 4. BACKUP_ROOT/logs/last_backup.json 기록 (설정 화면 표시용, backup.ps1 과 같은 형식)
import { appendFile, copyFile, mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
};
const envFile = path.resolve(root, arg('--env-file', '.env'));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const env = process.env;
const retentionDays = Number(arg('--retention', 14));

const BAK_RE = /^RealtyLog_(DEV|PROD)_(\d{8})\.bak$/;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** 보관기간이 지난 백업 파일명만 고른다 (패턴 밖 파일은 절대 건드리지 않음) */
export function expiredBackups(names, today, days) {
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
  return names.filter((n) => {
    const m = BAK_RE.exec(n);
    if (!m) return false;
    const d = new Date(Number(m[2].slice(0, 4)), Number(m[2].slice(4, 6)) - 1, Number(m[2].slice(6, 8)));
    return d < cutoff;
  });
}

/** src → dst 증분 복사: 없거나 원본이 더 최신인 파일만. 삭제는 하지 않는다. */
async function copyNewer(src, dst) {
  let copied = 0;
  await mkdir(dst, { recursive: true });
  for (const e of await readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copied += await copyNewer(s, d);
    else if (e.isFile()) {
      const ss = await stat(s);
      const ds = existsSync(d) ? await stat(d) : null;
      if (!ds || ss.mtimeMs > ds.mtimeMs) {
        await copyFile(s, d);
        copied++;
      }
    }
  }
  return copied;
}

async function main() {
  const backupRoot = env.BACKUP_ROOT;
  const mediaRoot = env.MEDIA_ROOT;
  if (!backupRoot || !mediaRoot) throw new Error('.env 에 BACKUP_ROOT, MEDIA_ROOT 가 필요합니다');
  const now = new Date();
  const dbDir = path.join(backupRoot, 'db');
  const mediaDir = path.join(backupRoot, 'media');
  const logDir = path.join(backupRoot, 'logs');
  for (const d of [dbDir, mediaDir, logDir]) await mkdir(d, { recursive: true });
  const logFile = path.join(logDir, `backup_${ymd(now)}.log`);
  const log = async (msg) => {
    const line = `${stamp()} ${msg}`;
    console.log(line);
    await appendFile(logFile, `${line}\n`, 'utf8');
  };

  const result = { startedAt: stamp(now).replace(' ', 'T'), databases: [], media: null, deleted: [], ok: false, sameDisk: false };
  let code = 0;
  try {
    // 같은 디스크 경고 (macOS/Linux: 장치 번호, Windows: 드라이브 문자)
    if (existsSync(mediaRoot)) {
      result.sameDisk = (await stat(backupRoot)).dev === (await stat(mediaRoot)).dev;
      if (result.sameDisk) await log('경고: 백업이 원본과 같은 디스크에 있습니다 (디스크 고장 시 함께 손실)');
    }

    // 1) DB 백업 — sa 가 있으면(맥 컨테이너) DEV·PROD 중 있는 DB 전부, 없으면 .env 의 DB 하나를 MIGRATE_USER 로
    //    (RESTORE VERIFYONLY 는 CREATE DATABASE 권한이 필요해 db_owner 만으로는 거부될 수 있다)
    const sa = env.MSSQL_SA_PASSWORD ? { user: env.MSSQL_SA_USER || 'sa', password: env.MSSQL_SA_PASSWORD } : null;
    if (!sa && !/^RealtyLog_(DEV|PROD)$/.test(env.DB_NAME ?? '')) {
      throw new Error(`백업 대상은 RealtyLog_DEV | RealtyLog_PROD 입니다 (DB_NAME=${env.DB_NAME})`);
    }
    const sqlDir = env.BACKUP_SQL_DIR || dbDir;
    const pool = await new sql.ConnectionPool({
      server: env.DB_SERVER,
      port: Number(env.DB_PORT ?? 1433),
      database: sa ? 'master' : env.DB_NAME,
      user: sa ? sa.user : env.MIGRATE_USER,
      password: sa ? sa.password : env.MIGRATE_PASSWORD,
      options: { encrypt: true, trustServerCertificate: true, useUTC: false },
      requestTimeout: 30 * 60 * 1000,
    }).connect();
    try {
      const dbs = sa
        ? (await pool.request().query("SELECT name FROM sys.databases WHERE name IN ('RealtyLog_DEV','RealtyLog_PROD') AND state = 0 ORDER BY name"))
            .recordset.map((r) => r.name)
        : [env.DB_NAME];
      for (const db of dbs) {
        const name = `${db}_${ymd(now)}.bak`;
        const sqlPath = sqlDir.includes('\\') ? `${sqlDir.replace(/\\$/, '')}\\${name}` : path.posix.join(sqlDir, name);
        await log(`BACKUP ${db} → ${sqlPath}`);
        const req = pool.request();
        req.on('info', (i) => log(`  ${i.message}`));
        req.input('db', sql.NVarChar(128), db);
        req.input('f', sql.NVarChar(400), sqlPath);
        await req.query(`BACKUP DATABASE @db TO DISK = @f WITH INIT, CHECKSUM;${sa ? ' RESTORE VERIFYONLY FROM DISK = @f WITH CHECKSUM;' : ''}`);
        if (!sa) await log('  VERIFYONLY 건너뜀 (sa 필요 — BACKUP CHECKSUM 으로 페이지 검사는 함)');
        const local = path.join(dbDir, name);
        result.databases.push({ name: db, file: local, bytes: existsSync(local) ? (await stat(local)).size : null });
      }
    } finally {
      await pool.close();
    }

    // 2) 보관 정리 — 지정 패턴만
    for (const f of expiredBackups(await readdir(dbDir), now, retentionDays)) {
      await log(`보관기간 경과 삭제: ${path.join(dbDir, f)}`);
      await unlink(path.join(dbDir, f));
      result.deleted.push(f);
    }

    // 3) 미디어 증분 복사
    if (existsSync(mediaRoot)) {
      const copied = await copyNewer(mediaRoot, mediaDir);
      result.media = { copied };
      await log(`미디어 복사 완료 (${copied}개)`);
    } else {
      await log(`미디어 폴더 없음, 건너뜀: ${mediaRoot}`);
    }
    result.ok = true;
  } catch (err) {
    await log(`실패: ${err.message}`);
    result.error = err.message;
    code = 1;
  } finally {
    result.endedAt = stamp().replace(' ', 'T');
    await writeFile(path.join(logDir, 'last_backup.json'), JSON.stringify(result, null, 2), 'utf8');
  }
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
