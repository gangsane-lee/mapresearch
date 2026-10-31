// 비교 기록 (계획서 §3.2 #28·#29) — 기준일 시점의 스냅샷을 묶어 결론과 함께 저장
import { z } from 'zod';
import { sql } from '../db/pool.js';
import { withTransaction, ymd } from '../db/tx.js';
import { AppError } from '../util/errors.js';

const input = z.object({
  asOf: z.iso.date(),
  title: z.string().min(1).max(100),
  conclusion: z.string().max(4000).nullish(),
  items: z
    .array(z.object({ complexId: z.number().int().positive(), areaTypeId: z.number().int().positive().nullish() }))
    .min(2)
    .max(4),
});

export async function createComparison(pool, body) {
  const r = input.safeParse(body);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new AppError('VALIDATION', `${i.path.join('.')}: ${i.message}`, 400);
  }
  const v = r.data;
  return withTransaction(pool, async (_tx, req) => {
    const head = await req()
      .input('a', sql.Date, v.asOf)
      .input('t', sql.NVarChar(100), v.title)
      .input('c', sql.NVarChar(4000), v.conclusion ?? null)
      .query('INSERT dbo.comparison (as_of, title, conclusion) OUTPUT inserted.comparison_id VALUES (@a, @t, @c)');
    const id = head.recordset[0].comparison_id;
    let sort = 0;
    for (const it of v.items) {
      await req()
        .input('id', sql.Int, id)
        .input('c', sql.Int, it.complexId)
        .input('ar', sql.Int, it.areaTypeId ?? null)
        .input('a', sql.Date, v.asOf)
        .input('o', sql.Int, sort++).query(`
          INSERT dbo.comparison_item (comparison_id, complex_id, snapshot_id, area_type_id, sort)
          VALUES (@id, @c,
                  (SELECT TOP (1) snapshot_id FROM dbo.v_snapshot_active WHERE complex_id = @c AND observed_at <= @a
                   ORDER BY observed_at DESC, snapshot_id DESC),
                  @ar, @o)`);
    }
    return { comparisonId: id };
  });
}

export async function listComparisons(pool) {
  const res = await pool.request().query(`
    SELECT c.comparison_id, c.as_of, c.title, c.conclusion, c.created_at
    FROM dbo.comparison c ORDER BY c.created_at DESC;
    SELECT i.comparison_id, i.complex_id, i.snapshot_id, i.area_type_id, i.sort, x.display_nm
    FROM dbo.comparison_item i JOIN dbo.complex x ON x.complex_id = i.complex_id ORDER BY i.comparison_id, i.sort;`);
  const [heads, items] = res.recordsets;
  return heads.map((h) => ({
    comparisonId: h.comparison_id,
    asOf: ymd(h.as_of),
    title: h.title,
    conclusion: h.conclusion,
    createdAt: h.created_at,
    items: items
      .filter((i) => i.comparison_id === h.comparison_id)
      .map((i) => ({
        complexId: i.complex_id,
        displayNm: i.display_nm,
        snapshotId: i.snapshot_id == null ? null : Number(i.snapshot_id),
        areaTypeId: i.area_type_id,
      })),
  }));
}
