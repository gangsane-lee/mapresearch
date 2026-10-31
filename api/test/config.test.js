import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const base = {
  DB_SERVER: '127.0.0.1',
  DB_NAME: 'RealtyLog_DEV',
  DB_USER: 'aptlog_dev_app',
  DB_PASSWORD: 'x',
  MEDIA_ROOT: 'C:\\m',
  BACKUP_ROOT: 'C:\\b',
};

test('기본값: 127.0.0.1 바인딩, 토큰 불필요', () => {
  const c = loadConfig(base);
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.port, 5180);
  assert.equal(c.apiToken, null);
  assert.equal(c.db.port, 1433);
});

test('0.0.0.0 바인딩이면 24자 이상 API_TOKEN 필수', () => {
  assert.throws(() => loadConfig({ ...base, HOST: '0.0.0.0' }), /API_TOKEN/);
  assert.throws(() => loadConfig({ ...base, HOST: '0.0.0.0', API_TOKEN: 'short' }), /API_TOKEN/);
  const c = loadConfig({ ...base, HOST: '0.0.0.0', API_TOKEN: 'a'.repeat(24) });
  assert.equal(c.apiToken, 'a'.repeat(24));
});

test('DB_NAME은 RealtyLog_DEV/PROD만 허용, 빈 값은 미설정 취급', () => {
  assert.throws(() => loadConfig({ ...base, DB_NAME: 'HH_PROD' }), /DB_NAME/);
  assert.throws(() => loadConfig({ ...base, DB_PASSWORD: '' }), /DB_PASSWORD/);
  assert.equal(loadConfig({ ...base, NCP_KEY_ID: '' }).keys.ncpKeyId, null);
});
