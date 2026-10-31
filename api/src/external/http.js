// 외부 API 호출 공통부 (계획서 §5.5)
// 쿼터 가드 → 타임아웃 10초 → 재시도 2회(지수 백오프, 재시도도 쿼터 소비) → sync_log 기록.
import { XMLParser } from 'fast-xml-parser';
import { sql } from '../db/pool.js';
import { consume as realConsume } from './quota.js';
import { AppError } from '../util/errors.js';

const xml = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });

/** URL에서 비밀 파라미터 가림 (로그용) */
export function redactUrl(url, keys = ['serviceKey', 'ServiceKey', 'key']) {
  const u = new URL(url);
  for (const k of keys) if (u.searchParams.has(k)) u.searchParams.set(k, '***');
  return u.toString();
}

const asArray = (v) => (v == null || v === '' ? [] : Array.isArray(v) ? v : [v]);

/**
 * 공공데이터포털 공통 응답 → { items, totalCount, pageNo, numOfRows }
 * JSON/XML 모두, 단건 item(객체)도 배열로. 실패 코드는 AppError(EXTERNAL_API).
 * 구조(response.header/body.items.item)는 공통 규격 기준 — 실제 응답으로 확인(U1~U3) 후 필요 시 보정.
 */
export function parseDataGoKr(text, contentType = '') {
  const isJson = contentType.includes('json') || /^\s*[{[]/.test(text);
  const doc = isJson ? JSON.parse(text) : xml.parse(text);

  // 인증·트래픽 오류 형식
  const err = doc.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (err) {
    throw new AppError('EXTERNAL_API', `${err.returnReasonCode ?? ''} ${err.returnAuthMsg ?? err.errMsg ?? '외부 API 오류'}`.trim(), 502);
  }
  const res = doc.response ?? doc;
  const code = String(res.header?.resultCode ?? '');
  if (code && !/^0+$/.test(code)) {
    throw new AppError('EXTERNAL_API', `${code} ${res.header?.resultMsg ?? ''}`.trim(), 502);
  }
  const body = res.body ?? {};
  const items = body.items?.item ?? body.items ?? body.item;
  return {
    items: asArray(items && typeof items === 'object' && !Array.isArray(items) && items.item ? items.item : items),
    totalCount: Number(body.totalCount ?? 0),
    pageNo: Number(body.pageNo ?? 1),
    numOfRows: Number(body.numOfRows ?? 0),
  };
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} o
 * @param {import('mssql').ConnectionPool} o.pool
 * @param {string} o.apiCd       쿼터 키 (setting quota.{apiCd}.DAY/MONTH)
 * @param {string} o.job         sync_log.job
 * @param {string} o.url         완성된 URL (키 포함)
 * @param {object} [o.headers]
 * @param {number} [o.complexId]
 * @param {(text:string, contentType:string)=>any} [o.parse]
 */
export async function callExternal({
  pool,
  apiCd,
  job,
  url,
  headers = {},
  complexId = null,
  parse = (t) => t,
  timeoutMs = 10000,
  retries = 2,
  fetchImpl = fetch,
  consume = realConsume,
  sleep = defaultSleep,
  log = writeSyncLog,
}) {
  const startedAt = new Date();
  let lastErr;
  let status = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
    try {
      await consume(pool, apiCd); // 한도 초과면 즉시 throw (재시도하지 않음)
      const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      status = res.status;
      const text = await res.text();
      if (res.status >= 500) throw new AppError('EXTERNAL_HTTP', `HTTP ${res.status}`, 502);
      if (!res.ok) {
        const e = new AppError('EXTERNAL_HTTP', `HTTP ${res.status}`, 502);
        e.noRetry = true;
        throw e;
      }
      const data = parse(text, res.headers.get('content-type') ?? '');
      await log(pool, { job, apiCd, complexId, startedAt, ok: true, httpStatus: status, message: redactUrl(url) });
      return data;
    } catch (err) {
      lastErr = err;
      const fatal = err.code === 'QUOTA_EXCEEDED' || err.code === 'QUOTA_NOT_CONFIGURED' || err.code === 'EXTERNAL_API' || err.noRetry;
      if (fatal) break;
    }
  }
  const msg = lastErr?.name === 'TimeoutError' ? `시간 초과 (${timeoutMs}ms)` : lastErr?.message;
  await log(pool, { job, apiCd, complexId, startedAt, ok: false, httpStatus: status, message: `${msg} — ${redactUrl(url)}` });
  if (lastErr instanceof AppError) throw lastErr;
  throw new AppError('EXTERNAL_UNAVAILABLE', `외부 API 호출 실패: ${msg}`, 502);
}

export async function writeSyncLog(pool, { job, apiCd, complexId, startedAt, ok, httpStatus, message, detail }) {
  try {
    await pool
      .request()
      .input('job', sql.VarChar(40), job)
      .input('api', sql.VarChar(30), apiCd)
      .input('cid', sql.Int, complexId)
      .input('st', sql.DateTime2(3), startedAt)
      .input('ok', sql.Bit, ok)
      .input('hs', sql.Int, httpStatus)
      .input('msg', sql.NVarChar(2000), String(message ?? '').slice(0, 2000))
      .input('detail', sql.NVarChar(sql.MAX), detail ? JSON.stringify(detail) : null)
      .query(`INSERT dbo.sync_log (job, api_cd, complex_id, started_at, ended_at, ok, http_status, message, detail_json)
              VALUES (@job, @api, @cid, @st, SYSDATETIME(), @ok, @hs, @msg, @detail)`);
  } catch (err) {
    console.error('sync_log 기록 실패:', err.message); // 로그 실패가 본 작업을 막지 않게
  }
}
