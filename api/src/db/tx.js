import { sql } from './pool.js';

/** fn(tx, req) 를 하나의 트랜잭션으로 실행. req() 는 tx에 묶인 새 Request */
export async function withTransaction(pool, fn) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const result = await fn(tx, () => new sql.Request(tx));
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

const pad = (n) => String(n).padStart(2, '0');

/** mssql date → 'YYYY-MM-DD' (useUTC:false 이므로 로컬 기준) */
export const ymd = (d) =>
  d == null ? null : d instanceof Date ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : String(d).slice(0, 10);

/** mssql datetime2 → 'YYYY-MM-DDTHH:mm:ss' KST 로컬 (Z 없음 — 앞 10자가 곧 로컬 날짜) */
export const localDateTime = (d) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

export const num = (v) => (v == null ? null : Number(v));
