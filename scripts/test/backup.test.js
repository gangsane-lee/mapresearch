import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expiredBackups } from '../backup.js';

test('보관 정리: 지정 패턴의 기간 경과 파일만 고른다', () => {
  const today = new Date(2026, 10, 20); // 2026-11-20
  const names = [
    'RealtyLog_DEV_20261105.bak', // 15일 전 → 삭제
    'RealtyLog_PROD_20261106.bak', // 14일 전 → 유지 (경계)
    'RealtyLog_DEV_20261119.bak',
    'RealtyLog_TEST_20260101.bak', // TEST 는 패턴 밖
    'RealtyLog_DEV_20260101.bak.old',
    'manual_RealtyLog_DEV_20260101.bak',
    'notes.txt',
  ];
  assert.deepEqual(expiredBackups(names, today, 14), ['RealtyLog_DEV_20261105.bak']);
});
