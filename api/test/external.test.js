import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callExternal, parseDataGoKr, redactUrl } from '../src/external/http.js';
import { AppError } from '../src/util/errors.js';

const ok = (body, type = 'application/xml') => ({
  status: 200,
  ok: true,
  text: async () => body,
  headers: new Headers({ 'content-type': type }),
});
const fail = (status) => ({ status, ok: false, text: async () => '', headers: new Headers() });

function harness(responses) {
  const calls = { consume: 0, fetch: 0, logs: [] };
  const queue = [...responses];
  return {
    calls,
    opts: {
      pool: {},
      apiCd: 'DATA_GO_KR_RTMS',
      job: 'test',
      url: 'https://apis.data.go.kr/x?serviceKey=SECRET&LAWD_CD=11620',
      consume: async () => {
        calls.consume++;
      },
      fetchImpl: async () => {
        calls.fetch++;
        const r = queue.shift();
        if (r instanceof Error) throw r;
        return r;
      },
      sleep: async () => {},
      log: async (_p, entry) => calls.logs.push(entry),
    },
  };
}

test('redactUrl: serviceKey 가림', () => {
  assert.equal(redactUrl('https://a.b/c?serviceKey=abc&x=1'), 'https://a.b/c?serviceKey=***&x=1');
});

test('parseDataGoKr: XML 다건/단건, JSON', () => {
  const multi = `<response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
    <body><items><item><a>1</a></item><item><a>2</a></item></items><totalCount>2</totalCount><pageNo>1</pageNo><numOfRows>10</numOfRows></body></response>`;
  const r = parseDataGoKr(multi);
  assert.deepEqual(r.items, [{ a: '1' }, { a: '2' }]);
  assert.equal(r.totalCount, 2);

  const single = `<response><header><resultCode>00</resultCode></header><body><items><item><a>1</a></item></items><totalCount>1</totalCount></body></response>`;
  assert.deepEqual(parseDataGoKr(single).items, [{ a: '1' }]);

  const empty = `<response><header><resultCode>00</resultCode></header><body><items></items><totalCount>0</totalCount></body></response>`;
  assert.deepEqual(parseDataGoKr(empty).items, []);

  const json = JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: { item: [{ a: 1 }] }, totalCount: 1 } } });
  assert.deepEqual(parseDataGoKr(json, 'application/json').items, [{ a: 1 }]);
});

test('parseDataGoKr: 오류 응답은 EXTERNAL_API', () => {
  const authErr = `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;
  assert.throws(() => parseDataGoKr(authErr), (e) => e.code === 'EXTERNAL_API' && /NOT_REGISTERED/.test(e.message));
  const codeErr = `<response><header><resultCode>03</resultCode><resultMsg>NO_DATA</resultMsg></header></response>`;
  assert.throws(() => parseDataGoKr(codeErr), /03 NO_DATA/);
});

test('callExternal: 성공 시 쿼터 1회, 로그에 키 가림', async () => {
  const h = harness([ok('<response><header><resultCode>00</resultCode></header><body><items/></body></response>')]);
  const r = await callExternal({ ...h.opts, parse: parseDataGoKr });
  assert.deepEqual(r.items, []);
  assert.equal(h.calls.consume, 1);
  assert.equal(h.calls.logs[0].ok, true);
  assert.ok(!h.calls.logs[0].message.includes('SECRET'));
});

test('callExternal: 5xx·네트워크 오류는 재시도 (재시도도 쿼터 소비)', async () => {
  const h = harness([fail(503), new TypeError('fetch failed'), ok('done', 'text/plain')]);
  assert.equal(await callExternal(h.opts), 'done');
  assert.equal(h.calls.fetch, 3);
  assert.equal(h.calls.consume, 3);
});

test('callExternal: 재시도 소진 시 실패 로그 + EXTERNAL_UNAVAILABLE', async () => {
  const h = harness([new TypeError('x'), new TypeError('x'), new TypeError('x')]);
  await assert.rejects(callExternal(h.opts), (e) => e.code === 'EXTERNAL_UNAVAILABLE');
  assert.equal(h.calls.logs.at(-1).ok, false);
});

test('callExternal: 쿼터 초과·4xx·API 오류 코드는 재시도하지 않음', async () => {
  const q = harness([]);
  q.opts.consume = async () => {
    throw new AppError('QUOTA_EXCEEDED', '초과', 429);
  };
  await assert.rejects(callExternal(q.opts), (e) => e.code === 'QUOTA_EXCEEDED');
  assert.equal(q.calls.fetch, 0);

  const c = harness([fail(401)]);
  await assert.rejects(callExternal(c.opts), (e) => e.code === 'EXTERNAL_HTTP');
  assert.equal(c.calls.fetch, 1);

  const a = harness([ok('<response><header><resultCode>30</resultCode><resultMsg>KEY</resultMsg></header></response>')]);
  await assert.rejects(callExternal({ ...a.opts, parse: parseDataGoKr }), (e) => e.code === 'EXTERNAL_API');
  assert.equal(a.calls.fetch, 1);
});
