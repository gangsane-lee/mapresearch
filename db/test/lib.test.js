import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMigrationName, splitBatches, substituteVars, checksum } from '../lib.js';

test('parseMigrationName: NNN_name.sql 형식만 허용', () => {
  assert.deepEqual(parseMigrationName('001_init.sql'), { version: 1, name: '001_init.sql' });
  assert.equal(parseMigrationName('1_init.sql'), null);
  assert.equal(parseMigrationName('001-init.sql'), null);
});

test('splitBatches: 줄 단독 GO로 분리, 문자열 속 GO는 유지', () => {
  const sql = "SELECT 1\nGO\nSELECT 'GO here'\n  go  \r\nSELECT 3\nGO";
  assert.deepEqual(splitBatches(sql), ['SELECT 1', "SELECT 'GO here'", 'SELECT 3']);
});

test('substituteVars: 정의된 변수 치환, 미정의 변수는 오류', () => {
  assert.equal(substituteVars('USE [$(DB)]', { DB: 'RealtyLog_DEV' }), 'USE [RealtyLog_DEV]');
  assert.throws(() => substituteVars('$(NOPE)', {}), /NOPE/);
  assert.throws(() => substituteVars('$(EMPTY)', { EMPTY: '' }), /EMPTY/);
});

test('checksum: CRLF/LF 차이 무시', () => {
  assert.equal(checksum('a\r\nb'), checksum('a\nb'));
  assert.notEqual(checksum('a'), checksum('b'));
});
