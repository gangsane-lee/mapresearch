// A7 임장 일정·캘린더 — 계획(visit_plan) + 실제 기록(스냅샷 관측일)을 한 달력에 표시
import { z } from 'zod';
import { sql } from '../db/pool.js';
import { ymd } from '../db/tx.js';
import { AppError } from '../util/errors.js';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const visitInput = z.object({
  complexId: z.number().int().positive(),
  plannedOn: z.iso.date(),
  plannedTime: time.nullish(),
  memo: z.string().max(500).nullish(),
});

export const visitPatch = z
  .object({
    plannedOn: z.iso.date(),
    plannedTime: time.nullable(),
    memo: z.string().max(500).nullable(),
    status: z.enum(['PLANNED', 'DONE', 'CANCELED']),
  })
  .partial();

function parse(schema, body) {
  const r = schema.safeParse(body);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new AppError('VALIDATION', `${i.path.join('.') || '입력'}: ${i.message}`, 400);
  }
  return r.data;
}

// time 컬럼은 SQL에서 'HH:mm' 문자열로 변환해 받는다 (드라이버의 time→Date 시간대 해석 회피)
const hhmm = (t) => (t == null ? null : String(t).slice(0, 5));

/** 기간 내 일정 + 스냅샷 기록 */
export async function listCalendar(pool, from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new AppError('VALIDATION', 'from/to 는 YYYY-MM-DD', 400);
  const res = await pool
    .request()
    .input('f', sql.Date, from)
    .input('t', sql.Date, to).query(`
      SELECT v.visit_id, v.complex_id, c.display_nm, v.planned_on, CONVERT(varchar(5), v.planned_time, 108) AS planned_time, v.memo, v.status, v.snapshot_id
      FROM dbo.visit_plan v JOIN dbo.complex c ON c.complex_id = v.complex_id
      WHERE v.planned_on BETWEEN @f AND @t ORDER BY v.planned_on, v.planned_time;
      SELECT s.snapshot_id, s.complex_id, c.display_nm, s.observed_at, s.source
      FROM dbo.v_snapshot_active s JOIN dbo.complex c ON c.complex_id = s.complex_id
      WHERE s.observed_at BETWEEN @f AND @t ORDER BY s.observed_at;`);
  const [visits, snaps] = res.recordsets;
  return {
    visits: visits.map((v) => ({
      visitId: v.visit_id,
      complexId: v.complex_id,
      displayNm: v.display_nm,
      plannedOn: ymd(v.planned_on),
      plannedTime: hhmm(v.planned_time),
      memo: v.memo,
      status: v.status,
      snapshotId: v.snapshot_id == null ? null : Number(v.snapshot_id),
    })),
    snapshots: snaps.map((s) => ({
      snapshotId: Number(s.snapshot_id),
      complexId: s.complex_id,
      displayNm: s.display_nm,
      observedAt: ymd(s.observed_at),
      source: s.source,
    })),
  };
}

export async function createVisit(pool, body) {
  const v = parse(visitInput, body);
  const r = await pool
    .request()
    .input('c', sql.Int, v.complexId)
    .input('d', sql.Date, v.plannedOn)
    .input('tm', sql.VarChar(5), v.plannedTime ?? null)
    .input('m', sql.NVarChar(500), v.memo ?? null)
    .query('INSERT dbo.visit_plan (complex_id, planned_on, planned_time, memo) OUTPUT inserted.visit_id VALUES (@c, @d, CAST(@tm AS time(0)), @m)');
  return { visitId: r.recordset[0].visit_id };
}

/** 수정. status=DONE 이면 같은 단지·같은 날 스냅샷을 찾아 연결 */
export async function patchVisit(pool, visitId, body) {
  const v = parse(visitPatch, body);
  const r = pool.request().input('id', sql.Int, visitId);
  const sets = ['updated_at = SYSDATETIME()'];
  if (v.plannedOn !== undefined) (r.input('d', sql.Date, v.plannedOn), sets.push('planned_on = @d'));
  if (v.plannedTime !== undefined) (r.input('tm', sql.VarChar(5), v.plannedTime), sets.push('planned_time = CAST(@tm AS time(0))'));
  if (v.memo !== undefined) (r.input('m', sql.NVarChar(500), v.memo), sets.push('memo = @m'));
  if (v.status !== undefined) {
    r.input('st', sql.VarChar(10), v.status);
    sets.push('status = @st');
    sets.push(`snapshot_id = CASE WHEN @st = 'DONE' THEN
                 (SELECT TOP (1) s.snapshot_id FROM dbo.v_snapshot_active s
                  WHERE s.complex_id = visit_plan.complex_id AND s.observed_at = COALESCE(${v.plannedOn !== undefined ? '@d' : 'visit_plan.planned_on'}, visit_plan.planned_on)
                  ORDER BY s.snapshot_id DESC)
               ELSE NULL END`);
  }
  const u = await r.query(`UPDATE dbo.visit_plan SET ${sets.join(', ')} OUTPUT inserted.snapshot_id WHERE visit_id = @id`);
  if (!u.recordset.length) throw new AppError('NOT_FOUND', '일정을 찾을 수 없습니다', 404);
  return { visitId, snapshotId: u.recordset[0].snapshot_id == null ? null : Number(u.recordset[0].snapshot_id) };
}
