import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManwon, parseDealAmount, m2ToPyeong } from '../src/util/unit.js';
import { haversineKm } from '../src/util/geo.js';
import { tradeKeyHash, assignDupSeq, matchAreaType, clusterAreas } from '../src/util/trade.js';

test('parseManwon: 허용 형식', () => {
  assert.equal(parseManwon('10.7억'), 107000);
  assert.equal(parseManwon('107000'), 107000);
  assert.equal(parseManwon('107,000'), 107000);
  assert.equal(parseManwon('10억7천'), 107000);
  assert.equal(parseManwon('10억 7,000만'), 107000);
  assert.equal(parseManwon('10억 5000만원'), 105000);
  assert.equal(parseManwon('7500만'), 7500);
  assert.equal(parseManwon('3천'), 3000);
  assert.equal(parseManwon('11.05억'), 110500);
  assert.equal(parseManwon(98000), 98000);
});

test('parseManwon: 거부', () => {
  assert.throws(() => parseManwon(''));
  assert.throws(() => parseManwon('abc'));
  assert.throws(() => parseManwon('10억5'), /모호/);
  assert.throws(() => parseManwon(-1));
});

test('parseDealAmount / m2ToPyeong', () => {
  assert.equal(parseDealAmount(' 113,000'), 113000);
  assert.throws(() => parseDealAmount('x'));
  assert.equal(m2ToPyeong(84.99), 25.7);
});

test('haversineKm: 강남역 ↔ 시청역 약 8.5km', () => {
  const d = haversineKm({ lat: 37.497942, lng: 127.027621 }, { lat: 37.565715, lng: 126.977088 });
  assert.ok(d > 8 && d < 9.2, `${d}`);
});

test('tradeKeyHash: 해제 정보는 키에 영향 없음, 면적 표기 차이 흡수', () => {
  const t = { aptSeq: '11620-123', dealDate: '2026-08-14', exclM2: 59.9, floor: 7, dong: ' 101 ', amountMan: 113000 };
  assert.equal(tradeKeyHash(t), tradeKeyHash({ ...t, exclM2: '59.90', dong: '101', cancelFlag: true }));
  assert.notEqual(tradeKeyHash(t), tradeKeyHash({ ...t, floor: 8 }));
});

test('assignDupSeq: 같은 키 정상 거래는 1,2로 구분', () => {
  const rows = [{ k: 'a' }, { k: 'b' }, { k: 'a' }];
  assert.deepEqual(assignDupSeq(rows, (r) => r.k).map((r) => r.dupSeq), [1, 1, 2]);
});

test('matchAreaType: ±0.5㎡ 이내 가장 가까운 평형', () => {
  const types = [{ areaTypeId: 1, exclM2: 59.97 }, { areaTypeId: 2, exclM2: 84.99 }];
  assert.equal(matchAreaType(59.6, types).areaTypeId, 1);
  assert.equal(matchAreaType(85.4, types).areaTypeId, 2);
  assert.equal(matchAreaType(74, types), null);
  assert.equal(matchAreaType(59.4, types), null);
});

test('clusterAreas: 가까운 면적 묶음 + 최빈값 대표', () => {
  const r = clusterAreas([59.97, 59.99, 59.97, 84.98, 84.99, 84.99, 114.5]);
  assert.deepEqual(r.map((g) => [g.exclM2, g.count]), [[59.97, 3], [84.99, 3], [114.5, 1]]);
});

test('computeFlags: 괴리 −5% 이하, 실거래 하락', async () => {
  const { computeFlags } = await import('../src/util/flags.js');
  const t = (amountMan) => ({ amountMan });
  assert.deepEqual(computeFlags({ priceAsk: 107000, lastTrade: t(113000), prevTrade: t(110000) }).map((f) => f.code), ['ASK_BELOW_TRADE']);
  assert.deepEqual(computeFlags({ priceAsk: 110000, lastTrade: t(113000), prevTrade: t(115000) }).map((f) => f.code), ['TRADE_DROP']);
  assert.deepEqual(computeFlags({ priceAsk: null, lastTrade: t(113000), prevTrade: null }), []);
  assert.deepEqual(computeFlags({ priceAsk: 108000, lastTrade: t(113000), prevTrade: null }, -3).map((f) => f.pct), [-4.4]);
});

test('localDateTime / ymd: 로컬 기준 (UTC로 바꾸지 않음)', async () => {
  const { localDateTime, ymd } = await import('../src/db/tx.js');
  const d = new Date(2026, 10, 1, 7, 40, 5); // 로컬 2026-11-01 07:40:05
  assert.equal(localDateTime(d), '2026-11-01T07:40:05');
  assert.equal(ymd(new Date(2026, 10, 1)), '2026-11-01');
});
