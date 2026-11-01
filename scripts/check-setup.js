// 설치 점검 — 맥미니(또는 윈도우)에서 README 순서대로 설치한 뒤 실행해 빠진 단계를 찾는다
//   npm run check                       .env 기준
//   node scripts/check-setup.js --env-file .env.test
//
// 결과: ✓ 통과  ! 경고(동작은 하지만 확인 필요)  ✗ 실패(해결 방법 표시). 실패가 있으면 종료 코드 1.
// 읽기만 한다 — DB·파일·설정을 바꾸지 않으며, 비밀값은 출력하지 않는다(설정 여부만).
import { readdir, readFile, stat, access } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--env-file');
const envFile = path.resolve(root, i > 0 ? process.argv[i + 1] : '.env');
const env = process.env;
const isMac = process.platform === 'darwin';

const results = [];
const C = { ok: '\x1b[32m✓\x1b[0m', warn: '\x1b[33m!\x1b[0m', fail: '\x1b[31m✗\x1b[0m' };
function report(level, title, detail = '', fix = '') {
  results.push(level);
  console.log(`${C[level]} ${title}${detail ? ` — ${detail}` : ''}`);
  if (fix && level !== 'ok') console.log(`    → ${fix}`);
}
const section = (t) => console.log(`\n[${t}]`);
const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};
const connect = (user, password, database) =>
  new sql.ConnectionPool({
    server: env.DB_SERVER,
    port: Number(env.DB_PORT ?? 1433),
    database,
    user,
    password,
    options: { encrypt: true, trustServerCertificate: true, useUTC: false },
    connectionTimeout: 8000,
  }).connect();

// ── 1. 도구 ─────────────────────────────────────────────
section('1. 도구');
const major = Number(process.versions.node.split('.')[0]);
report(major >= 24 ? 'ok' : 'fail', `Node.js ${process.versions.node} (${process.arch})`, '', 'brew install node@24 && brew link --overwrite node@24');
if (isMac && process.arch !== 'arm64') report('warn', 'Node 가 arm64 가 아닙니다', 'Rosetta 터미널에서 설치한 Node 일 수 있음', 'Apple Silicon 용 Homebrew(/opt/homebrew)로 다시 설치');
report(existsSync(path.join(root, 'node_modules', 'mssql')) ? 'ok' : 'fail', '의존성 설치 (node_modules)', '', 'npm install');

// ── 2. .env ─────────────────────────────────────────────
section('2. .env');
if (!existsSync(envFile)) {
  report('fail', `.env 없음 (${envFile})`, '', 'cp .env.example .env 후 README 4단계 표대로 채우기');
  finish();
}
process.loadEnvFile(envFile);
report('ok', `.env 읽음 (${path.basename(envFile)})`);
const need = ['DB_SERVER', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'MIGRATE_USER', 'MIGRATE_PASSWORD', 'MEDIA_ROOT', 'BACKUP_ROOT'];
const missing = need.filter((k) => !env[k]);
report(missing.length ? 'fail' : 'ok', '필수 값', missing.length ? `비어 있음: ${missing.join(', ')}` : need.length + '개 설정됨', '.env 에 값 입력');
if (isMac) {
  report(env.MSSQL_SA_PASSWORD ? 'ok' : 'fail', 'MSSQL_SA_PASSWORD', env.MSSQL_SA_PASSWORD ? '설정됨' : '비어 있음', 'docker compose·db:setup·backup 에 필요');
  report(env.BACKUP_SQL_DIR === '/var/opt/mssql/backup' ? 'ok' : 'warn', 'BACKUP_SQL_DIR', env.BACKUP_SQL_DIR || '(비어 있음)', 'Docker 를 쓰면 /var/opt/mssql/backup');
}
for (const [k, label] of [['DATA_GO_KR_KEY', '공공데이터포털 키 (실거래 동기화)'], ['NCP_KEY_ID', '네이버 지도 Client ID'], ['NCP_CLIENT_SECRET', '네이버 Client Secret (지도 우클릭 주소)']]) {
  report(env[k] ? 'ok' : 'warn', label, env[k] ? '설정됨' : '비어 있음 — 이 기능만 동작 안 함', `.env 의 ${k}`);
}
for (const k of ['MEDIA_ROOT', 'BACKUP_ROOT']) {
  if (!env[k]) continue;
  try {
    await access(env[k], constants.W_OK);
    report('ok', `${k} 폴더 쓰기 가능`, env[k]);
  } catch {
    report('fail', `${k} 폴더 없음/쓰기 불가`, env[k], `mkdir -p "${env[k]}"`);
  }
}
if (env.BACKUP_ROOT) {
  report(existsSync(path.join(env.BACKUP_ROOT, 'db')) ? 'ok' : 'fail', 'BACKUP_ROOT/db 폴더', '', `mkdir -p "${path.join(env.BACKUP_ROOT, 'db')}" 후 docker compose up -d`);
}

// ── 3. SQL Server ───────────────────────────────────────
section('3. SQL Server');
if (isMac) {
  if (!run('docker', ['--version'])) report('fail', 'Docker 없음', '', 'Docker Desktop 설치 (README 1-3)');
  else {
    const st = run('docker', ['inspect', '-f', '{{.State.Status}}', 'aptlog-mssql']);
    report(st === 'running' ? 'ok' : 'fail', '컨테이너 aptlog-mssql', st ?? '없음', st ? 'docker compose logs mssql 로 원인 확인 (Rosetta·메모리·sa 비밀번호)' : 'docker compose up -d');
  }
}
let app = null;
try {
  app = await connect(env.DB_USER, env.DB_PASSWORD, env.DB_NAME);
  report('ok', `앱 로그인 ${env.DB_USER} → ${env.DB_NAME}`);
} catch (err) {
  const hint = err.code === 'ELOGIN' // 메시지는 서버 언어에 따라 달라 코드로 구분
    ? '로그인/DB 가 없거나 비밀번호가 다름 → npm run db:setup (윈도우 DB 를 복원했다면 README "데이터 옮기기" 4번)'
    : '서버 미기동 또는 포트 차단 → docker compose up -d (윈도우: SQL Server 서비스)';
  report('fail', `앱 로그인 ${env.DB_USER}`, err.message.split('\n')[0], hint);
}
if (app) {
  const r = (await app.request().query(`
    SELECT CAST(SERVERPROPERTY('ProductMajorVersion') AS int) AS major, CAST(SERVERPROPERTY('Edition') AS nvarchar(100)) AS edition,
           SYSDATETIME() AS now, DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS coll,
           (SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()) AS compat`)).recordset[0];
  report(r.major >= 17 ? 'ok' : 'fail', `SQL Server 버전 ${r.major} (${r.edition})`, r.major >= 17 ? '2025' : '2025(17) 필요', 'docker-compose.yml 의 이미지가 2025-latest 인지');
  report(r.compat >= 170 ? 'ok' : 'warn', `DB 호환성 수준 ${r.compat}`, '', 'npm run db:setup 재실행');
  report(r.coll === 'Korean_Wansung_CI_AS' ? 'ok' : 'warn', `DB 정렬 ${r.coll}`, '', '한글 정렬·검색이 다를 수 있음');
  const skewMin = Math.abs(new Date(r.now).getTime() - Date.now()) / 60000;
  report(skewMin < 5 ? 'ok' : 'fail', 'DB 시각이 이 PC 시각(KST)과 같음', `${Math.round(skewMin)}분 차이`, 'docker-compose.yml 의 TZ=Asia/Seoul 확인 후 docker compose up -d --force-recreate');
}

// ── 4. 스키마·기본 데이터 ─────────────────────────────────
section('4. 스키마·기본 데이터');
let mig = null;
try {
  mig = await connect(env.MIGRATE_USER, env.MIGRATE_PASSWORD, env.DB_NAME);
} catch (err) {
  report('fail', `마이그레이션 로그인 ${env.MIGRATE_USER}`, err.message.split('\n')[0], 'npm run db:setup');
}
if (mig) {
  const files = (await readdir(path.join(root, 'db', 'migrations'))).filter((f) => /^\d{3}_.+\.sql$/.test(f));
  let applied = 0;
  try {
    applied = (await mig.request().query('SELECT COUNT(*) AS n FROM dbo.schema_version')).recordset[0].n;
  } catch {
    /* 테이블 없음 = 아직 migrate 전 */
  }
  report(applied === files.length ? 'ok' : 'fail', `마이그레이션 ${applied}/${files.length} 적용`, '', 'npm run migrate');
  if (applied) {
    const c = (await mig.request().query(`
      SELECT (SELECT COUNT(*) FROM dbo.region) AS region, (SELECT COUNT(*) FROM dbo.region WHERE min_lng IS NOT NULL) AS region_bbox,
             (SELECT COUNT(*) FROM dbo.field_def) AS field_def,
             (SELECT COUNT(*) FROM dbo.setting WHERE setting_key LIKE 'quota.%') AS quota,
             (SELECT COUNT(*) FROM dbo.kapt_ref) AS kapt, (SELECT MAX(base_date) FROM dbo.kapt_ref) AS kapt_date,
             (SELECT COUNT(*) FROM dbo.complex) AS complexes, (SELECT COUNT(*) FROM dbo.trade) AS trades`)).recordset[0];
    report(c.region_bbox > 0 ? 'ok' : 'fail', `시군구 ${c.region}개 (경계 ${c.region_bbox}개)`, '', 'npm run migrate (seed 040_region.sql)');
    report(c.field_def > 0 ? 'ok' : 'fail', `스냅샷 항목 정의 ${c.field_def}개`, '', 'npm run migrate');
    report(c.quota > 0 ? 'ok' : 'fail', `외부 API 쿼터 설정 ${c.quota}개`, '', 'npm run migrate');
    report(c.kapt > 0 ? 'ok' : 'warn', `단지 식별정보 ${c.kapt.toLocaleString()}개`, c.kapt ? `기준일 ${c.kapt_date.toLocaleDateString('sv-SE')}` : '단지 검색이 비어 있음', 'README 7단계 (npm run kapt:import -- --file <CSV> --apply)');
    report('ok', `등록 단지 ${c.complexes}개, 실거래 ${c.trades.toLocaleString()}건`);
  }
  await mig.close();
}
if (app) {
  try {
    const p = (await app.request().query(`
      SELECT HAS_PERMS_BY_NAME('dbo.snapshot', 'OBJECT', 'UPDATE') AS upd, HAS_PERMS_BY_NAME('dbo.snapshot', 'OBJECT', 'DELETE') AS del,
             HAS_PERMS_BY_NAME('dbo.snapshot', 'OBJECT', 'INSERT') AS ins`)).recordset[0];
    const ok = p.upd === 0 && p.del === 0 && p.ins === 1;
    report(ok ? 'ok' : 'fail', '앱 로그인 권한: 스냅샷 INSERT만 (UPDATE·DELETE 거부)', '', 'npm run migrate (002_app_role) — 앱에 db_owner 로그인을 쓰고 있지 않은지 .env 확인');
  } catch {
    /* migrate 전 */
  }
  await app.close();
}

// ── 5. 화면·서버 ────────────────────────────────────────
section('5. 화면·서버');
report(existsSync(path.join(root, 'web', 'public', 'geo', 'index.json')) ? 'ok' : 'fail', '행정경계 파일 (web/public/geo)', '', 'git pull 로 받기 (저장소에 포함) 또는 npm run geo:build');
const dist = path.join(root, 'web', 'dist', 'index.html');
if (!existsSync(dist)) report('fail', '화면 빌드 (web/dist)', '없음', 'npm run build');
else {
  const newest = async (dir) => {
    let t = 0;
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      t = Math.max(t, e.isDirectory() ? await newest(p) : (await stat(p)).mtimeMs);
    }
    return t;
  };
  const stale = (await newest(path.join(root, 'web', 'src'))) > (await stat(dist)).mtimeMs;
  report(stale ? 'warn' : 'ok', '화면 빌드 (web/dist)', stale ? '소스가 빌드보다 최신' : '최신', 'npm run build 후 서버 재시작');
}
const port = Number(env.PORT ?? 5180);
try {
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3000) });
  const j = await res.json();
  report(j.ok ? 'ok' : 'fail', `서버 http://127.0.0.1:${port}`, j.ok ? '응답 정상' : JSON.stringify(j), '서버 로그 확인 (~/Library/Logs/AptLog/com.aptlog.api.log)');
} catch {
  report('warn', `서버 http://127.0.0.1:${port}`, '응답 없음', isMac ? 'npm start 또는 bash scripts/mac/install-launchd.sh' : 'npm start');
}

// ── 6. 자동 실행·백업 ───────────────────────────────────
section('6. 자동 실행·백업');
if (isMac) {
  const uid = run('id', ['-u']);
  for (const l of ['com.aptlog.api', 'com.aptlog.backup', 'com.aptlog.trades']) {
    const ok = run('launchctl', ['print', `gui/${uid}/${l}`]) != null;
    report(ok ? 'ok' : 'warn', `launchd ${l}`, ok ? '등록됨' : '미등록', 'bash scripts/mac/install-launchd.sh');
  }
}
if (env.BACKUP_ROOT) {
  try {
    const b = JSON.parse((await readFile(path.join(env.BACKUP_ROOT, 'logs', 'last_backup.json'), 'utf8')).replace(/^﻿/, ''));
    const ageH = (Date.now() - new Date(b.endedAt ?? b.startedAt).getTime()) / 3600000;
    if (!b.ok) report('fail', '마지막 백업 실패', b.error ?? '', 'npm run backup 으로 다시 실행해 메시지 확인');
    else report(ageH < 48 ? 'ok' : 'warn', '마지막 백업 성공', `${Math.round(ageH)}시간 전, ${(b.databases ?? []).map((d) => d.name).join(', ')}`, '자동 백업 등록 확인');
    if (b.sameDisk) report('warn', '백업이 원본과 같은 디스크', '디스크 고장 시 함께 손실', '외장 디스크가 생기면 .env 의 BACKUP_ROOT 변경');
  } catch {
    report('warn', '백업 기록 없음', '', 'npm run backup');
  }
}

finish();

function finish() {
  const n = (l) => results.filter((x) => x === l).length;
  console.log(`\n결과: 통과 ${n('ok')} · 경고 ${n('warn')} · 실패 ${n('fail')}`);
  if (n('fail')) console.log('실패 항목의 → 안내대로 고친 뒤 npm run check 를 다시 실행하세요.');
  process.exit(n('fail') ? 1 : 0);
}
