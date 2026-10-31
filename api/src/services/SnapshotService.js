// 스냅샷 (계획서 §4.2, §7.4) — snapshot/snapshot_value/commute 는 INSERT 만 한다.
import { z } from 'zod';
import { sql } from '../db/pool.js';
import { withTransaction, ymd, num } from '../db/tx.js';
import { AppError } from '../util/errors.js';
import { matchAreaType } from '../util/trade.js';
import { toColumns, fromColumns, sameColumns } from './fieldValues.js';
import { getSettings } from './SettingService.js';

const pad = (n) => String(n).padStart(2, '0');
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const snapshotInput = z.object({
  observedAt: z.iso.date(),
  source: z.enum(['VISIT', 'ONLINE', 'AGENT']),
  memo: z.string().max(1000).nullish(),
  values: z
    .array(
      z.object({
        fieldCd: z.string().max(40),
        areaTypeId: z.number().int().positive().nullish(),
        value: z.unknown(),
        carriedFromValueId: z.number().int().positive().nullish(),
      }),
    )
    .max(500),
  commutes: z
    .array(
      z.object({
        anchorId: z.number().int().positive(),
        mode: z.enum(['TRANSIT', 'CAR', 'WALK', 'BIKE']),
        minutes: z.number().int().min(0).max(600),
        transfers: z.number().int().min(0).max(10).nullish(),
        routeDesc: z.string().max(300).nullish(),
        suggestedMinutes: z.number().int().min(0).max(600).nullish(),
        carriedFromCommuteId: z.number().int().positive().nullish(),
      }),
    )
    .max(50)
    .default([]),
});

export function parseInput(body) {
  const r = snapshotInput.safeParse(body);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new AppError('VALIDATION', `${i.path.join('.')}: ${i.message}`, 400);
  }
  if (r.data.observedAt > todayYmd()) throw new AppError('VALIDATION', '관측일은 오늘 이후일 수 없습니다', 400);
  return r.data;
}

// ── 메타 ───────────────────────────────────────────────
export async function loadMeta(reqOrPool) {
  const req = () => (typeof reqOrPool === 'function' ? reqOrPool() : reqOrPool.request());
  const defs = (await req().query('SELECT * FROM dbo.field_def WHERE active = 1 ORDER BY sort')).recordset;
  const enums = (await req().query('SELECT field_cd, code, label, ord FROM dbo.enum_def ORDER BY field_cd, ord DESC')).recordset;
  const enumCodes = new Map();
  for (const e of enums) {
    if (!enumCodes.has(e.field_cd)) enumCodes.set(e.field_cd, new Set());
    enumCodes.get(e.field_cd).add(e.code);
  }
  return { defs, defMap: new Map(defs.map((d) => [d.field_cd, d])), enums, enumCodes };
}

export const defToDto = (d) => ({
  fieldCd: d.field_cd,
  label: d.label,
  category: d.category,
  dataType: d.data_type,
  unit: d.unit,
  scope: d.scope,
  diffMode: d.diff_mode,
  better: d.better,
  carryForward: !!d.carry_forward,
  confirmOnCarry: !!d.confirm_on_carry,
  sort: d.sort,
});

async function requireComplex(req, complexId) {
  const r = await req().input('c', sql.Int, complexId).query('SELECT complex_id, display_nm FROM dbo.complex WHERE complex_id = @c');
  if (!r.recordset.length) throw new AppError('NOT_FOUND', '단지를 찾을 수 없습니다', 404);
  return r.recordset[0];
}

async function areaTypesOf(req, complexId) {
  return (
    await req()
      .input('c', sql.Int, complexId)
      .query('SELECT area_type_id, label, excl_m2, is_primary FROM dbo.area_type WHERE complex_id = @c ORDER BY is_primary DESC, sort, excl_m2')
  ).recordset.map((a) => ({ areaTypeId: a.area_type_id, label: a.label, exclM2: Number(a.excl_m2), isPrimary: !!a.is_primary }));
}

/** 관측일 기준 평형별 최근 매매 실거래 (해제 건 제외) */
export async function lastTradesByArea(req, complexId, observedAt, areaTypes, tolerance) {
  const rows = (
    await req()
      .input('c', sql.Int, complexId)
      .input('d', sql.Date, observedAt)
      .query(`SELECT TOP (500) deal_date, excl_m2, amount_man FROM dbo.trade
              WHERE complex_id = @c AND cancel_flag = 0 AND deal_date <= @d
              ORDER BY deal_date DESC, trade_id DESC`)
  ).recordset;
  const out = new Map();
  for (const t of rows) {
    const a = matchAreaType(Number(t.excl_m2), areaTypes, tolerance);
    if (a && !out.has(a.areaTypeId)) out.set(a.areaTypeId, { amountMan: t.amount_man, dealDate: ymd(t.deal_date) });
  }
  return out;
}

/** 지역 단위로 공유되는 항목 (같은 법정동이면 대체로 같은 값) */
export const REGIONAL_FIELDS = ['edu_academy_cnt', 'env_dept', 'env_mart', 'env_hospital', 'env_hazard', 'env_hazard_memo'];

/** 같은 법정동 다른 단지들의 지역 항목 최신 실제 관측값 (항목별 가장 최근 1건) */
export async function neighborValues(req, complexId) {
  const r = req().input('c', sql.Int, complexId);
  const names = REGIONAL_FIELDS.map((f, i) => (r.input(`rf${i}`, sql.VarChar(40), f), `@rf${i}`));
  const rows = (
    await r.query(`
      SELECT x.field_cd, x.num_val, x.text_val, x.date_val, x.eff_observed_at, x.display_nm
      FROM (SELECT v.field_cd, v.num_val, v.text_val, v.date_val, v.eff_observed_at, o.display_nm,
                   ROW_NUMBER() OVER (PARTITION BY v.field_cd ORDER BY v.eff_observed_at DESC, v.snapshot_id DESC) AS rn
            FROM dbo.complex me
            JOIN dbo.complex o ON o.bjd_cd = me.bjd_cd AND o.complex_id <> me.complex_id
            JOIN dbo.v_snapshot_value_eff v ON v.complex_id = o.complex_id AND v.area_type_id IS NULL AND v.is_carried = 0
            WHERE me.complex_id = @c AND me.bjd_cd IS NOT NULL AND v.field_cd IN (${names.join(',')})) x
      WHERE x.rn = 1`)
  ).recordset;
  return new Map(rows.map((x) => [x.field_cd, x]));
}

// ── 입력 초안 (직전 값 복사) ────────────────────────────
export async function getDraft(pool, complexId, observedAt = todayYmd()) {
  const req = () => pool.request();
  const complex = await requireComplex(req, complexId);
  const meta = await loadMeta(pool);
  const areaTypes = await areaTypesOf(req, complexId);
  const settings = await getSettings(pool, ['area_match_tolerance_m2']);
  const tolerance = Number(settings.area_match_tolerance_m2 ?? 0.5);

  const prev = (
    await req()
      .input('c', sql.Int, complexId)
      .query(`SELECT TOP (1) snapshot_id, observed_at FROM dbo.v_snapshot_active
              WHERE complex_id = @c ORDER BY observed_at DESC, snapshot_id DESC`)
  ).recordset[0];

  const prevValues = new Map();
  let prevCommutes = [];
  if (prev) {
    const rows = (
      await req()
        .input('s', sql.BigInt, prev.snapshot_id)
        .query('SELECT * FROM dbo.v_snapshot_value_eff WHERE snapshot_id = @s')
    ).recordset;
    for (const r of rows) prevValues.set(`${r.field_cd}|${r.area_type_id ?? ''}`, r);
    prevCommutes = (
      await req()
        .input('s', sql.BigInt, prev.snapshot_id)
        .query(`SELECT c.*, COALESCE(os.observed_at, s.observed_at) AS eff_observed_at
                FROM dbo.commute c
                JOIN dbo.snapshot s ON s.snapshot_id = c.snapshot_id
                LEFT JOIN dbo.commute oc ON oc.commute_id = c.carried_from_commute_id
                LEFT JOIN dbo.snapshot os ON os.snapshot_id = oc.snapshot_id
                WHERE c.snapshot_id = @s`)
    ).recordset;
  }

  const trades = await lastTradesByArea(req, complexId, observedAt, areaTypes, tolerance);
  // 첫 스냅샷이면 같은 법정동 다른 단지의 지역 공유 값 제안 (계획서 §7.4, A10)
  const neighbor = prev ? new Map() : await neighborValues(req, complexId);

  const values = [];
  for (const d of meta.defs) {
    const targets = d.scope === 'AREA' ? areaTypes.map((a) => a.areaTypeId) : [null];
    for (const areaTypeId of targets) {
      const v = { fieldCd: d.field_cd, areaTypeId, value: null, carriedFromValueId: null, carriedObservedAt: null, auto: null, prefill: null };
      const p = prevValues.get(`${d.field_cd}|${areaTypeId ?? ''}`);
      if (d.carry_forward && p) {
        v.value = fromColumns(d, p);
        v.carriedFromValueId = Number(p.carried_from_value_id ?? p.value_id);
        v.carriedObservedAt = ymd(p.eff_observed_at);
      }
      const n = areaTypeId == null ? neighbor.get(d.field_cd) : null;
      if (n && v.value == null) {
        v.value = fromColumns(d, n);
        v.prefill = { complexNm: n.display_nm, observedAt: ymd(n.eff_observed_at) };
      }
      const t = areaTypeId != null ? trades.get(areaTypeId) : null;
      if (t && d.field_cd === 'price_last_trade') v.value = t.amountMan;
      if (t && d.field_cd === 'price_last_trade_ym') v.value = t.dealDate.slice(0, 7);
      if (t && (d.field_cd === 'price_last_trade' || d.field_cd === 'price_last_trade_ym')) v.auto = { dealDate: t.dealDate };
      values.push(v);
    }
  }

  const anchors = (await req().query('SELECT anchor_id, name, kind, lat, lng FROM dbo.anchor WHERE active = 1 ORDER BY sort')).recordset;
  const commutes = prevCommutes.map((c) => ({
    anchorId: c.anchor_id,
    mode: c.mode,
    minutes: c.minutes,
    transfers: c.transfers,
    routeDesc: c.route_desc,
    suggestedMinutes: null,
    carriedFromCommuteId: Number(c.carried_from_commute_id ?? c.commute_id),
    carriedObservedAt: ymd(c.eff_observed_at),
  }));

  const master = (
    await req()
      .input('c', sql.Int, complexId)
      .query(`SELECT rev_id, status, use_apr_day, hhld_cnt, dong_cnt, max_floor, hall_type, far_ratio, bc_ratio, fetched_at
              FROM dbo.master_revision WHERE complex_id = @c AND status IN ('CURRENT','PENDING') ORDER BY rev_id DESC`)
  ).recordset;

  return {
    complexId,
    displayNm: complex.display_nm,
    observedAt,
    prevSnapshotId: prev ? Number(prev.snapshot_id) : null,
    prevObservedAt: prev ? ymd(prev.observed_at) : null,
    fields: meta.defs.map(defToDto),
    enums: meta.enums.map((e) => ({ fieldCd: e.field_cd, code: e.code, label: e.label, ord: e.ord })),
    areaTypes,
    anchors: anchors.map((a) => ({ anchorId: a.anchor_id, name: a.name, kind: a.kind, lat: num(a.lat), lng: num(a.lng) })),
    values,
    commutes,
    master: master.find((m) => m.status === 'CURRENT') ?? null,
    pendingMasterRevId: master.find((m) => m.status === 'PENDING')?.rev_id ?? null,
  };
}

// ── 생성 / 정정 / 무효 ─────────────────────────────────
async function insertSnapshot(req, meta, complexId, input, supersedesId) {
  const areaIds = new Set((await areaTypesOf(req, complexId)).map((a) => a.areaTypeId));

  // 값 검증·변환
  const prepared = [];
  const seen = new Set();
  for (const v of input.values) {
    const d = meta.defMap.get(v.fieldCd);
    if (!d) throw new AppError('VALIDATION', `알 수 없는 항목: ${v.fieldCd}`, 400);
    const areaTypeId = v.areaTypeId ?? null;
    if (d.scope === 'AREA' && (areaTypeId == null || !areaIds.has(areaTypeId))) {
      throw new AppError('VALIDATION', `${d.label}: 이 단지의 평형을 지정해야 합니다`, 400);
    }
    if (d.scope === 'COMPLEX' && areaTypeId != null) throw new AppError('VALIDATION', `${d.label}: 단지 단위 항목입니다`, 400);
    const key = `${d.field_cd}|${areaTypeId ?? ''}`;
    if (seen.has(key)) throw new AppError('VALIDATION', `${d.label}: 중복 입력`, 400);
    seen.add(key);
    const cols = toColumns(d, v.value, meta.enumCodes);
    if (!cols) continue;
    prepared.push({ d, areaTypeId, cols, carriedFromValueId: v.carriedFromValueId ?? null });
  }

  // 복사값 검증: 원본과 값이 같을 때만 복사값으로 인정, 최초 원본 id로 평탄화
  const claimIds = prepared.map((p) => p.carriedFromValueId).filter(Boolean);
  if (claimIds.length) {
    const r = req();
    const names = claimIds.map((id, i) => (r.input(`v${i}`, sql.BigInt, id), `@v${i}`));
    const src = new Map(
      (
        await r.input('c', sql.Int, complexId).query(`
          SELECT sv.value_id, sv.carried_from_value_id, sv.field_cd, sv.area_type_id, sv.num_val, sv.text_val, sv.date_val
          FROM dbo.snapshot_value sv JOIN dbo.snapshot s ON s.snapshot_id = sv.snapshot_id
          WHERE sv.value_id IN (${names.join(',')}) AND s.complex_id = @c`)
      ).recordset.map((x) => [Number(x.value_id), x]),
    );
    for (const p of prepared) {
      if (!p.carriedFromValueId) continue;
      const s = src.get(p.carriedFromValueId);
      const match =
        s &&
        s.field_cd === p.d.field_cd &&
        (s.area_type_id ?? null) === p.areaTypeId &&
        sameColumns({ num: s.num_val, text: s.text_val, date: ymd(s.date_val) }, p.cols);
      p.carriedFromValueId = match ? Number(s.carried_from_value_id ?? s.value_id) : null;
    }
  }

  const head = await req()
    .input('c', sql.Int, complexId)
    .input('obs', sql.Date, input.observedAt)
    .input('src', sql.VarChar(10), input.source)
    .input('sup', sql.BigInt, supersedesId ?? null)
    .input('memo', sql.NVarChar(1000), input.memo ?? null).query(`
      INSERT dbo.snapshot (complex_id, observed_at, source, master_rev_id, supersedes_id, memo)
      OUTPUT inserted.snapshot_id
      VALUES (@c, @obs, @src,
              (SELECT rev_id FROM dbo.master_revision WHERE complex_id = @c AND status = 'CURRENT'),
              @sup, @memo)`);
  const snapshotId = Number(head.recordset[0].snapshot_id);

  for (const p of prepared) {
    await req()
      .input('s', sql.BigInt, snapshotId)
      .input('f', sql.VarChar(40), p.d.field_cd)
      .input('a', sql.Int, p.areaTypeId)
      .input('n', sql.Decimal(18, 4), p.cols.num)
      .input('t', sql.NVarChar(4000), p.cols.text)
      .input('dt', sql.Date, p.cols.date)
      .input('cf', sql.BigInt, p.carriedFromValueId)
      .query(`INSERT dbo.snapshot_value (snapshot_id, field_cd, area_type_id, num_val, text_val, date_val, carried_from_value_id)
              VALUES (@s, @f, @a, @n, @t, @dt, @cf)`);
  }

  // 소요시간 (복사값 검증 동일)
  const cIds = input.commutes.map((c) => c.carriedFromCommuteId).filter(Boolean);
  const cSrc = new Map();
  if (cIds.length) {
    const r = req();
    const names = cIds.map((id, i) => (r.input(`m${i}`, sql.BigInt, id), `@m${i}`));
    for (const x of (
      await r.input('c', sql.Int, complexId).query(`
        SELECT cm.* FROM dbo.commute cm JOIN dbo.snapshot s ON s.snapshot_id = cm.snapshot_id
        WHERE cm.commute_id IN (${names.join(',')}) AND s.complex_id = @c`)
    ).recordset)
      cSrc.set(Number(x.commute_id), x);
  }
  const seenC = new Set();
  for (const c of input.commutes) {
    const k = `${c.anchorId}|${c.mode}`;
    if (seenC.has(k)) throw new AppError('VALIDATION', '같은 기준점·이동수단 소요시간이 중복되었습니다', 400);
    seenC.add(k);
    const s = c.carriedFromCommuteId ? cSrc.get(c.carriedFromCommuteId) : null;
    const carried =
      s && s.anchor_id === c.anchorId && s.mode === c.mode && s.minutes === c.minutes && (s.transfers ?? null) === (c.transfers ?? null)
        ? Number(s.carried_from_commute_id ?? s.commute_id)
        : null;
    await req()
      .input('s', sql.BigInt, snapshotId)
      .input('an', sql.Int, c.anchorId)
      .input('mo', sql.VarChar(10), c.mode)
      .input('mi', sql.SmallInt, c.minutes)
      .input('tr', sql.TinyInt, c.transfers ?? null)
      .input('rd', sql.NVarChar(300), c.routeDesc ?? null)
      .input('sg', sql.SmallInt, c.suggestedMinutes ?? null)
      .input('cf', sql.BigInt, carried)
      .query(`INSERT dbo.commute (snapshot_id, anchor_id, mode, minutes, transfers, route_desc, suggested_minutes, carried_from_commute_id)
              VALUES (@s, @an, @mo, @mi, @tr, @rd, @sg, @cf)`);
  }
  return snapshotId;
}

export async function createSnapshot(pool, complexId, body) {
  const input = parseInput(body);
  return withTransaction(pool, async (_tx, req) => {
    await requireComplex(req, complexId);
    const meta = await loadMeta(req);
    const snapshotId = await insertSnapshot(req, meta, complexId, input, null);
    return { snapshotId };
  });
}

async function requireActiveSnapshot(req, snapshotId) {
  const r = await req()
    .input('s', sql.BigInt, snapshotId)
    .query(`SELECT s.snapshot_id, s.complex_id, v.snapshot_id AS voided
            FROM dbo.snapshot s LEFT JOIN dbo.snapshot_void v ON v.snapshot_id = s.snapshot_id
            WHERE s.snapshot_id = @s`);
  const row = r.recordset[0];
  if (!row) throw new AppError('NOT_FOUND', '스냅샷을 찾을 수 없습니다', 404);
  if (row.voided) throw new AppError('CONFLICT', '이미 무효화된 스냅샷입니다', 409);
  return row;
}

/** 정정본 생성 + 원본 무효화 (한 트랜잭션) */
export async function correctSnapshot(pool, snapshotId, body) {
  const reason = String(body?.reason ?? '').trim() || '정정';
  const input = parseInput(body);
  return withTransaction(pool, async (_tx, req) => {
    const orig = await requireActiveSnapshot(req, snapshotId);
    const meta = await loadMeta(req);
    const newId = await insertSnapshot(req, meta, orig.complex_id, input, snapshotId);
    await req()
      .input('s', sql.BigInt, snapshotId)
      .input('r', sql.NVarChar(500), reason.slice(0, 500))
      .input('n', sql.BigInt, newId)
      .query('INSERT dbo.snapshot_void (snapshot_id, reason, replaced_by_snapshot_id) VALUES (@s, @r, @n)');
    return { snapshotId: newId, supersedes: snapshotId };
  });
}

export async function voidSnapshot(pool, snapshotId, body) {
  const reason = String(body?.reason ?? '').trim();
  if (!reason) throw new AppError('VALIDATION', '무효화 사유를 입력하세요', 400);
  return withTransaction(pool, async (_tx, req) => {
    await requireActiveSnapshot(req, snapshotId);
    await req()
      .input('s', sql.BigInt, snapshotId)
      .input('r', sql.NVarChar(500), reason.slice(0, 500))
      .query('INSERT dbo.snapshot_void (snapshot_id, reason) VALUES (@s, @r)');
    return { snapshotId, voided: true };
  });
}

// ── 조회 ───────────────────────────────────────────────
export async function listSnapshots(pool, complexId, { includeVoid = false } = {}) {
  const r = await pool
    .request()
    .input('c', sql.Int, complexId)
    .input('iv', sql.Bit, includeVoid).query(`
      SELECT s.snapshot_id, s.observed_at, s.input_at, s.source, s.supersedes_id, s.memo,
             v.voided_at, v.reason AS void_reason, v.replaced_by_snapshot_id,
             (SELECT COUNT(*) FROM dbo.snapshot_value x WHERE x.snapshot_id = s.snapshot_id AND x.carried_from_value_id IS NULL) AS observed_cnt,
             (SELECT COUNT(*) FROM dbo.snapshot_value x WHERE x.snapshot_id = s.snapshot_id AND x.carried_from_value_id IS NOT NULL) AS carried_cnt
      FROM dbo.snapshot s
      LEFT JOIN dbo.snapshot_void v ON v.snapshot_id = s.snapshot_id
      WHERE s.complex_id = @c AND (@iv = 1 OR v.snapshot_id IS NULL)
      ORDER BY s.observed_at DESC, s.snapshot_id DESC`);
  return r.recordset.map((x) => ({
    snapshotId: Number(x.snapshot_id),
    observedAt: ymd(x.observed_at),
    inputAt: x.input_at,
    source: x.source,
    supersedesId: x.supersedes_id == null ? null : Number(x.supersedes_id),
    memo: x.memo,
    voided: x.voided_at != null,
    voidReason: x.void_reason,
    replacedBy: x.replaced_by_snapshot_id == null ? null : Number(x.replaced_by_snapshot_id),
    observedCnt: x.observed_cnt,
    carriedCnt: x.carried_cnt,
  }));
}

export async function getSnapshot(pool, snapshotId) {
  const head = (
    await pool
      .request()
      .input('s', sql.BigInt, snapshotId)
      .query(`SELECT s.*, v.voided_at, v.reason AS void_reason FROM dbo.snapshot s
              LEFT JOIN dbo.snapshot_void v ON v.snapshot_id = s.snapshot_id WHERE s.snapshot_id = @s`)
  ).recordset[0];
  if (!head) throw new AppError('NOT_FOUND', '스냅샷을 찾을 수 없습니다', 404);
  const meta = await loadMeta(pool);
  const vals = (
    await pool
      .request()
      .input('s', sql.BigInt, snapshotId)
      .query(`SELECT sv.*, COALESCE(os.observed_at, s.observed_at) AS eff_observed_at
              FROM dbo.snapshot_value sv
              JOIN dbo.snapshot s ON s.snapshot_id = sv.snapshot_id
              LEFT JOIN dbo.snapshot_value ov ON ov.value_id = sv.carried_from_value_id
              LEFT JOIN dbo.snapshot os ON os.snapshot_id = ov.snapshot_id
              WHERE sv.snapshot_id = @s`)
  ).recordset;
  const commutes = (
    await pool.request().input('s', sql.BigInt, snapshotId).query('SELECT * FROM dbo.commute WHERE snapshot_id = @s')
  ).recordset;
  return {
    snapshotId: Number(head.snapshot_id),
    complexId: head.complex_id,
    observedAt: ymd(head.observed_at),
    source: head.source,
    memo: head.memo,
    supersedesId: head.supersedes_id == null ? null : Number(head.supersedes_id),
    masterRevId: head.master_rev_id,
    voided: head.voided_at != null,
    voidReason: head.void_reason,
    values: vals
      .filter((v) => meta.defMap.has(v.field_cd))
      .map((v) => ({
        valueId: Number(v.value_id),
        fieldCd: v.field_cd,
        areaTypeId: v.area_type_id,
        value: fromColumns(meta.defMap.get(v.field_cd), v),
        carried: v.carried_from_value_id != null,
        carriedFromValueId: v.carried_from_value_id == null ? null : Number(v.carried_from_value_id),
        effObservedAt: ymd(v.eff_observed_at),
      })),
    commutes: commutes.map((c) => ({
      commuteId: Number(c.commute_id),
      anchorId: c.anchor_id,
      mode: c.mode,
      minutes: c.minutes,
      transfers: c.transfers,
      routeDesc: c.route_desc,
      suggestedMinutes: c.suggested_minutes,
      carried: c.carried_from_commute_id != null,
    })),
  };
}

/** 직전 실제 관측값 대비 증감 (복사값은 '미확인'으로 따로 표시) */
export async function getDiff(pool, snapshotId) {
  const snap = await getSnapshot(pool, snapshotId);
  const meta = await loadMeta(pool);
  const req = () => pool.request().input('s', sql.BigInt, snapshotId);
  const numRows = (await req().query('SELECT * FROM dbo.v_snapshot_diff WHERE snapshot_id = @s')).recordset;
  const textRows = (await req().query('SELECT * FROM dbo.v_snapshot_text_diff WHERE snapshot_id = @s')).recordset;
  const label = (cd) => meta.defMap.get(cd)?.label ?? cd;
  return {
    snapshotId,
    observedAt: snap.observedAt,
    numeric: numRows.map((r) => ({
      fieldCd: r.field_cd,
      label: label(r.field_cd),
      areaTypeId: r.area_type_id,
      value: num(r.num_val),
      prevValue: num(r.prev_val),
      prevAt: ymd(r.prev_at),
      delta: num(r.delta),
      deltaPct: r.delta_pct == null ? null : Math.round(Number(r.delta_pct) * 10) / 10,
      better: meta.defMap.get(r.field_cd)?.better ?? 'NONE',
    })),
    changed: textRows
      .filter((r) => r.changed)
      .map((r) => ({ fieldCd: r.field_cd, label: label(r.field_cd), areaTypeId: r.area_type_id, value: r.val, prevValue: r.prev_val, prevAt: ymd(r.prev_at) })),
    unconfirmed: snap.values.filter((v) => v.carried).map((v) => ({ fieldCd: v.fieldCd, label: label(v.fieldCd), areaTypeId: v.areaTypeId, effObservedAt: v.effObservedAt })),
  };
}

/** 차트·이력용 시계열 — 실제 관측값만 (수치·텍스트·enum 모두) */
export async function getSeries(pool, complexId, fields) {
  if (!fields.length) return [];
  const meta = await loadMeta(pool);
  const r = pool.request().input('c', sql.Int, complexId);
  const names = fields.map((f, i) => (r.input(`f${i}`, sql.VarChar(40), f), `@f${i}`));
  const rows = (
    await r.query(`SELECT field_cd, area_type_id, observed_at, num_val, text_val, date_val, snapshot_id
                   FROM dbo.v_snapshot_value_eff
                   WHERE complex_id = @c AND is_carried = 0 AND field_cd IN (${names.join(',')})
                   ORDER BY observed_at, snapshot_id`)
  ).recordset;
  return rows
    .filter((x) => meta.defMap.has(x.field_cd))
    .map((x) => ({
      fieldCd: x.field_cd,
      areaTypeId: x.area_type_id,
      observedAt: ymd(x.observed_at),
      value: fromColumns(meta.defMap.get(x.field_cd), x),
      snapshotId: Number(x.snapshot_id),
    }));
}

/** 소요시간 이력 (실제 관측값만) */
export async function getCommuteSeries(pool, complexId) {
  const rows = (
    await pool
      .request()
      .input('c', sql.Int, complexId)
      .query(`SELECT s.observed_at, s.snapshot_id, cm.anchor_id, cm.mode, cm.minutes, cm.transfers, cm.suggested_minutes
              FROM dbo.v_snapshot_active s JOIN dbo.commute cm ON cm.snapshot_id = s.snapshot_id
              WHERE s.complex_id = @c AND cm.carried_from_commute_id IS NULL
              ORDER BY s.observed_at, s.snapshot_id`)
  ).recordset;
  return rows.map((x) => ({
    observedAt: ymd(x.observed_at),
    snapshotId: Number(x.snapshot_id),
    anchorId: x.anchor_id,
    mode: x.mode,
    minutes: x.minutes,
    transfers: x.transfers,
    suggestedMinutes: x.suggested_minutes,
  }));
}
