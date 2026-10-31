import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { periodKeys } from '../src/external/quota.js';

const config = { apiToken: null };
const failingPool = () => Promise.reject(new Error('no db'));

async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

test('DB 없으면 /api/health 503, 모르는 API는 404 JSON', async () => {
  await withServer(createApp({ config, getPool: failingPool, webDist: '/nonexistent' }), async (base) => {
    const h = await fetch(`${base}/api/health`);
    assert.equal(h.status, 503);
    assert.equal((await h.json()).error.code, 'DB_UNAVAILABLE');

    const n = await fetch(`${base}/api/nope`);
    assert.equal(n.status, 404);
    assert.deepEqual((await n.json()).error.code, 'NOT_FOUND');
  });
});

test('API_TOKEN 설정 시 Bearer 없으면 401', async () => {
  const app = createApp({ config: { apiToken: 't'.repeat(24) }, getPool: failingPool, webDist: '/nonexistent' });
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/api/health`)).status, 401);
    const ok = await fetch(`${base}/api/health`, { headers: { authorization: `Bearer ${'t'.repeat(24)}` } });
    assert.equal(ok.status, 503); // 인증 통과 후 DB 없음
  });
});

test('SPA fallback: 알 수 없는 경로는 index.html', async () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'aptlog-dist-'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>AptLog</title>');
  await withServer(createApp({ config, getPool: failingPool, webDist: dist }), async (base) => {
    const r = await fetch(`${base}/complex/12/detail`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /AptLog/);
  });
});

test('periodKeys: 로컬 기준 yyyyMMdd / yyyyMM', () => {
  assert.deepEqual(periodKeys(new Date(2026, 0, 5, 23, 59)), { DAY: '20260105', MONTH: '202601' });
});
