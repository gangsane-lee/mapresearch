import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createApp } from '../src/app.js';

/** SQL 문을 보고 답하는 가짜 풀 (media 경로 전용) */
function fakePool() {
  const shas = new Set();
  let nextId = 1;
  return {
    request() {
      const inputs = {};
      const req = {
        input(name, _t, v) {
          inputs[name] = v;
          return req;
        },
        async query(q) {
          if (q.includes('SELECT media_id FROM dbo.media WHERE sha256')) {
            return { recordset: shas.has(inputs.h) ? [{ media_id: 1 }] : [] };
          }
          if (q.includes('INSERT dbo.media')) {
            shas.add(inputs.h);
            return { recordset: [{ media_id: nextId++ }] };
          }
          throw new Error(`unexpected query: ${q.slice(0, 60)}`);
        },
      };
      return req;
    },
  };
}

test('POST /api/media: 업로드 → 원본·썸네일 저장, 같은 파일 재업로드는 중복', async () => {
  const mediaRoot = mkdtempSync(path.join(tmpdir(), 'aptlog-media-'));
  const pool = fakePool();
  const app = createApp({ config: { apiToken: null, mediaRoot, backupRoot: mediaRoot }, getPool: async () => pool, webDist: '/none' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#ff0000' } }).png().toBuffer();
    const form = () => {
      const fd = new FormData();
      fd.append('complexId', '3');
      fd.append('kind', 'PRICE_CAPTURE');
      fd.append('files', new Blob([png], { type: 'image/png' }), '시세.png');
      return fd;
    };

    const r1 = await fetch(`${base}/api/media`, { method: 'POST', body: form() });
    assert.equal(r1.status, 201);
    const b1 = await r1.json();
    assert.equal(b1.items[0].ok, true);
    assert.equal(b1.items[0].name, '시세.png'); // 한글 파일명 복원

    const r2 = await fetch(`${base}/api/media`, { method: 'POST', body: form() });
    assert.equal(r2.status, 400);
    assert.equal((await r2.json()).items[0].code, 'DUPLICATE');

    const bad = new FormData();
    bad.append('complexId', '3');
    bad.append('files', new Blob(['x'], { type: 'text/plain' }), 'a.txt');
    const r3 = await fetch(`${base}/api/media`, { method: 'POST', body: bad });
    assert.equal(r3.status, 400);
    assert.match((await r3.json()).error.message, /지원하지 않는 형식/);

    // 썸네일 폴더 생성 확인
    assert.ok(existsSync(path.join(mediaRoot, 'thumb')));
  } finally {
    server.close();
  }
});
