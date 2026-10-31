// 실DB 통합 테스트 — 전용 DB RealtyLog_TEST 에서만 실행 (DEV/PROD 데이터 보호)
//
//   1) scripts\setup-sqlserver.ps1 -Env TEST
//   2) .env.test 작성 (.env 와 같은 형식, DB_NAME=RealtyLog_TEST, DB_USER=aptlog_test_app, MIGRATE_USER=aptlog_test_mig, HH_DB=HH_DEV)
//   3) npm run test:db
//
// 테스트 데이터는 실행마다 고유 이름으로 추가된다(삭제하지 않음 — 스냅샷은 append-only).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { createPool, sql } from '../src/db/pool.js';
import { createManual, patchComplex, getComplex } from '../src/services/ComplexWriteService.js';
import { createSnapshot, getDraft, getDiff, correctSnapshot, voidSnapshot, listSnapshots, getSeries } from '../src/services/SnapshotService.js';
import { compare } from '../src/services/CompareService.js';
import { listSummary } from '../src/services/ComplexService.js';
import { consume } from '../src/external/quota.js';
import { assignSchool, upsertSchool, upsertStat, complexSchools } from '../src/services/SchoolService.js';
import { createVisit, patchVisit, listCalendar } from '../src/services/VisitService.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skip = process.env.DB_NAME !== 'RealtyLog_TEST' ? 'DB_NAME=RealtyLog_TEST 일 때만 실행 (.env.test)' : false;
let pool;
const tag = `T${Date.now().toString(36)}`;
const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

before(async () => {
  if (skip) return;
  execFileSync(process.execPath, [path.join(root, 'db', 'run-migrations.js')], { env: process.env, stdio: 'inherit' });
  pool = await createPool(loadConfig().db);
  await pool
    .request()
    .query(`IF NOT EXISTS (SELECT 1 FROM dbo.region WHERE sigungu_cd = '11620')
              INSERT dbo.region (sigungu_cd, sido_cd, sido_nm, sgg_nm) VALUES ('11620', '11', N'서울특별시', N'관악구')`);
});
after(async () => pool?.close());

test('단지 등록 → 스냅샷 2회 → 복사값·증감 → 정정·무효 → 비교', { skip }, async () => {
  const { complexId } = await createManual(pool, {
    displayNm: `벽산${tag}`,
    sigunguCd: '11620',
    bjdCd: '1162010100',
    lat: 37.4746,
    lng: 126.9566,
    tags: ['언덕'],
    areaTypes: [{ label: '23평', exclM2: 59.9, rooms: 3, baths: 2, isPrimary: true }, { label: '32평', exclM2: 84.9 }],
    master: { useAprDay: '2005-06-01', hhldCnt: 2105, hallType: '복도식', farRatio: 249.5 },
  });
  const c = await getComplex(pool, complexId);
  const a23 = c.areaTypes.find((a) => a.label === '23평').areaTypeId;
  assert.equal(c.master.hhldCnt, 2105);

  // 1차
  const s1 = await createSnapshot(pool, complexId, {
    observedAt: '2026-09-01',
    source: 'VISIT',
    values: [
      { fieldCd: 'price_ask', areaTypeId: a23, value: '10.7억' },
      { fieldCd: 'grade_traffic', value: 'A' },
      { fieldCd: 'env_mart', value: 1 },
    ],
    commutes: [{ anchorId: 1, mode: 'TRANSIT', minutes: 38, transfers: 1 }],
  });

  // 초안: 직전 값 복사
  const draft = await getDraft(pool, complexId, today);
  const ask = draft.values.find((v) => v.fieldCd === 'price_ask' && v.areaTypeId === a23);
  assert.equal(ask.value, 107000);
  assert.ok(ask.carriedFromValueId);
  const mart = draft.values.find((v) => v.fieldCd === 'env_mart');

  // 2차: 호가 변경, 마트는 복사 유지, 등급은 확인(복사 아님)
  const s2 = await createSnapshot(pool, complexId, {
    observedAt: '2026-10-01',
    source: 'ONLINE',
    values: [
      { fieldCd: 'price_ask', areaTypeId: a23, value: 110000, carriedFromValueId: ask.carriedFromValueId },
      { fieldCd: 'grade_traffic', value: 'S' },
      { fieldCd: 'env_mart', value: 1, carriedFromValueId: mart.carriedFromValueId },
    ],
    commutes: [{ anchorId: 1, mode: 'TRANSIT', minutes: 38, transfers: 1, carriedFromCommuteId: draft.commutes[0].carriedFromCommuteId }],
  });

  const diff = await getDiff(pool, s2.snapshotId);
  const askDiff = diff.numeric.find((n) => n.fieldCd === 'price_ask');
  assert.equal(askDiff.delta, 3000, '값이 바뀐 호가는 직전 관측 대비 증감');
  assert.ok(!diff.numeric.some((n) => n.fieldCd === 'env_mart'), '복사값은 증감 계산에서 제외');
  assert.ok(diff.unconfirmed.some((u) => u.fieldCd === 'env_mart'));
  assert.ok(diff.changed.some((x) => x.fieldCd === 'grade_traffic' && x.prevValue === 'A' && x.value === 'S'));

  // 복사값 위장(값이 다른데 carriedFrom 지정) → 서버가 관측값으로 처리
  const s3 = await createSnapshot(pool, complexId, {
    observedAt: '2026-10-15',
    source: 'VISIT',
    values: [{ fieldCd: 'env_mart', value: 2, carriedFromValueId: mart.carriedFromValueId }],
  });
  const series = await getSeries(pool, complexId, ['env_mart']);
  assert.deepEqual(series.map((x) => x.value), [1, 2], '실제 관측값만 시계열에 포함');

  // 정정: 원본 무효 + 정정본
  const fixed = await correctSnapshot(pool, s3.snapshotId, {
    observedAt: '2026-10-15',
    source: 'VISIT',
    reason: '마트 수 오기',
    values: [{ fieldCd: 'env_mart', value: 1 }],
  });
  await assert.rejects(correctSnapshot(pool, s3.snapshotId, { observedAt: '2026-10-15', source: 'VISIT', values: [] }), /무효화된/);
  const list = await listSnapshots(pool, complexId, { includeVoid: true });
  assert.ok(list.find((x) => x.snapshotId === s3.snapshotId).voided);
  assert.equal(list.find((x) => x.snapshotId === fixed.snapshotId).supersedesId, s3.snapshotId);

  await voidSnapshot(pool, fixed.snapshotId, { reason: '테스트 무효' });
  assert.equal((await listSnapshots(pool, complexId)).length, 2);

  // 비교·요약
  const cmp = await compare(pool, [complexId], {});
  assert.equal(cmp.items[0].values.price_ask.value, 110000);
  assert.equal(cmp.items[0].values.env_mart.carried, true);
  assert.equal(cmp.items[0].values.env_mart.observedAt, '2026-09-01', '복사값의 관측일은 원 관측일');
  assert.equal(cmp.items[0].derived.askDelta, 3000);
  const sum = (await listSummary(pool)).find((x) => x.complexId === complexId);
  assert.equal(sum.priceAsk, 110000);
  assert.deepEqual(sum.tags, ['언덕']);

  await patchComplex(pool, complexId, { status: 'CANDIDATE', tags: ['언덕', '대단지'] });
  assert.equal((await getComplex(pool, complexId)).status, 'CANDIDATE');
  assert.ok(s1.snapshotId);
});

test('앱 로그인은 스냅샷 UPDATE/DELETE 불가 (DENY)', { skip }, async () => {
  await assert.rejects(pool.request().query('UPDATE TOP (1) dbo.snapshot SET memo = memo'), /permission|권한|UPDATE/i);
  await assert.rejects(pool.request().query('DELETE TOP (1) dbo.snapshot_value'), /permission|권한|DELETE/i);
});

test('쿼터 가드: 한도 초과 시 차단, 미설정 API 거부', { skip }, async () => {
  const api = `TEST_${tag}`.slice(0, 30);
  await pool.request().input('k', sql.VarChar(60), `quota.${api}.DAY`).query("INSERT dbo.setting (setting_key, setting_val) VALUES (@k, N'2')");
  await consume(pool, api);
  await consume(pool, api);
  await assert.rejects(consume(pool, api), (e) => e.code === 'QUOTA_EXCEEDED');
  await assert.rejects(consume(pool, `NONE_${tag}`), (e) => e.code === 'QUOTA_NOT_CONFIGURED');
});

test('학교 배정 이력·일정 완료 연결', { skip }, async () => {
  const { complexId } = await createManual(pool, {
    displayNm: `두산${tag}`,
    sigunguCd: '11620',
    lat: 37.48,
    lng: 126.94,
    areaTypes: [{ label: '24평', exclM2: 59.8 }],
  });
  const { schoolId: s1 } = await upsertSchool(pool, null, { schoolNm: `구암중${tag}`, schoolKind: 'MIDDLE' });
  const { schoolId: s2 } = await upsertSchool(pool, null, { schoolNm: `봉천중${tag}`, schoolKind: 'MIDDLE' });
  await upsertStat(pool, s2, { year: 2025, metricCd: 'ACHIEVE_AVG', metricDesc: '학교알리미', value: 82 });
  await assignSchool(pool, complexId, { schoolId: s1, validFrom: '2024-03-01' });
  await assignSchool(pool, complexId, { schoolId: s2, validFrom: '2026-03-01', walkMin: 20 });
  const sc = await complexSchools(pool, complexId);
  assert.equal(sc.find((x) => x.current).schoolId, s2);
  assert.equal(sc.find((x) => !x.current).validTo, '2026-02-28');
  assert.equal(sc.find((x) => x.current).latestStat.value, 82);

  const snap = await createSnapshot(pool, complexId, { observedAt: '2026-10-20', source: 'VISIT', values: [] });
  const { visitId } = await createVisit(pool, { complexId, plannedOn: '2026-10-20', plannedTime: '14:30' });
  const done = await patchVisit(pool, visitId, { status: 'DONE' });
  assert.equal(done.snapshotId, snap.snapshotId);
  const cal = await listCalendar(pool, '2026-10-01', '2026-10-31');
  assert.equal(cal.visits.find((v) => v.visitId === visitId).plannedTime, '14:30');
});
