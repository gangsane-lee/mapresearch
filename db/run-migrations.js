// schema_version 기반 마이그레이션 러너
//   node db/run-migrations.js           미적용 마이그레이션 적용 + seed 실행
//   node db/run-migrations.js --status  적용 현황만 출력
//
// - 마이그레이션은 MIGRATE_USER(db_owner)로 실행, 파일 하나 = 트랜잭션 하나
// - 이미 적용된 파일의 내용이 바뀌면 중단 (기존 마이그레이션 수정 금지 규칙)
// - seed(db/seed/*.sql)는 매번 실행되므로 MERGE 등으로 재실행 안전하게 작성
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import { parseMigrationName, splitBatches, substituteVars, checksum } from './lib.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const required = ['DB_SERVER', 'DB_PORT', 'DB_NAME', 'MIGRATE_USER', 'MIGRATE_PASSWORD', 'DB_USER', 'HH_DB'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`.env 누락: ${missing.join(', ')}`);
  process.exit(1);
}

// 마이그레이션에서 쓸 수 있는 변수 (그 외 $(X)는 오류)
const vars = {
  DB_NAME: process.env.DB_NAME,
  APP_USER: process.env.DB_USER,
  HH_DB: process.env.HH_DB,
};

const statusOnly = process.argv.includes('--status');

const pool = await new sql.ConnectionPool({
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.MIGRATE_USER,
  password: process.env.MIGRATE_PASSWORD,
  options: { encrypt: true, trustServerCertificate: true, useUTC: false },
}).connect();

try {
  await pool.request().batch(`
    IF OBJECT_ID(N'dbo.schema_version', N'U') IS NULL
    CREATE TABLE dbo.schema_version (
        version    int          NOT NULL CONSTRAINT PK_schema_version PRIMARY KEY,
        name       nvarchar(200) NOT NULL,
        checksum   char(64)     NOT NULL,
        applied_at datetime2(0) NOT NULL CONSTRAINT DF_schema_version_applied DEFAULT SYSDATETIME()
    );`);

  const applied = new Map(
    (await pool.request().query('SELECT version, name, checksum FROM dbo.schema_version')).recordset.map((r) => [
      r.version,
      r,
    ]),
  );

  const migDir = path.join(root, 'db', 'migrations');
  const files = (await readdir(migDir)).filter((f) => f.endsWith('.sql')).sort();
  const migrations = [];
  for (const f of files) {
    const m = parseMigrationName(f);
    if (!m) throw new Error(`마이그레이션 파일명 형식 오류: ${f} (NNN_name.sql)`);
    if (migrations.some((x) => x.version === m.version)) throw new Error(`버전 중복: ${f}`);
    const text = await readFile(path.join(migDir, f), 'utf8');
    migrations.push({ ...m, text, checksum: checksum(text) });
  }

  for (const m of migrations) {
    const a = applied.get(m.version);
    if (a && a.checksum !== m.checksum) {
      throw new Error(`적용된 마이그레이션이 변경됨: ${m.name} — 기존 파일 수정 금지, 새 파일로 작성하세요.`);
    }
  }

  if (statusOnly) {
    for (const m of migrations) console.log(`${applied.has(m.version) ? '적용' : '대기'}  ${m.name}`);
  } else {
    let count = 0;
    for (const m of migrations.filter((x) => !applied.has(x.version))) {
      await runInTransaction(pool, substituteVars(m.text, vars), async (tx) => {
        await new sql.Request(tx)
          .input('v', sql.Int, m.version)
          .input('n', sql.NVarChar(200), m.name)
          .input('c', sql.Char(64), m.checksum)
          .query('INSERT dbo.schema_version (version, name, checksum) VALUES (@v, @n, @c)');
      });
      console.log(`적용: ${m.name}`);
      count++;
    }
    console.log(count ? `마이그레이션 ${count}건 적용` : '적용할 마이그레이션 없음');

    const seedDir = path.join(root, 'db', 'seed');
    const seeds = existsSync(seedDir) ? (await readdir(seedDir)).filter((f) => f.endsWith('.sql')).sort() : [];
    for (const f of seeds) {
      const text = await readFile(path.join(seedDir, f), 'utf8');
      await runInTransaction(pool, substituteVars(text, vars));
      console.log(`seed: ${f}`);
    }
  }
} catch (err) {
  console.error(`실패: ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.close();
}

async function runInTransaction(pool, text, after) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const batch of splitBatches(text)) await new sql.Request(tx).batch(batch);
    if (after) await after(tx);
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}
