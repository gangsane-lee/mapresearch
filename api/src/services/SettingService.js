import { z } from 'zod';
import { sql } from '../db/pool.js';
import { withTransaction, num } from '../db/tx.js';
import { AppError } from '../util/errors.js';

export async function getSettings(pool, keys) {
  const req = pool.request();
  const names = keys.map((k, i) => {
    req.input(`k${i}`, sql.VarChar(60), k);
    return `@k${i}`;
  });
  const r = await req.query(`SELECT setting_key, setting_val FROM dbo.setting WHERE setting_key IN (${names.join(',')})`);
  return Object.fromEntries(r.recordset.map((x) => [x.setting_key, x.setting_val]));
}

// 화면에서 바꿀 수 있는 설정 (키 화이트리스트 + 값 검증)
const intStr = (min, max) => z.coerce.number().int().min(min).max(max).transform(String);
const EDITABLE = {
  budget_man: z.union([z.literal(''), z.null(), intStr(0, 10_000_000)]).transform((v) => (v === '' ? null : v)),
  budget_source: z.enum(['MANUAL', 'HH']),
  map_engine: z.enum(['NAVER', 'KAKAO']),
  area_match_tolerance_m2: z.coerce.number().min(0).max(3).transform(String),
  stale_days: intStr(1, 365),
  quota_warn_ratio: z.coerce.number().min(0.1).max(1).transform(String),
  flag_gap_pct: z.coerce.number().min(-50).max(0).transform(String),
  'weight.traffic': intStr(0, 10),
  'weight.env': intStr(0, 10),
  'weight.edu': intStr(0, 10),
  'weight.price': intStr(0, 10),
};
const QUOTA_KEY = /^quota\.[A-Z0-9_]+\.(DAY|MONTH)$/;

export async function listEditableSettings(pool) {
  const r = await pool.request().query('SELECT setting_key, setting_val, updated_at FROM dbo.setting ORDER BY setting_key');
  return {
    items: r.recordset
      .filter((x) => x.setting_key in EDITABLE || QUOTA_KEY.test(x.setting_key))
      .map((x) => ({ key: x.setting_key, value: x.setting_val, updatedAt: x.updated_at })),
  };
}

/** body: { key: value, ... } — 기존 키만 수정 (새 쿼터 키 생성 불가: 무료 한도 확인 후 seed로 추가) */
export async function updateSettings(pool, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('VALIDATION', '객체 형식이어야 합니다', 400);
  const entries = Object.entries(body).map(([k, v]) => {
    if (k in EDITABLE) {
      const p = EDITABLE[k].safeParse(v);
      if (!p.success) throw new AppError('VALIDATION', `${k}: ${p.error.issues[0].message}`, 400);
      return [k, p.data];
    }
    if (QUOTA_KEY.test(k)) {
      const p = intStr(0, 10_000_000).safeParse(v);
      if (!p.success) throw new AppError('VALIDATION', `${k}: 0 이상의 정수`, 400);
      return [k, p.data];
    }
    throw new AppError('VALIDATION', `수정할 수 없는 설정: ${k}`, 400);
  });
  await withTransaction(pool, async (_tx, req) => {
    for (const [k, v] of entries) {
      const u = await req()
        .input('k', sql.VarChar(60), k)
        .input('v', sql.NVarChar(1000), v)
        .query('UPDATE dbo.setting SET setting_val = @v, updated_at = SYSDATETIME() WHERE setting_key = @k');
      if (!u.rowsAffected[0]) throw new AppError('VALIDATION', `없는 설정: ${k}`, 400);
    }
  });
  return listEditableSettings(pool);
}

const anchorInput = z.object({
  name: z.string().min(1).max(50),
  kind: z.enum(['CBD', 'WORK', 'HOME']),
  lat: z.number().min(33).max(39).nullish(),
  lng: z.number().min(124).max(132).nullish(),
  sort: z.number().int().min(0).max(10000).default(0),
  active: z.boolean().default(true),
});

export async function listAnchors(pool) {
  const r = await pool.request().query('SELECT anchor_id, name, kind, lat, lng, sort, active FROM dbo.anchor ORDER BY sort, anchor_id');
  return r.recordset.map((a) => ({ anchorId: a.anchor_id, name: a.name, kind: a.kind, lat: num(a.lat), lng: num(a.lng), sort: a.sort, active: !!a.active }));
}

/** 기준점 추가·수정. 삭제 대신 active=false (소요시간 이력 보존) */
export async function upsertAnchor(pool, anchorId, body) {
  const p = anchorInput.safeParse(body);
  if (!p.success) throw new AppError('VALIDATION', `${p.error.issues[0].path.join('.')}: ${p.error.issues[0].message}`, 400);
  const a = p.data;
  const req = pool
    .request()
    .input('n', sql.NVarChar(50), a.name)
    .input('k', sql.VarChar(10), a.kind)
    .input('la', sql.Decimal(9, 6), a.lat ?? null)
    .input('ln', sql.Decimal(9, 6), a.lng ?? null)
    .input('s', sql.Int, a.sort)
    .input('ac', sql.Bit, a.active);
  try {
    if (anchorId == null) {
      const r = await req.query('INSERT dbo.anchor (name, kind, lat, lng, sort, active) OUTPUT inserted.anchor_id VALUES (@n, @k, @la, @ln, @s, @ac)');
      return { anchorId: r.recordset[0].anchor_id };
    }
    const r = await req
      .input('id', sql.Int, anchorId)
      .query('UPDATE dbo.anchor SET name = @n, kind = @k, lat = @la, lng = @ln, sort = @s, active = @ac WHERE anchor_id = @id');
    if (!r.rowsAffected[0]) throw new AppError('NOT_FOUND', '기준점을 찾을 수 없습니다', 404);
    return { anchorId };
  } catch (err) {
    if (err.number === 2627 || err.number === 2601) throw new AppError('CONFLICT', '같은 이름의 기준점이 있습니다', 409);
    throw err;
  }
}
