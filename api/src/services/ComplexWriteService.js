// 단지 수동 등록·수정 (계획서 §5.4 9번: K-apt 미가입 단지 / API 키 발급 전 경로)
// 공공 API 연동 등록(§5.4 1~8)은 응답 필드 확인(U1~U3) 후 RegistrationService 로 추가한다.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { sql } from '../db/pool.js';
import { withTransaction, ymd, num } from '../db/tx.js';
import { AppError } from '../util/errors.js';

const lat = z.number().min(33).max(39);
const lng = z.number().min(124).max(132);
const STATUS = ['INTEREST', 'VISIT_PLANNED', 'VISITED', 'CANDIDATE', 'ON_HOLD', 'EXCLUDED'];

const masterInput = z.object({
  useAprDay: z.iso.date().nullish(),
  hhldCnt: z.number().int().positive().nullish(),
  dongCnt: z.number().int().positive().nullish(),
  maxFloor: z.number().int().positive().nullish(),
  builder: z.string().max(100).nullish(),
  heatType: z.string().max(50).nullish(),
  hallType: z.string().max(50).nullish(),
  farRatio: z.number().min(0).max(2000).nullish(),
  bcRatio: z.number().min(0).max(100).nullish(),
  platArea: z.number().min(0).nullish(),
  parkCnt: z.number().int().min(0).nullish(),
});

const areaInput = z.object({
  label: z.string().min(1).max(20),
  exclM2: z.number().positive().max(500),
  supplyM2: z.number().positive().max(700).nullish(),
  rooms: z.number().int().min(0).max(10).nullish(),
  baths: z.number().int().min(0).max(10).nullish(),
  hhldCnt: z.number().int().min(0).nullish(),
  isPrimary: z.boolean().default(false),
});

export const manualInput = z.object({
  displayNm: z.string().min(1).max(100),
  sigunguCd: z.string().regex(/^\d{5}$/),
  bjdCd: z.string().regex(/^\d{10}$/).nullish(),
  jibunAddr: z.string().max(200).nullish(),
  roadAddr: z.string().max(200).nullish(),
  lat,
  lng,
  status: z.enum(STATUS).default('INTEREST'),
  tags: z.array(z.string().min(1).max(30)).max(20).default([]),
  areaTypes: z.array(areaInput).min(1).max(20),
  master: masterInput.default({}),
});

export const patchInput = z
  .object({
    displayNm: z.string().min(1).max(100),
    lat,
    lng,
    status: z.enum(STATUS),
    tags: z.array(z.string().min(1).max(30)).max(20),
  })
  .partial()
  .refine((v) => (v.lat == null) === (v.lng == null), '핀 좌표는 lat/lng를 함께 보내야 합니다');

function parse(schema, body) {
  const r = schema.safeParse(body);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new AppError('VALIDATION', `${i.path.join('.') || '입력'}: ${i.message}`, 400);
  }
  return r.data;
}

export function masterHash(m) {
  const keys = Object.keys(m).sort();
  return createHash('sha256').update(JSON.stringify(keys.map((k) => [k, m[k] ?? null]))).digest('hex');
}

async function replaceTags(req, complexId, tags) {
  await req().input('c', sql.Int, complexId).query('DELETE dbo.complex_tag WHERE complex_id = @c');
  for (const t of [...new Set(tags.map((x) => x.trim()).filter(Boolean))]) {
    await req().input('c', sql.Int, complexId).input('t', sql.NVarChar(30), t).query('INSERT dbo.complex_tag (complex_id, tag) VALUES (@c, @t)');
  }
}

export async function createManual(pool, body) {
  const v = parse(manualInput, body);
  const primaries = v.areaTypes.filter((a) => a.isPrimary).length;
  if (primaries > 1) throw new AppError('VALIDATION', '대표 평형은 하나만 지정할 수 있습니다', 400);
  if (primaries === 0) v.areaTypes[0].isPrimary = true;

  return withTransaction(pool, async (_tx, req) => {
    const region = await req().input('g', sql.Char(5), v.sigunguCd).query('SELECT 1 AS ok FROM dbo.region WHERE sigungu_cd = @g');
    if (!region.recordset.length) throw new AppError('VALIDATION', `등록되지 않은 시군구 코드: ${v.sigunguCd} (geo:build 후 migrate)`, 400);

    const c = await req()
      .input('n', sql.NVarChar(100), v.displayNm)
      .input('g', sql.Char(5), v.sigunguCd)
      .input('b', sql.Char(10), v.bjdCd ?? null)
      .input('j', sql.NVarChar(200), v.jibunAddr ?? null)
      .input('r', sql.NVarChar(200), v.roadAddr ?? null)
      .input('la', sql.Decimal(9, 6), v.lat)
      .input('ln', sql.Decimal(9, 6), v.lng)
      .input('st', sql.VarChar(20), v.status).query(`
        INSERT dbo.complex (display_nm, sigungu_cd, bjd_cd, jibun_addr, road_addr, lat, lng, status)
        OUTPUT inserted.complex_id VALUES (@n, @g, @b, @j, @r, @la, @ln, @st)`);
    const complexId = c.recordset[0].complex_id;

    let sort = 0;
    for (const a of v.areaTypes) {
      await req()
        .input('c', sql.Int, complexId)
        .input('l', sql.NVarChar(20), a.label)
        .input('e', sql.Decimal(7, 2), a.exclM2)
        .input('s', sql.Decimal(7, 2), a.supplyM2 ?? null)
        .input('ro', sql.TinyInt, a.rooms ?? null)
        .input('ba', sql.TinyInt, a.baths ?? null)
        .input('h', sql.Int, a.hhldCnt ?? null)
        .input('p', sql.Bit, a.isPrimary)
        .input('o', sql.Int, sort++).query(`
          INSERT dbo.area_type (complex_id, label, excl_m2, supply_m2, rooms, baths, hhld_cnt, is_primary, sort)
          VALUES (@c, @l, @e, @s, @ro, @ba, @h, @p, @o)`);
    }

    const m = v.master;
    await req()
      .input('c', sql.Int, complexId)
      .input('ua', sql.Date, m.useAprDay ?? null)
      .input('hh', sql.Int, m.hhldCnt ?? null)
      .input('dc', sql.Int, m.dongCnt ?? null)
      .input('mf', sql.Int, m.maxFloor ?? null)
      .input('bu', sql.NVarChar(100), m.builder ?? null)
      .input('he', sql.NVarChar(50), m.heatType ?? null)
      .input('ha', sql.NVarChar(50), m.hallType ?? null)
      .input('fr', sql.Decimal(7, 2), m.farRatio ?? null)
      .input('br', sql.Decimal(7, 2), m.bcRatio ?? null)
      .input('pa', sql.Decimal(14, 2), m.platArea ?? null)
      .input('pk', sql.Int, m.parkCnt ?? null)
      .input('raw', sql.NVarChar(sql.MAX), JSON.stringify({ source: 'MANUAL', master: m }))
      .input('hash', sql.Char(64), masterHash(m)).query(`
        INSERT dbo.master_revision (complex_id, status, use_apr_day, hhld_cnt, dong_cnt, max_floor, builder, heat_type, hall_type,
                                    far_ratio, bc_ratio, plat_area, park_cnt, raw_json, payload_hash, fetched_at, decided_at)
        VALUES (@c, 'CURRENT', @ua, @hh, @dc, @mf, @bu, @he, @ha, @fr, @br, @pa, @pk, @raw, @hash, SYSDATETIME(), SYSDATETIME())`);

    await replaceTags(req, complexId, v.tags);
    return { complexId };
  });
}

export async function patchComplex(pool, complexId, body) {
  const v = parse(patchInput, body);
  return withTransaction(pool, async (_tx, req) => {
    const r = req().input('c', sql.Int, complexId);
    const sets = ['updated_at = SYSDATETIME()'];
    if (v.displayNm != null) (r.input('n', sql.NVarChar(100), v.displayNm), sets.push('display_nm = @n'));
    if (v.lat != null) (r.input('la', sql.Decimal(9, 6), v.lat), r.input('ln', sql.Decimal(9, 6), v.lng), sets.push('lat = @la', 'lng = @ln'));
    if (v.status != null) (r.input('st', sql.VarChar(20), v.status), sets.push('status = @st'));
    const u = await r.query(`UPDATE dbo.complex SET ${sets.join(', ')} WHERE complex_id = @c`);
    if (!u.rowsAffected[0]) throw new AppError('NOT_FOUND', '단지를 찾을 수 없습니다', 404);
    if (v.tags) await replaceTags(req, complexId, v.tags);
    return { complexId };
  });
}

export async function getComplex(pool, complexId) {
  const req = () => pool.request().input('c', sql.Int, complexId);
  const c = (await req().query('SELECT * FROM dbo.complex WHERE complex_id = @c')).recordset[0];
  if (!c) throw new AppError('NOT_FOUND', '단지를 찾을 수 없습니다', 404);
  const areas = (await req().query('SELECT * FROM dbo.area_type WHERE complex_id = @c ORDER BY is_primary DESC, sort')).recordset;
  const tags = (await req().query('SELECT tag FROM dbo.complex_tag WHERE complex_id = @c ORDER BY tag')).recordset.map((t) => t.tag);
  const revs = (
    await req().query(`SELECT rev_id, status, use_apr_day, hhld_cnt, dong_cnt, max_floor, builder, heat_type, hall_type,
                              far_ratio, bc_ratio, plat_area, park_cnt, fetched_at, decided_at
                       FROM dbo.master_revision WHERE complex_id = @c ORDER BY rev_id DESC`)
  ).recordset.map((m) => ({
    revId: m.rev_id,
    status: m.status,
    useAprDay: ymd(m.use_apr_day),
    hhldCnt: m.hhld_cnt,
    dongCnt: m.dong_cnt,
    maxFloor: m.max_floor,
    builder: m.builder,
    heatType: m.heat_type,
    hallType: m.hall_type,
    farRatio: num(m.far_ratio),
    bcRatio: num(m.bc_ratio),
    platArea: num(m.plat_area),
    parkCnt: m.park_cnt,
    fetchedAt: m.fetched_at,
    decidedAt: m.decided_at,
  }));
  const ext = (await req().query('SELECT source, ext_id, valid_from, valid_to FROM dbo.complex_ext_id WHERE complex_id = @c')).recordset;
  return {
    complexId: c.complex_id,
    displayNm: c.display_nm,
    sigunguCd: c.sigungu_cd,
    bjdCd: c.bjd_cd,
    jibunAddr: c.jibun_addr,
    roadAddr: c.road_addr,
    lat: num(c.lat),
    lng: num(c.lng),
    status: c.status,
    createdAt: c.created_at,
    tags,
    areaTypes: areas.map((a) => ({
      areaTypeId: a.area_type_id,
      label: a.label,
      exclM2: num(a.excl_m2),
      supplyM2: num(a.supply_m2),
      rooms: a.rooms,
      baths: a.baths,
      hhldCnt: a.hhld_cnt,
      isPrimary: !!a.is_primary,
    })),
    master: revs.find((r) => r.status === 'CURRENT') ?? null,
    pendingRevision: revs.find((r) => r.status === 'PENDING') ?? null,
    revisions: revs,
    externalIds: ext.map((e) => ({ source: e.source, extId: e.ext_id, validFrom: ymd(e.valid_from), validTo: ymd(e.valid_to) })),
  };
}
