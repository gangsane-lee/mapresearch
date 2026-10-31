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

export const num = (v) => (v == null ? null : Number(v));
