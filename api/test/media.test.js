import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import sharp from 'sharp';
import { inspectImage, relPaths, safeResolve } from '../src/services/MediaService.js';

test('relPaths: {complex}/{yyyyMM}/{uuid}.{ext} + thumb/{uuid}.webp', () => {
  assert.deepEqual(relPaths(7, new Date(2026, 9, 3), 'u-1', 'jpg'), { rel: '7/202610/u-1.jpg', thumb: 'thumb/u-1.webp' });
});

test('safeResolve: MEDIA_ROOT 밖 경로 거부', () => {
  const root = path.resolve('C:/AptLogData/media');
  assert.equal(safeResolve(root, '7/202610/a.jpg'), path.join(root, '7', '202610', 'a.jpg'));
  assert.throws(() => safeResolve(root, '../secret.txt'), /잘못된 경로/);
  assert.throws(() => safeResolve(root, '../../Windows/win.ini'), /잘못된 경로/);
});

test('inspectImage: 크기·sha256·480px webp 썸네일', async () => {
  const jpg = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#3366cc' } }).jpeg().toBuffer();
  const info = await inspectImage(jpg, 'image/jpeg');
  assert.equal(info.w, 1600);
  assert.equal(info.h, 900);
  assert.match(info.sha256, /^[0-9a-f]{64}$/);
  const t = await sharp(info.thumb).metadata();
  assert.equal(t.format, 'webp');
  assert.equal(t.width, 480);
  assert.equal(info.takenAt, null);
});

test('inspectImage: 형식 위장·미지원 형식 거부', async () => {
  await assert.rejects(inspectImage(Buffer.from('not an image'), 'image/jpeg'), /읽을 수 없습니다/);
  await assert.rejects(inspectImage(Buffer.from('GIF89a'), 'image/gif'), /지원하지 않는 형식/);
});
