// 단지 식별정보(kapt_ref) 검색·등록 초안 (계획서 §5.4 — K-apt 목록 API 대신 한국부동산원 CSV)
// 로컬 DB만 조회한다. 평형 후보는 이미 수집된 실거래 면적으로 만든 제안값 — 사용자가 확정해야 저장된다.
import { sql } from '../db/pool.js';
import { ymd } from '../db/tx.js';
import { clusterAreas } from '../util/trade.js';
import { m2ToPyeong } from '../util/unit.js';
import { getSettings } from './SettingService.js';
import { AppError } from '../util/errors.js';

const row = (k) => ({
  danjiId: k.danji_id,
  name: k.nm_price ?? k.nm_bld ?? k.nm_road ?? k.addr,
  nmPrice: k.nm_price,
  nmBld: k.nm_bld,
  nmRoad: k.nm_road,
  sigunguCd: k.sigungu_cd,
  bjdCd: k.bjd_cd,
  umdNm: k.umd_nm,
  jibun: k.jibun,
  addr: k.addr,
  roadAddr: k.road_addr,
  kind: k.danji_kind,
  dongCnt: k.dong_cnt,
  hhldCnt: k.hhld_cnt,
  useAprDay: ymd(k.use_apr_day),
  baseDate: ymd(k.base_date),
  complexId: k.complex_id ?? null, // 이미 등록된 단지
});

const SELECT = `SELECT TOP (@top) k.*, x.complex_id FROM dbo.kapt_ref k
  LEFT JOIN dbo.complex_ext_id x ON x.source = 'KAPT' AND x.ext_id = k.danji_id AND x.valid_to IS NULL`;

/** 이름·주소 검색 (공백으로 나눈 단어 모두 포함). 아파트(단지종류 1)만 기본 */
export async function searchKapt(pool, { q, sigunguCd, kind = 1, top = 30 }) {
  const words = String(q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 4);
  if (!words.length && !sigunguCd) throw new AppError('VALIDATION', '검색어 또는 시군구가 필요합니다', 400);
  const req = pool.request().input('top', sql.Int, Math.min(top, 100));
  const where = [];
  words.forEach((w, i) => {
    req.input(`w${i}`, sql.NVarChar(102), `%${w.replace(/[%_[]/g, '[$&]')}%`);
    where.push(`(k.nm_price LIKE @w${i} OR k.nm_bld LIKE @w${i} OR k.nm_road LIKE @w${i} OR k.addr LIKE @w${i} OR k.road_addr LIKE @w${i})`);
  });
  if (sigunguCd) {
    if (!/^\d{5}$/.test(sigunguCd)) throw new AppError('VALIDATION', 'sigunguCd 는 5자리', 400);
    req.input('g', sql.Char(5), sigunguCd);
    where.push('k.sigungu_cd = @g');
  }
  if (kind != null) {
    req.input('kind', sql.TinyInt, kind);
    where.push('k.danji_kind = @kind');
  }
  const r = await req.query(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY k.hhld_cnt DESC, k.danji_id`);
  return r.recordset.map(row);
}

export async function getKapt(pool, danjiId) {
  if (!/^\d{14}$/.test(danjiId ?? '')) throw new AppError('VALIDATION', '단지고유번호는 14자리', 400);
  const r = await pool.request().input('top', sql.Int, 1).input('k', sql.Char(14), danjiId).query(`${SELECT} WHERE k.danji_id = @k`);
  if (!r.recordset.length) throw new AppError('NOT_FOUND', '없는 단지입니다', 404);
  return row(r.recordset[0]);
}

const MATCH = { 1: 'EXACT', 2: 'SAME_BON', 3: 'NAME', 4: 'NEARBY' };

/**
 * 역지오코딩 결과(법정동코드·지번·건물명) → 단지 식별정보 후보 (로컬 DB만).
 * 단지 식별정보의 필지는 대표 필지 하나뿐이라, 정확히 같은 지번이 없으면 같은 본번 → 건물명 → 본번 ±5 순으로 넓힌다.
 * 후보마다 같은 필지의 최근 매매 실거래 1건을 붙인다 (거래 단지명이 이 단지 이름이거나 필지에 단지명이 하나뿐일 때).
 */
export async function kaptAt(pool, { bjdCd, jibun, buildingNm = null, top = 5 }) {
  if (!/^\d{10}$/.test(bjdCd ?? '')) return [];
  const bon = jibun && /^\d+/.test(jibun) ? Number(jibun.split('-')[0]) : null;
  const r = await pool
    .request()
    .input('top', sql.Int, top)
    .input('b', sql.Char(10), bjdCd)
    .input('j', sql.NVarChar(30), jibun)
    .input('bon', sql.NVarChar(30), bon == null ? null : String(bon))
    .input('bonLike', sql.NVarChar(31), bon == null ? null : `${bon}-%`)
    .input('bonN', sql.Int, bon)
    .input('bn', sql.NVarChar(100), buildingNm).query(`
      WITH c AS (
        SELECT k.*, TRY_CAST(LEFT(k.jibun, CHARINDEX('-', k.jibun + '-') - 1) AS int) AS k_bon
        FROM dbo.kapt_ref k WHERE k.bjd_cd = @b AND k.danji_kind = 1),
      m AS (
        SELECT c.*, CASE
          WHEN c.jibun = @j THEN 1
          WHEN c.jibun = @bon OR c.jibun LIKE @bonLike THEN 2
          WHEN @bn IS NOT NULL AND EXISTS (SELECT 1 FROM (VALUES (c.nm_price), (c.nm_bld), (c.nm_road)) n(v)
                                           WHERE LEN(n.v) >= 2 AND @bn LIKE N'%' + n.v + N'%') THEN 3
          WHEN @bonN IS NOT NULL AND ABS(c.k_bon - @bonN) <= 5 THEN 4 END AS match_rank
        FROM c)
      SELECT TOP (@top) m.*, x.complex_id, lt.amount_man AS last_trade_man, lt.deal_date AS last_trade_date,
             lt.excl_m2 AS last_trade_m2, tc.trade_cnt
      FROM m
      LEFT JOIN dbo.complex_ext_id x ON x.source = 'KAPT' AND x.ext_id = m.danji_id AND x.valid_to IS NULL
      OUTER APPLY (SELECT COUNT(DISTINCT t.apt_nm) AS nm_cnt FROM dbo.trade t WHERE t.bjd_cd = m.bjd_cd AND t.jibun = m.jibun) nc
      OUTER APPLY (SELECT TOP (1) t.amount_man, t.deal_date, t.excl_m2 FROM dbo.trade t
                   WHERE t.bjd_cd = m.bjd_cd AND t.jibun = m.jibun AND t.cancel_flag = 0
                     AND (nc.nm_cnt = 1 OR t.apt_nm IN (m.nm_price, m.nm_bld, m.nm_road))
                   ORDER BY t.deal_date DESC, t.trade_id DESC) lt
      OUTER APPLY (SELECT COUNT(*) AS trade_cnt FROM dbo.trade t
                   WHERE t.bjd_cd = m.bjd_cd AND t.jibun = m.jibun AND t.cancel_flag = 0
                     AND (nc.nm_cnt = 1 OR t.apt_nm IN (m.nm_price, m.nm_bld, m.nm_road))) tc
      WHERE m.match_rank IS NOT NULL
      ORDER BY m.match_rank, ABS(ISNULL(m.k_bon, 0) - ISNULL(@bonN, 0)), m.hhld_cnt DESC`);
  return r.recordset.map((k) => ({
    ...row(k),
    match: MATCH[k.match_rank],
    lastTrade: k.last_trade_man == null ? null : { amountMan: k.last_trade_man, dealDate: ymd(k.last_trade_date), exclM2: Number(k.last_trade_m2) },
    tradeCnt: k.trade_cnt ?? 0,
  }));
}

/**
 * 등록 초안: 마스터(사용승인일·세대수·동수) + 같은 필지 실거래 면적으로 만든 평형 후보.
 * 실거래가 아직 없으면 areaCandidates 가 비어 있다 → 실거래 동기화 후 다시 조회하거나 직접 입력.
 */
export async function kaptDraft(pool, danjiId) {
  const k = await getKapt(pool, danjiId);
  const tol = Number((await getSettings(pool, ['area_match_tolerance_m2'])).area_match_tolerance_m2 ?? 0.5);
  const areas = (
    await pool
      .request()
      .input('b', sql.Char(10), k.bjdCd)
      .input('j', sql.NVarChar(30), k.jibun)
      .input('n1', sql.NVarChar(100), k.nmPrice)
      .input('n2', sql.NVarChar(100), k.nmBld)
      .input('n3', sql.NVarChar(100), k.nmRoad)
      // 한 필지에 단지가 여럿이면 거래 단지명이 이 단지 이름인 것만 (TradeSyncService.linkTrades 와 같은 규칙)
      .query(`WITH a AS (
                SELECT excl_m2, apt_nm FROM dbo.trade WHERE bjd_cd = @b AND jibun = @j AND cancel_flag = 0
                UNION ALL SELECT excl_m2, apt_nm FROM dbo.trade_rent WHERE bjd_cd = @b AND jibun = @j)
              SELECT excl_m2, COUNT(*) AS n FROM a
              WHERE (SELECT COUNT(DISTINCT apt_nm) FROM a) = 1 OR apt_nm IN (@n1, @n2, @n3)
              GROUP BY excl_m2`)
  ).recordset;
  const expanded = areas.flatMap((a) => Array(a.n).fill(Number(a.excl_m2)));
  const tradeCnt = expanded.length;
  const areaCandidates = clusterAreas(expanded, tol).map((g) => ({
    exclM2: g.exclM2,
    label: `${Math.round(m2ToPyeong(g.exclM2 * 1.33))}평`, // 공급면적 미상 → 전용×1.33 근사 (라벨 제안일 뿐, 사용자가 수정)
    count: g.count,
  }));
  return {
    kapt: k,
    tradeCnt,
    areaCandidates,
    body: {
      displayNm: k.name,
      sigunguCd: k.sigunguCd,
      bjdCd: k.bjdCd,
      jibun: k.jibun,
      jibunAddr: k.addr,
      roadAddr: k.roadAddr,
      kaptDanjiId: k.danjiId,
      master: { useAprDay: k.useAprDay, hhldCnt: k.hhldCnt, dongCnt: k.dongCnt },
    },
  };
}
