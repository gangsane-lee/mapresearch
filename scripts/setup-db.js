// SQL Server 서버 수준 초기 설정 — DB·로그인·DB 사용자 생성 (재실행 안전, OS 무관)
//   npm run db:setup                                   .env 의 DB_NAME 기준
//   node scripts/setup-db.js --env-file .env.prod      다른 환경
//
// - db/setup/000_server_setup.sql 을 sa(sysadmin)로 실행한다. Windows 의 scripts/setup-sqlserver.ps1 과 같은 SQL.
// - 로그인 비밀번호는 .env 의 DB_PASSWORD(앱) / MIGRATE_PASSWORD(마이그레이션)를 그대로 쓴다 → 먼저 .env 를 채운다.
// - sa 비밀번호는 MSSQL_SA_PASSWORD (.env 또는 실행 시 환경변수 — docker-compose.yml 과 같은 값).
// - 미디어·백업 폴더(MEDIA_ROOT, BACKUP_ROOT/{db,media,logs})도 만든다.
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import { splitBatches, substituteVars } from '../db/lib.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argIdx = process.argv.indexOf('--env-file');
const envFile = path.resolve(root, argIdx > 0 ? process.argv[argIdx + 1] : '.env');
if (!existsSync(envFile)) {
  console.error(`.env 없음: ${envFile} (.env.example 을 복사해 채우세요)`);
  process.exit(1);
}
process.loadEnvFile(envFile);
const env = process.env;

const m = /^RealtyLog_(DEV|PROD|TEST)$/.exec(env.DB_NAME ?? '');
if (!m) {
  console.error('DB_NAME 은 RealtyLog_DEV | RealtyLog_PROD | RealtyLog_TEST 중 하나여야 합니다');
  process.exit(1);
}
const envUc = m[1];
const envLc = envUc.toLowerCase();

const problems = [];
if (!env.MSSQL_SA_PASSWORD) problems.push('MSSQL_SA_PASSWORD 환경변수 (sa 비밀번호, 실행할 때만 지정)');
for (const [k, login] of [['DB_PASSWORD', 'app'], ['MIGRATE_PASSWORD', 'mig']]) {
  const v = env[k] ?? '';
  if (v.length < 12) problems.push(`${k}: 12자 이상 (aptlog_${envLc}_${login} 로그인 비밀번호)`);
  if (/['"$]/.test(v)) problems.push(`${k}: 작은따옴표('), 큰따옴표("), $ 는 쓸 수 없습니다`);
}
if (env.DB_USER !== `aptlog_${envLc}_app`) problems.push(`DB_USER=aptlog_${envLc}_app 이어야 합니다`);
if (env.MIGRATE_USER !== `aptlog_${envLc}_mig`) problems.push(`MIGRATE_USER=aptlog_${envLc}_mig 이어야 합니다`);
if (problems.length) {
  console.error(`설정 확인:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}

const text = await readFile(path.join(root, 'db', 'setup', '000_server_setup.sql'), 'utf8');
const batches = splitBatches(
  substituteVars(text, { ENV_UC: envUc, ENV_LC: envLc, APP_PW: env.DB_PASSWORD, MIG_PW: env.MIGRATE_PASSWORD }),
);

const pool = await new sql.ConnectionPool({
  server: env.DB_SERVER,
  port: Number(env.DB_PORT ?? 1433),
  database: 'master',
  user: env.MSSQL_SA_USER || 'sa',
  password: env.MSSQL_SA_PASSWORD,
  options: { encrypt: true, trustServerCertificate: true, useUTC: false },
  // 연결 1개 — 스크립트의 USE 가 다음 배치에도 유지되도록 (CREATE DATABASE 는 트랜잭션 안에서 못 쓴다)
  pool: { min: 1, max: 1 },
}).connect();
try {
  console.log(`== RealtyLog_${envUc} 설정 (${env.DB_SERVER}:${env.DB_PORT ?? 1433}) ==`);
  for (const b of batches) {
    const r = pool.request();
    r.on('info', (i) => console.log(`  ${i.message}`));
    await r.batch(b);
  }
  // 다른 PC의 백업을 복원한 DB 정리: 로그인과 끊긴 사용자 다시 연결, 앱 사용자를 aptlog_app_role 에 (002 는 처음 한 번만 돈다)
  const repair = pool.request();
  repair.on('info', (i) => console.log(`  ${i.message}`));
  await repair.batch(`
    USE [RealtyLog_${envUc}];
    DECLARE @u sysname;
    DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM (VALUES (N'aptlog_${envLc}_app'), (N'aptlog_${envLc}_mig')) v(name);
    OPEN c; FETCH NEXT FROM c INTO @u;
    WHILE @@FETCH_STATUS = 0
    BEGIN
      IF EXISTS (SELECT 1 FROM sys.database_principals dp JOIN sys.server_principals sp ON sp.name = dp.name
                 WHERE dp.name = @u AND dp.sid <> sp.sid)
      BEGIN
        EXEC (N'ALTER USER ' + QUOTENAME(@u) + N' WITH LOGIN = ' + QUOTENAME(@u));
        PRINT N'로그인 다시 연결: ' + @u;
      END
      FETCH NEXT FROM c INTO @u;
    END
    CLOSE c;
    IF DATABASE_PRINCIPAL_ID(N'aptlog_app_role') IS NOT NULL AND IS_ROLEMEMBER(N'aptlog_app_role', N'aptlog_${envLc}_app') = 0
    BEGIN
      ALTER ROLE aptlog_app_role ADD MEMBER [aptlog_${envLc}_app];
      PRINT N'aptlog_app_role 추가: aptlog_${envLc}_app';
    END`);
} finally {
  await pool.close();
}

for (const d of [env.MEDIA_ROOT, ...['db', 'media', 'logs'].map((x) => env.BACKUP_ROOT && path.join(env.BACKUP_ROOT, x))]) {
  if (!d) continue;
  await mkdir(d, { recursive: true });
  console.log(`폴더 확인: ${d}`);
}
console.log(`완료. 다음: npm run migrate`);
