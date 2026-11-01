// 개발 서버 한 번에 띄우기 — 코드를 저장하면 바로 반영된다
//   npm run dev                 .env.dev 가 있으면 그것(개발 DB), 없으면 .env
//
//   API  : node --watch (api/src 저장 시 자동 재시작), 포트 = env 파일의 PORT
//   화면 : Vite (web/src 저장 시 새로고침 없이 반영) http://localhost:5173 — /api 는 위 API 로 프록시
// 맥미니처럼 운영(launchd, .env = RealtyLog_PROD, 5180)과 개발을 같은 PC에서 할 때는
// .env.dev 에 DB_NAME=RealtyLog_DEV, PORT=5181 을 두면 운영 서버와 부딪히지 않는다.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = existsSync(path.join(root, '.env.dev')) ? '.env.dev' : '.env';
if (!existsSync(path.join(root, envFile))) {
  console.error('.env 가 없습니다 (README "맥미니 설치" 4단계)');
  process.exit(1);
}
const port = /^PORT=(\d+)/m.exec(readFileSync(path.join(root, envFile), 'utf8'))?.[1] ?? '5180';
console.log(`개발 서버: ${envFile} · API http://127.0.0.1:${port} · 화면 http://localhost:5173`);

const children = [];
function run(tag, cmd, args, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd: root, env: { ...process.env, ...extraEnv }, shell: process.platform === 'win32' });
  const out = (stream) => (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => stream.write(`[${tag}] ${l}\n`));
  p.stdout.on('data', out(process.stdout));
  p.stderr.on('data', out(process.stderr));
  p.on('exit', (code) => {
    console.log(`[${tag}] 종료 (${code})`);
    for (const c of children) if (c !== p && !c.killed) c.kill();
    process.exitCode = code ?? 0;
  });
  children.push(p);
}

run('api', process.execPath, ['--watch', `--env-file=${envFile}`, 'api/src/server.js']);
run('web', 'npm', ['run', 'dev', '-w', 'web'], { API_PORT: port });

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => children.forEach((c) => c.kill()));
