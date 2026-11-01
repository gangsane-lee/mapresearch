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
