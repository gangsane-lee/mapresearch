import { Router } from 'express';
import multer from 'multer';
import { saveUpload, listMedia, patchMedia, mediaFile, MIME_EXT, LIMITS } from '../services/MediaService.js';
import { idParam } from './params.js';
import { AppError } from '../util/errors.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.fileSize, files: LIMITS.files, fields: 10 },
  fileFilter: (_req, file, cb) =>
    MIME_EXT[file.mimetype] ? cb(null, true) : cb(new AppError('VALIDATION', `지원하지 않는 형식: ${file.mimetype}`, 400)),
});

function uploadMiddleware(req, res, next) {
  upload.array('files', LIMITS.files)(req, res, (err) => {
    if (!err) return next();
    if (err instanceof AppError) return next(err);
    const msg = err.code === 'LIMIT_FILE_SIZE' ? '파일당 30MB 이하' : err.code === 'LIMIT_FILE_COUNT' ? `한 번에 ${LIMITS.files}개 이하` : err.message;
    next(new AppError('VALIDATION', msg, 400));
  });
}

/** /api/media — 업로드·목록·수정 */
export function mediaApiRouter({ getPool, config }) {
  const r = Router();
  r.post('/', uploadMiddleware, async (req, res) => {
    const complexId = idParam(req.body.complexId);
    const snapshotId = req.body.snapshotId ? idParam(req.body.snapshotId) : null;
    const kind = String(req.body.kind ?? 'PHOTO');
    const caption = req.body.caption ? String(req.body.caption).slice(0, 500) : null;
    if (!req.files?.length) throw new AppError('VALIDATION', '파일이 없습니다', 400);
    const pool = await getPool();
    const results = [];
    for (const f of req.files) {
      try {
        results.push({ ok: true, name: Buffer.from(f.originalname, 'latin1').toString('utf8'), ...(await saveUpload(pool, config.mediaRoot, f, { complexId, snapshotId, kind, caption })) });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        results.push({ ok: false, name: Buffer.from(f.originalname, 'latin1').toString('utf8'), code: err.code, message: err.message, mediaId: err.mediaId ?? null });
      }
    }
    res.status(results.some((x) => x.ok) ? 201 : 400).json({ items: results });
  });
  r.get('/', async (req, res) => {
    res.json({ items: await listMedia(await getPool(), idParam(req.query.complexId)) });
  });
  r.patch('/:id', async (req, res) => {
    const body = req.body ?? {};
    const snapshotId = body.snapshotId === undefined ? undefined : body.snapshotId === null ? null : idParam(body.snapshotId);
    const caption = body.caption === undefined ? undefined : body.caption === null ? null : String(body.caption).slice(0, 500);
    res.json(await patchMedia(await getPool(), idParam(req.params.id), { snapshotId, caption }));
  });
  return r;
}

/** /media/:id, /media/:id/thumb — 파일 */
export function mediaFileRouter({ getPool, config }) {
  const r = Router();
  const send = (thumb) => async (req, res) => {
    const f = await mediaFile(await getPool(), config.mediaRoot, idParam(req.params.id), { thumb });
    res.type(f.mime);
    res.set('Cache-Control', 'private, max-age=86400, immutable');
    res.sendFile(f.abs, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: { code: 'NOT_FOUND', message: '파일이 없습니다' } });
    });
  };
  r.get('/:id', send(false));
  r.get('/:id/thumb', send(true));
  return r;
}
