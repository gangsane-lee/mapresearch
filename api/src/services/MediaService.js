// 사진·캡처 (계획서 §8): 원본 + webp 썸네일(긴 변 480px)은 파일시스템, DB에는 상대 경로·메타데이터만
//   경로: {MEDIA_ROOT}\{complex_id}\{yyyyMM}\{uuid}.{ext}, 썸네일 {MEDIA_ROOT}\thumb\{uuid}.webp
//   sha256 중복 업로드 차단, EXIF 촬영일과 같은 날 스냅샷 연결 제안
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import exifr from 'exifr';
import { sql } from '../db/pool.js';
import { ymd, num } from '../db/tx.js';
import { AppError } from '../util/errors.js';

export const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };
export const KINDS = ['PHOTO', 'PRICE_CAPTURE', 'MAP_CAPTURE', 'OTHER'];
export const LIMITS = { fileSize: 30 * 1024 * 1024, files: 20 };

const pad = (n) => String(n).padStart(2, '0');

/** 저장 상대 경로 (DB 기록용, 구분자는 '/') */
export function relPaths(complexId, when, uuid, ext) {
  const ym = `${when.getFullYear()}${pad(when.getMonth() + 1)}`;
  return { rel: `${complexId}/${ym}/${uuid}.${ext}`, thumb: `thumb/${uuid}.webp` };
}

/** 상대 경로 → 절대 경로. MEDIA_ROOT 밖으로 나가면 거부 (경로 조작 차단) */
export function safeResolve(mediaRoot, rel) {
  const root = path.resolve(mediaRoot);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new AppError('FORBIDDEN', '잘못된 경로', 403);
  return abs;
}

/**
 * 이미지 검증·메타 추출·썸네일 생성 (파일 쓰기 전 단계, 테스트 대상)
 * @returns {Promise<{sha256, ext, mime, w, h, takenAt:Date|null, gps:{lat,lng}|null, thumb:Buffer}>}
 */
export async function inspectImage(buffer, mime) {
  const ext = MIME_EXT[mime];
  if (!ext) throw new AppError('VALIDATION', `지원하지 않는 형식: ${mime} (jpg/png/webp/heic)`, 400);
  let meta;
  try {
    meta = await sharp(buffer).metadata(); // 실제 디코딩 가능한 이미지인지 확인
  } catch {
    throw new AppError('VALIDATION', '이미지를 읽을 수 없습니다', 400);
  }
  const thumb = await sharp(buffer).rotate().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  let takenAt = null;
  let gps = null;
  try {
    const ex = await exifr.parse(buffer, { pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude'], gps: true });
    takenAt = ex?.DateTimeOriginal ?? ex?.CreateDate ?? null;
    if (ex?.latitude != null && ex?.longitude != null) gps = { lat: ex.latitude, lng: ex.longitude };
  } catch {
    /* EXIF 없음 */
  }
  const rotated = (meta.orientation ?? 1) >= 5; // 90° 회전 사진은 가로·세로 교환
  return {
    sha256: createHash('sha256').update(buffer).digest('hex'),
    ext,
    mime,
    w: rotated ? meta.height : meta.width,
    h: rotated ? meta.width : meta.height,
    takenAt: takenAt instanceof Date && !Number.isNaN(takenAt.getTime()) ? takenAt : null,
    gps,
    thumb,
  };
}

/**
 * 업로드 1건 저장. 중복이면 DUPLICATE(409, 기존 media_id 포함).
 * @param {{complexId:number, snapshotId?:number|null, kind:string, caption?:string|null}} meta
 */
export async function saveUpload(pool, mediaRoot, file, meta) {
  if (!KINDS.includes(meta.kind)) throw new AppError('VALIDATION', `kind: ${KINDS.join('/')}`, 400);
  const info = await inspectImage(file.buffer, file.mimetype);

  const dup = await pool.request().input('h', sql.Char(64), info.sha256).query('SELECT media_id FROM dbo.media WHERE sha256 = @h');
  if (dup.recordset.length) {
    const e = new AppError('DUPLICATE', `이미 업로드된 파일입니다 (#${dup.recordset[0].media_id})`, 409);
    e.mediaId = Number(dup.recordset[0].media_id);
    throw e;
  }
  if (meta.snapshotId != null) {
    const s = await pool
      .request()
      .input('s', sql.BigInt, meta.snapshotId)
      .input('c', sql.Int, meta.complexId)
      .query('SELECT 1 AS ok FROM dbo.snapshot WHERE snapshot_id = @s AND complex_id = @c');
    if (!s.recordset.length) throw new AppError('VALIDATION', '이 단지의 스냅샷이 아닙니다', 400);
  }

  const uuid = randomUUID();
  const { rel, thumb } = relPaths(meta.complexId, info.takenAt ?? new Date(), uuid, info.ext);
  const absRel = safeResolve(mediaRoot, rel);
  const absThumb = safeResolve(mediaRoot, thumb);
  await mkdir(path.dirname(absRel), { recursive: true });
  await mkdir(path.dirname(absThumb), { recursive: true });
  await writeFile(absRel, file.buffer, { flag: 'wx' });
  await writeFile(absThumb, info.thumb, { flag: 'wx' });

  const origName = Buffer.from(file.originalname ?? '', 'latin1').toString('utf8').slice(0, 260) || null; // multer는 latin1로 넘김
  const r = await pool
    .request()
    .input('c', sql.Int, meta.complexId)
    .input('s', sql.BigInt, meta.snapshotId ?? null)
    .input('k', sql.VarChar(15), meta.kind)
    .input('rp', sql.NVarChar(260), rel)
    .input('tp', sql.NVarChar(260), thumb)
    .input('on', sql.NVarChar(260), origName)
    .input('h', sql.Char(64), info.sha256)
    .input('m', sql.VarChar(50), info.mime)
    .input('b', sql.BigInt, file.buffer.length)
    .input('w', sql.Int, info.w ?? null)
    .input('hh', sql.Int, info.h ?? null)
    .input('t', sql.DateTime2(0), info.takenAt)
    .input('la', sql.Decimal(9, 6), info.gps?.lat ?? null)
    .input('ln', sql.Decimal(9, 6), info.gps?.lng ?? null)
    .input('cap', sql.NVarChar(500), meta.caption ?? null).query(`
      INSERT dbo.media (complex_id, snapshot_id, kind, rel_path, thumb_path, orig_name, sha256, mime, bytes, w, h, taken_at, gps_lat, gps_lng, caption)
      OUTPUT inserted.media_id
      VALUES (@c, @s, @k, @rp, @tp, @on, @h, @m, @b, @w, @hh, @t, @la, @ln, @cap)`);
  const mediaId = Number(r.recordset[0].media_id);

  // 스냅샷 미지정 + 촬영일이 있으면 같은 날 스냅샷 연결 제안
  let suggestedSnapshotId = null;
  if (meta.snapshotId == null && info.takenAt) {
    const s = await pool
      .request()
      .input('c', sql.Int, meta.complexId)
      .input('d', sql.Date, ymd(info.takenAt))
      .query('SELECT TOP (1) snapshot_id FROM dbo.v_snapshot_active WHERE complex_id = @c AND observed_at = @d ORDER BY snapshot_id DESC');
    suggestedSnapshotId = s.recordset[0] ? Number(s.recordset[0].snapshot_id) : null;
  }
  return { mediaId, sha256: info.sha256, takenAt: info.takenAt, suggestedSnapshotId };
}

export async function listMedia(pool, complexId) {
  const r = await pool
    .request()
    .input('c', sql.Int, complexId)
    .query(`SELECT m.media_id, m.snapshot_id, m.kind, m.orig_name, m.mime, m.bytes, m.w, m.h, m.taken_at, m.gps_lat, m.gps_lng, m.caption, m.created_at,
                   s.observed_at
            FROM dbo.media m LEFT JOIN dbo.snapshot s ON s.snapshot_id = m.snapshot_id
            WHERE m.complex_id = @c ORDER BY COALESCE(m.taken_at, m.created_at) DESC`);
  return r.recordset.map((m) => ({
    mediaId: Number(m.media_id),
    snapshotId: m.snapshot_id == null ? null : Number(m.snapshot_id),
    snapshotObservedAt: ymd(m.observed_at),
    kind: m.kind,
    origName: m.orig_name,
    mime: m.mime,
    bytes: Number(m.bytes),
    w: m.w,
    h: m.h,
    takenAt: m.taken_at,
    gps: m.gps_lat == null ? null : { lat: num(m.gps_lat), lng: num(m.gps_lng) },
    caption: m.caption,
    createdAt: m.created_at,
    url: `/media/${Number(m.media_id)}`,
    thumbUrl: `/media/${Number(m.media_id)}/thumb`,
  }));
}

export async function patchMedia(pool, mediaId, { snapshotId, caption }) {
  const r = pool.request().input('id', sql.BigInt, mediaId);
  const sets = [];
  if (snapshotId !== undefined) {
    r.input('s', sql.BigInt, snapshotId);
    sets.push(`snapshot_id = CASE WHEN @s IS NULL OR EXISTS (SELECT 1 FROM dbo.snapshot x JOIN dbo.media y ON y.complex_id = x.complex_id
                                       WHERE x.snapshot_id = @s AND y.media_id = @id) THEN @s ELSE snapshot_id END`);
  }
  if (caption !== undefined) {
    r.input('cap', sql.NVarChar(500), caption);
    sets.push('caption = @cap');
  }
  if (!sets.length) throw new AppError('VALIDATION', '변경할 값이 없습니다', 400);
  const u = await r.query(`UPDATE dbo.media SET ${sets.join(', ')} WHERE media_id = @id`);
  if (!u.rowsAffected[0]) throw new AppError('NOT_FOUND', '사진을 찾을 수 없습니다', 404);
  return { mediaId };
}

/** 파일 스트리밍용 경로 조회 */
export async function mediaFile(pool, mediaRoot, mediaId, { thumb = false } = {}) {
  const r = await pool.request().input('id', sql.BigInt, mediaId).query('SELECT rel_path, thumb_path, mime FROM dbo.media WHERE media_id = @id');
  const m = r.recordset[0];
  if (!m) throw new AppError('NOT_FOUND', '사진을 찾을 수 없습니다', 404);
  const rel = thumb ? m.thumb_path : m.rel_path;
  return { abs: safeResolve(mediaRoot, rel), mime: thumb ? 'image/webp' : m.mime };
}
