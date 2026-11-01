// 기준일 비교 (계획서 §4.3, §7.2) — 요약 패널(1개)과 비교 패널(2~4개)이 함께 쓴다.
// 각 값은 기준일(asOf) 이전 가장 최근 스냅샷 값 + 실효 관측일(복사값은 원 관측일)을 함께 반환한다.
import { sql } from '../db/pool.js';
import { ymd, num } from '../db/tx.js';
import { AppError } from '../util/errors.js';
import { haversineKm } from '../util/geo.js';
import { loadMeta, defToDto } from './SnapshotService.js';
import { fromColumns } from './fieldValues.js';
import { getSettings } from './SettingService.js';

export const MAX_COMPARE = 4;

/**
 * @param {number[]} ids
 * @param {{ asOf?: string, areas?: Map<number, number> }} opts  areas: complexId → areaTypeId (없으면 대표 평형)
 */
export async function compare(pool, ids, { asOf, areas = new Map() } = {}) {
  if (!ids.length || ids.length > MAX_COMPARE) throw new AppError('VALIDATION', `단지는 1~${MAX_COMPARE}개`, 400);
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const asOfYmd = asOf ?? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const meta = await loadMeta(pool);
  const settings = await getSettings(pool, ['budget_man', 'stale_days', 'weight.traffic', 'weight.env', 'weight.edu', 'weight.price', 'area_match_tolerance_m2']);
  const tol = Number(settings.area_match_tolerance_m2 ?? 0.5);

  const r = pool.request().input('asOf', sql.Date, asOfYmd).input('tol', sql.Decimal(5, 2), tol);
  const idList = ids.map((id, i) => (r.input(`c${i}`, sql.Int, id), `@c${i}`)).join(',');
  // 평형 지정: (complex, area) 쌍을 VALUES 로 넘김
  const areaPairs = ids
    .filter((id) => areas.has(id))
    .map((id, i) => (r.input(`ac${i}`, sql.Int, id), r.input(`aa${i}`, sql.Int, areas.get(id)), `(@ac${i}, @aa${i})`));
  const areaSrc = areaPairs.length
    ? `(SELECT x.cid, x.aid FROM (VALUES ${areaPairs.join(',')}) AS x(cid, aid))`
    : '(SELECT CAST(NULL AS int) AS cid, CAST(NULL AS int) AS aid WHERE 1 = 0)';

  const pickCte = `WITH pick AS (
      SELECT c.complex_id,
             COALESCE((SELECT a2.area_type_id FROM dbo.area_type a2 JOIN ${areaSrc} s ON s.aid = a2.area_type_id
                       WHERE s.cid = c.complex_id AND a2.complex_id = c.complex_id),
                      (SELECT a3.area_type_id FROM dbo.area_type a3 WHERE a3.complex_id = c.complex_id AND a3.is_primary = 1)) AS area_type_id
      FROM dbo.complex c WHERE c.complex_id IN (${idList})
    )`;
  const base = await r.query(`
    ${pickCte}
    SELECT p.complex_id, p.area_type_id, f.field_cd,
           x.num_val, x.text_val, x.date_val, x.eff_observed_at, x.is_carried, x.observed_at
    FROM pick p
    CROSS JOIN dbo.field_def f
    OUTER APPLY (SELECT TOP (1) v.num_val, v.text_val, v.date_val, v.eff_observed_at, v.is_carried, v.observed_at
                 FROM dbo.v_snapshot_value_eff v
                 WHERE v.complex_id = p.complex_id AND v.field_cd = f.field_cd AND v.observed_at <= @asOf
                   AND ((f.scope = 'COMPLEX' AND v.area_type_id IS NULL) OR (f.scope = 'AREA' AND v.area_type_id = p.area_type_id))
                 ORDER BY v.observed_at DESC, v.snapshot_id DESC) x
    WHERE f.active = 1;

    SELECT c.complex_id, c.display_nm, c.status, c.is_favorite, c.lat, c.lng, c.sigungu_cd, rg.sgg_nm,
           m.use_apr_day, m.hhld_cnt, m.dong_cnt, m.max_floor, m.hall_type, m.far_ratio, m.bc_ratio, m.builder,
           a.area_type_id, a.label AS area_label, a.excl_m2, a.rooms, a.baths
    FROM dbo.complex c
    LEFT JOIN dbo.region rg ON rg.sigungu_cd = c.sigungu_cd
    LEFT JOIN dbo.master_revision m ON m.complex_id = c.complex_id AND m.status = 'CURRENT'
    LEFT JOIN dbo.area_type a ON a.complex_id = c.complex_id
    WHERE c.complex_id IN (${idList})
    ORDER BY c.complex_id, a.is_primary DESC, a.sort;

    SELECT s.complex_id, cm.anchor_id, cm.mode, cm.minutes, cm.transfers, cm.route_desc,
           COALESCE(os.observed_at, s.observed_at) AS eff_observed_at, CAST(CASE WHEN cm.carried_from_commute_id IS NULL THEN 0 ELSE 1 END AS bit) AS is_carried
    FROM (SELECT complex_id, MAX(observed_at) AS last_at FROM dbo.v_snapshot_active
          WHERE complex_id IN (${idList}) AND observed_at <= @asOf GROUP BY complex_id) l
    CROSS APPLY (SELECT TOP (1) sa.snapshot_id, sa.complex_id, sa.observed_at FROM dbo.v_snapshot_active sa
                 WHERE sa.complex_id = l.complex_id AND sa.observed_at = l.last_at ORDER BY sa.snapshot_id DESC) s
    JOIN dbo.commute cm ON cm.snapshot_id = s.snapshot_id
    LEFT JOIN dbo.commute oc ON oc.commute_id = cm.carried_from_commute_id
    LEFT JOIN dbo.snapshot os ON os.snapshot_id = oc.snapshot_id;

    SELECT anchor_id, name, kind, lat, lng FROM dbo.anchor WHERE active = 1 ORDER BY sort;

    SELECT v.complex_id, v.area_type_id, v.observed_at, v.num_val
    FROM dbo.v_snapshot_value_eff v
    WHERE v.complex_id IN (${idList}) AND v.field_cd = 'price_ask' AND v.is_carried = 0 AND v.observed_at <= @asOf
    ORDER BY v.observed_at;

    SELECT x.complex_id, x.area_type_id, x.delta, x.delta_pct, x.prev_at
    FROM dbo.v_snapshot_diff x
    WHERE x.complex_id IN (${idList}) AND x.field_cd = 'price_ask' AND x.observed_at <= @asOf
      AND x.snapshot_id = (SELECT TOP (1) y.snapshot_id FROM dbo.v_snapshot_diff y
                           WHERE y.complex_id = x.complex_id AND y.field_cd = 'price_ask'
                             AND y.area_type_id = x.area_type_id AND y.observed_at <= @asOf
                           ORDER BY y.observed_at DESC, y.snapshot_id DESC);

    -- 수집된 실거래 중 기준일 이전 최신 정상 거래 (선택 평형 ±오차). 스냅샷에 기록한 실거래가 없을 때 쓰는 값
    ${pickCte}
    SELECT p.complex_id, t.deal_date, t.amount_man, t.floor
    FROM pick p
    JOIN dbo.area_type a ON a.area_type_id = p.area_type_id
    CROSS APPLY (SELECT TOP (1) t.deal_date, t.amount_man, t.floor FROM dbo.trade t
                 WHERE t.complex_id = p.complex_id AND t.cancel_flag = 0 AND t.deal_date <= @asOf AND ABS(t.excl_m2 - a.excl_m2) <= @tol
                 ORDER BY t.deal_date DESC, t.trade_id DESC) t;`);

  const [valueRows, headRows, commuteRows, anchorRows, seriesRows, deltaRows, tradeRows] = base.recordsets;
  const budget = settings.budget_man == null || settings.budget_man === '' ? null : Number(settings.budget_man);
  const anchors = anchorRows.map((a) => ({ anchorId: a.anchor_id, name: a.name, kind: a.kind, lat: num(a.lat), lng: num(a.lng) }));

  const items = ids
    .map((id) => {
      const heads = headRows.filter((h) => h.complex_id === id);
      if (!heads.length) return null;
      const h = heads[0];
      const vals = valueRows.filter((v) => v.complex_id === id);
      const areaTypeId = vals[0]?.area_type_id ?? null;
      const values = {};
      for (const v of vals) {
        const def = meta.defMap.get(v.field_cd);
        if (!def || v.eff_observed_at == null) continue;
        values[v.field_cd] = { value: fromColumns(def, v), observedAt: ymd(v.eff_observed_at), carried: !!v.is_carried };
      }
      const ask = values.price_ask?.value ?? null;
      const tr = tradeRows.find((x) => x.complex_id === id);
      const trade = tr ? { dealDate: ymd(tr.deal_date), amountMan: tr.amount_man, floor: tr.floor } : null;
      // 괴리율 기준: 스냅샷에 기록한 실거래(내가 확인한 값) 우선, 없으면 수집된 실거래
      const lastTrade = values.price_last_trade?.value ?? trade?.amountMan ?? null;
      const delta = deltaRows.find((x) => x.complex_id === id && x.area_type_id === areaTypeId);
      const pos = h.lat != null ? { lat: Number(h.lat), lng: Number(h.lng) } : null;
      return {
        complexId: id,
        displayNm: h.display_nm,
        status: h.status,
        isFavorite: !!h.is_favorite,
        sggNm: h.sgg_nm,
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
        master: {
          useAprDay: ymd(h.use_apr_day),
          hhldCnt: h.hhld_cnt,
          dongCnt: h.dong_cnt,
          maxFloor: h.max_floor,
          hallType: h.hall_type,
          farRatio: num(h.far_ratio),
          bcRatio: num(h.bc_ratio),
          builder: h.builder,
        },
        areaTypes: heads
          .filter((x) => x.area_type_id != null)
          .map((x) => ({ areaTypeId: x.area_type_id, label: x.area_label, exclM2: num(x.excl_m2), rooms: x.rooms, baths: x.baths })),
        areaTypeId,
        values,
        trade,
        derived: {
          gapPct: ask != null && lastTrade ? Math.round(((ask - lastTrade) / lastTrade) * 1000) / 10 : null,
          gapBase: ask == null || !lastTrade ? null : values.price_last_trade?.value != null ? 'SNAPSHOT' : 'TRADE',
          budgetDiff: ask != null && budget != null ? ask - budget : null,
          askDelta: delta ? num(delta.delta) : null,
          askDeltaPrevAt: delta ? ymd(delta.prev_at) : null,
        },
        commutes: commuteRows
          .filter((c) => c.complex_id === id)
          .map((c) => ({
            anchorId: c.anchor_id,
            mode: c.mode,
            minutes: c.minutes,
            transfers: c.transfers,
            routeDesc: c.route_desc,
            observedAt: ymd(c.eff_observed_at),
            carried: !!c.is_carried,
          })),
        distances: pos ? anchors.filter((a) => a.lat != null).map((a) => ({ anchorId: a.anchorId, km: haversineKm(pos, a) })) : [],
        askSeries: seriesRows
          .filter((s) => s.complex_id === id && s.area_type_id === areaTypeId)
          .map((s) => ({ observedAt: ymd(s.observed_at), value: Number(s.num_val) })),
      };
    })
    .filter(Boolean);

  if (items.length !== ids.length) throw new AppError('NOT_FOUND', '없는 단지가 포함되어 있습니다', 404);

  return {
    asOf: asOfYmd,
    staleDays: Number(settings.stale_days ?? 30),
    budgetMan: budget,
    weights: Object.fromEntries(Object.entries(settings).filter(([k]) => k.startsWith('weight.'))),
    fields: meta.defs.map(defToDto),
    enums: meta.enums.map((e) => ({ fieldCd: e.field_cd, code: e.code, label: e.label, ord: e.ord })),
    anchors,
    items,
  };
}
