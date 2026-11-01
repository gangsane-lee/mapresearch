// 단지 조회 (화면 경로 — 외부 API 호출 금지, 로컬 DB만)
import { computeFlags } from '../util/flags.js';

/** 지도 마커·요약 패널용 전체 단지 요약 (앱 시작 시 1회) */
export async function listSummary(pool) {
  const r = await pool.request().query(`
    DECLARE @tol decimal(5,2) = COALESCE(TRY_CAST((SELECT setting_val FROM dbo.setting WHERE setting_key = 'area_match_tolerance_m2') AS decimal(5,2)), 0.5);
    DECLARE @gap decimal(6,2) = COALESCE(TRY_CAST((SELECT setting_val FROM dbo.setting WHERE setting_key = 'flag_gap_pct') AS decimal(6,2)), -5);
    SELECT @gap AS flag_gap_pct;
    SELECT c.complex_id, c.display_nm, c.sigungu_cd, c.lat, c.lng, c.status, c.is_favorite,
           a.area_type_id, a.label AS area_label, a.excl_m2 AS area_excl_m2,
           p.num_val AS price_ask, p.eff_observed_at AS price_ask_observed_at, p.is_carried AS price_ask_carried,
           d.delta AS price_ask_delta,
           ls.last_observed_at,
           tg.tags,
           t1.amount_man AS last_trade_man, t1.deal_date AS last_trade_date,
           t2.amount_man AS prev_trade_man, t2.deal_date AS prev_trade_date,
           m.use_apr_day, m.hhld_cnt, rg.sgg_nm, rg.city_nm
    FROM dbo.complex c
    LEFT JOIN dbo.master_revision m ON m.complex_id = c.complex_id AND m.status = 'CURRENT'
    LEFT JOIN dbo.region rg ON rg.sigungu_cd = c.sigungu_cd
    LEFT JOIN dbo.area_type a ON a.complex_id = c.complex_id AND a.is_primary = 1
    OUTER APPLY (SELECT TOP (1) tr.amount_man, tr.deal_date, tr.trade_id FROM dbo.trade tr
                 WHERE tr.complex_id = c.complex_id AND tr.cancel_flag = 0 AND ABS(tr.excl_m2 - a.excl_m2) <= @tol
                 ORDER BY tr.deal_date DESC, tr.trade_id DESC) t1
    OUTER APPLY (SELECT TOP (1) tr.amount_man, tr.deal_date FROM dbo.trade tr
                 WHERE tr.complex_id = c.complex_id AND tr.cancel_flag = 0 AND ABS(tr.excl_m2 - a.excl_m2) <= @tol
                   AND (tr.deal_date < t1.deal_date OR (tr.deal_date = t1.deal_date AND tr.trade_id < t1.trade_id))
                 ORDER BY tr.deal_date DESC, tr.trade_id DESC) t2
    OUTER APPLY (SELECT TOP (1) v.num_val, v.eff_observed_at, v.is_carried
                 FROM dbo.v_snapshot_value_eff v
                 WHERE v.complex_id = c.complex_id AND v.field_cd = 'price_ask' AND v.area_type_id = a.area_type_id
                 ORDER BY v.observed_at DESC, v.snapshot_id DESC) p
    OUTER APPLY (SELECT TOP (1) x.delta
                 FROM dbo.v_snapshot_diff x
                 WHERE x.complex_id = c.complex_id AND x.field_cd = 'price_ask' AND x.area_type_id = a.area_type_id
                 ORDER BY x.observed_at DESC, x.snapshot_id DESC) d
    OUTER APPLY (SELECT MAX(s.observed_at) AS last_observed_at
                 FROM dbo.v_snapshot_active s WHERE s.complex_id = c.complex_id) ls
    OUTER APPLY (SELECT STRING_AGG(t.tag, N'|') WITHIN GROUP (ORDER BY t.tag) AS tags
                 FROM dbo.complex_tag t WHERE t.complex_id = c.complex_id) tg
    ORDER BY c.display_nm;`);
  const gapPct = Number(r.recordsets[0][0].flag_gap_pct);
  return r.recordsets[1].map((row) => toSummary(row, gapPct));
}

const num = (v) => (v == null ? null : Number(v));
const ymd = (d) => (d == null ? null : d instanceof Date ? localYmd(d) : String(d).slice(0, 10));
const pad = (n) => String(n).padStart(2, '0');
const localYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function toSummary(row, gapThresholdPct = -5) {
  const lastTrade = row.last_trade_man == null ? null : { amountMan: row.last_trade_man, dealDate: ymd(row.last_trade_date) };
  const prevTrade = row.prev_trade_man == null ? null : { amountMan: row.prev_trade_man, dealDate: ymd(row.prev_trade_date) };
  return {
    lastTrade,
    flags: computeFlags({ priceAsk: num(row.price_ask), lastTrade, prevTrade }, gapThresholdPct),
    complexId: row.complex_id,
    displayNm: row.display_nm,
    sigunguCd: row.sigungu_cd,
    lat: num(row.lat),
    lng: num(row.lng),
    status: row.status,
    isFavorite: !!row.is_favorite,
    areaTypeId: row.area_type_id ?? null,
    areaLabel: row.area_label ?? null,
    areaExclM2: num(row.area_excl_m2),
    priceAsk: num(row.price_ask),
    priceAskObservedAt: ymd(row.price_ask_observed_at),
    priceAskCarried: !!row.price_ask_carried,
    priceAskDelta: num(row.price_ask_delta),
    lastObservedAt: ymd(row.last_observed_at),
    tags: row.tags ? row.tags.split('|') : [],
    useAprDay: ymd(row.use_apr_day),
    hhldCnt: row.hhld_cnt ?? null,
    sggNm: row.sgg_nm ? [row.city_nm, row.sgg_nm].filter(Boolean).join(' ') : null,
  };
}
