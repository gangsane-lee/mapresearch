import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDataGoKr } from '../src/external/http.js';
import { normalizeSale, normalizeRent, parseCancelDay, siteKey, fetchMonth } from '../src/external/rtms.js';
import { prepareRows, recentMonths } from '../src/services/TradeSyncService.js';
import { jibunFromPnu, splitAddr, parseKaptRow } from '../../shared/kapt.js';

const fx = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

test('매매 실제 응답(2026-09 관악구) 정규화', () => {
  const r = parseDataGoKr(fx('rtms_trade.xml'));
  assert.equal(r.items.length, 10);
  assert.ok(r.totalCount > 10);
  const rows = r.items.map(normalizeSale);
  const doosan = rows.find((x) => x.aptNm === '두산');
  assert.deepEqual(
    { ...doosan },
    { sigunguCd: '11620', umdNm: '봉천동', jibun: '1708', aptNm: '두산', aptSeq: null, dealDate: '2026-09-15', exclM2: 84.92, floor: 16,
      dong: null, amountMan: 145000, canceled: false, cancelDate: null, dealType: '중개거래' },
  );
  assert.ok(rows.some((x) => x.jibun === '602-17'));
});

test('전월세 실제 응답 정규화 (aptSeq 있음, 월세 0)', () => {
  const rows = parseDataGoKr(fx('rtms_rent.xml')).items.map(normalizeRent);
  const u = rows.find((x) => x.aptNm === '봉천우성' && x.floor === 12);
  assert.equal(u.aptSeq, '11620-21');
  assert.equal(u.depositMan, 66500);
  assert.equal(u.monthlyMan, 0);
  assert.equal(u.dealDate, '2026-09-14');
  assert.equal(u.contractType, null);
});

test('응답 형식이 바뀌면 EXTERNAL_SCHEMA', () => {
  assert.throws(() => normalizeSale({ aptNm: 'x', sggCd: '11620' }), (e) => e.code === 'EXTERNAL_SCHEMA');
});

test('해제일 형식', () => {
  assert.equal(parseCancelDay('26.09.20'), '2026-09-20');
  assert.equal(parseCancelDay('20260920'), '2026-09-20');
  assert.equal(parseCancelDay(''), null);
  assert.equal(parseCancelDay('이상한값'), null);
});

test('자연키: 해제 여부가 달라도 같은 해시, 같은 거래 두 건은 dup_seq 1·2', () => {
  const base = { sigunguCd: '11620', umdNm: '봉천동', jibun: '1708', aptNm: '두산', aptSeq: null, dealDate: '2026-09-15', exclM2: 84.92,
    floor: 16, dong: null, amountMan: 145000 };
  const umd = new Map([['봉천동', '1162010100']]);
  const [a, b, c] = prepareRows('SALE', [{ ...base, canceled: false }, { ...base, canceled: true }, { ...base, floor: 3 }], umd);
  assert.equal(a.naturalKeyHash, b.naturalKeyHash);
  assert.deepEqual([a.dupSeq, b.dupSeq, c.dupSeq], [1, 2, 1]);
  assert.equal(a.bjdCd, '1162010100');
  assert.equal(siteKey(base), '11620|봉천동|1708|두산');
  const [r] = prepareRows('RENT', [{ ...base, aptSeq: '11620-21', depositMan: 1, monthlyMan: 0 }], new Map());
  assert.equal(r.bjdCd, null);
});

test('recentMonths: 연도 경계', () => {
  assert.deepEqual(recentMonths(3, new Date(2026, 0, 15)), ['202601', '202512', '202511']);
});

test('fetchMonth: totalCount 까지 페이지 순회, 키는 URL 인코딩', async () => {
  const urls = [];
  const item = { aptNm: 'a', sggCd: '11620', umdNm: '봉천동', jibun: '1', dealYear: '2026', dealMonth: '9', dealDay: '1', excluUseAr: '59.9',
    floor: '1', aptDong: '', dealAmount: '100,000', cdealType: '', cdealDay: '', dealingGbn: '' };
  const call = async ({ url, apiCd }) => {
    urls.push(url);
    assert.equal(apiCd, 'DATA_GO_KR_RTMS');
    return { items: urls.length < 3 ? [item, item] : [item], totalCount: 5 };
  };
  const rows = await fetchMonth({ pool: null, serviceKey: 'a+b/c', kind: 'SALE', lawdCd: '11620', ym: '202609', numOfRows: 2, call });
  assert.equal(rows.length, 5);
  assert.equal(urls.length, 3);
  assert.match(urls[0], /serviceKey=a%2Bb%2Fc&LAWD_CD=11620&DEAL_YMD=202609&pageNo=1&numOfRows=2/);
});

test('단지 식별정보 CSV: PNU → 지번, 주소 → 읍면동', () => {
  assert.equal(jibunFromPnu('1162010100117080000'), '1708');
  assert.equal(jibunFromPnu('1162010200106020017'), '602-17');
  assert.equal(jibunFromPnu('1162010100200120000'), '산12');
  assert.deepEqual(splitAddr('서울특별시 관악구 봉천동 1708'), { sidoNm: '서울특별시', cityNm: null, sggNm: '관악구', umdNm: '봉천동' });
  assert.deepEqual(splitAddr('경기도 성남시 분당구 정자동 10'), { sidoNm: '경기도', cityNm: '성남시', sggNm: '분당구', umdNm: '정자동' });
  assert.equal(splitAddr('경기도 양평군 양평읍 양근리 1').umdNm, '양평읍 양근리');
  const k = parseKaptRow(['11620100050623', '1162010100117180000', '서울특별시 관악구 봉천동 1718', '벽산블루밍', '벽산블루밍', '벽산블루밍',
    '1', '18', '2105', '2005-06-30', '은천로 93']);
  assert.equal(k.bjdCd, '1162010100');
  assert.equal(k.jibun, '1718');
  assert.equal(k.hhldCnt, 2105);
  assert.equal(k.danjiKind, 1);
  assert.equal(parseKaptRow(['x', '1', 'a b c']), null);
});

test('주소 예외: 세종(시군구 없음), 지번 없는 주소', () => {
  assert.deepEqual(splitAddr('세종특별자치시  반곡동 841'), { sidoNm: '세종특별자치시', cityNm: null, sggNm: '세종특별자치시', umdNm: '반곡동' });
  assert.deepEqual(splitAddr('인천광역시 서구 가정동'), { sidoNm: '인천광역시', cityNm: null, sggNm: '서구', umdNm: '가정동' });
});
