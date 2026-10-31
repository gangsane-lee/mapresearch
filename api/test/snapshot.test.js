import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toColumns, fromColumns, sameColumns } from '../src/services/fieldValues.js';
import { parseInput } from '../src/services/SnapshotService.js';
import { manualInput, patchInput, masterHash } from '../src/services/ComplexWriteService.js';

const def = (data_type, extra = {}) => ({ field_cd: 'f', label: '항목', data_type, unit: null, ...extra });
const enums = new Map([['grade_traffic', new Set(['S', 'A', 'B', 'C'])]]);

test('toColumns: 금액은 만원 정규화', () => {
  assert.deepEqual(toColumns(def('num', { unit: '만원' }), '10.7억', enums), { num: 107000, text: null, date: null });
  assert.throws(() => toColumns(def('num', { unit: '만원' }), '10억5', enums), /항목: .*모호/);
});

test('toColumns: 빈 값은 저장하지 않음', () => {
  assert.equal(toColumns(def('num'), '', enums), null);
  assert.equal(toColumns(def('text'), '   ', enums), null);
  assert.equal(toColumns(def('num'), null, enums), null);
});

test('toColumns: 형식별 변환·검증', () => {
  assert.deepEqual(toColumns(def('num'), '12', enums).num, 12);
  assert.throws(() => toColumns(def('num'), -1, enums), /0 이상/);
  assert.deepEqual(toColumns(def('bool'), true, enums).num, 1);
  assert.throws(() => toColumns(def('bool'), 'Y', enums));
  assert.equal(toColumns({ ...def('enum'), field_cd: 'grade_traffic' }, 'S', enums).text, 'S');
  assert.throws(() => toColumns({ ...def('enum'), field_cd: 'grade_traffic' }, 'X', enums), /허용되지 않은/);
  assert.equal(toColumns(def('date'), '2026-08', enums).date, '2026-08-01');
  assert.throws(() => toColumns(def('date'), '26.08', enums));
});

test('fromColumns / sameColumns', () => {
  assert.equal(fromColumns(def('bool'), { num_val: 1 }), true);
  assert.equal(fromColumns(def('num'), { num_val: '107000.0000' }), 107000);
  assert.equal(fromColumns(def('date'), { date_val: new Date(2026, 7, 1) }), '2026-08-01');
  assert.ok(sameColumns({ num: '107000.0000', text: null, date: null }, { num: 107000, text: null, date: null }));
  assert.ok(!sameColumns({ num: 1, text: null, date: null }, { num: 2, text: null, date: null }));
});

test('parseInput: 필수·미래 관측일 거부', () => {
  assert.throws(() => parseInput({ source: 'VISIT', values: [] }), /observedAt/);
  assert.throws(() => parseInput({ observedAt: '2999-01-01', source: 'VISIT', values: [] }), /오늘 이후/);
  const ok = parseInput({ observedAt: '2026-10-01', source: 'ONLINE', values: [{ fieldCd: 'price_ask', areaTypeId: 1, value: '10억' }] });
  assert.deepEqual(ok.commutes, []);
});

test('manualInput / patchInput', () => {
  const base = { displayNm: '테스트', sigunguCd: '11620', lat: 37.47, lng: 126.95, areaTypes: [{ label: '23평', exclM2: 59.9 }] };
  const v = manualInput.parse(base);
  assert.equal(v.status, 'INTEREST');
  assert.equal(v.areaTypes[0].isPrimary, false);
  assert.ok(!manualInput.safeParse({ ...base, lat: 10 }).success);
  assert.ok(!manualInput.safeParse({ ...base, areaTypes: [] }).success);
  assert.ok(!patchInput.safeParse({ lat: 37.5 }).success);
  assert.ok(patchInput.safeParse({ status: 'VISITED' }).success);
});

test('masterHash: 키 순서 무관, 값 변화 감지', () => {
  assert.equal(masterHash({ a: 1, b: 2 }), masterHash({ b: 2, a: 1 }));
  assert.notEqual(masterHash({ a: 1 }), masterHash({ a: 2 }));
});

test('updateSettings: 화이트리스트·값 검증은 DB 접근 전에 거부', async () => {
  const { updateSettings } = await import('../src/services/SettingService.js');
  const pool = { request() { throw new Error('DB 접근하면 안 됨'); } };
  await assert.rejects(updateSettings(pool, { secret_key: 'x' }), /수정할 수 없는 설정/);
  await assert.rejects(updateSettings(pool, { stale_days: 0 }), /stale_days/);
  await assert.rejects(updateSettings(pool, { map_engine: 'GOOGLE' }), /map_engine/);
  await assert.rejects(updateSettings(pool, { 'quota.KAKAO_TRANSIT.DAY': -1 }), /0 이상/);
  await assert.rejects(updateSettings(pool, []), /객체/);
});

test('학교 입력 검증: 성취도는 지표 정의 필수', async () => {
  const { statInput, assignInput, schoolInput } = await import('../src/services/SchoolService.js');
  assert.ok(!statInput.safeParse({ year: 2025, metricCd: 'ACHIEVE_AVG', metricDesc: '', value: 82 }).success);
  assert.ok(statInput.safeParse({ year: 2025, metricCd: 'ACHIEVE_AVG', metricDesc: '학교알리미', value: 82 }).success);
  assert.ok(!statInput.safeParse({ year: 2025, metricCd: 'bad code', metricDesc: 'x', value: 1 }).success);
  assert.ok(!assignInput.safeParse({ schoolId: 1, validFrom: '2026-13-01' }).success);
  assert.ok(!schoolInput.safeParse({ schoolNm: '구암중', schoolKind: 'UNIV' }).success);
});

test('일정 입력 검증', async () => {
  const { visitInput, visitPatch } = await import('../src/services/VisitService.js');
  assert.ok(visitInput.safeParse({ complexId: 1, plannedOn: '2026-11-08', plannedTime: '14:30' }).success);
  assert.ok(!visitInput.safeParse({ complexId: 1, plannedOn: '2026-11-08', plannedTime: '25:00' }).success);
  assert.ok(!visitPatch.safeParse({ status: 'MAYBE' }).success);
  assert.ok(visitPatch.safeParse({ plannedTime: null }).success);
});
