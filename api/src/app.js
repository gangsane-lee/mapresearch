// Express 앱: /api/* REST + 빌드된 SPA 정적 서빙 (포트 하나로 운영)
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './util/errors.js';
import { requireToken } from './middleware/auth.js';
import { healthRouter } from './routes/health.js';
import { quotaRouter } from './routes/quota.js';
import { publicConfigRouter } from './routes/publicConfig.js';
import { complexesRouter } from './routes/complexes.js';
import { snapshotsRouter } from './routes/snapshots.js';
import { compareRouter } from './routes/compare.js';
import { masterRevisionsRouter, comparisonsRouter, settingsRouter, anchorsRouter, schoolsRouter, visitsRouter, redevRouter } from './routes/misc.js';
import { backupRouter } from './routes/backup.js';
import { mediaApiRouter, mediaFileRouter } from './routes/media.js';

const defaultWebDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

/**
 * @param {object} deps
 * @param {object} deps.config   loadConfig() 결과
 * @param {() => Promise<import('mssql').ConnectionPool>} deps.getPool  DB 풀 (지연 연결)
 * @param {string} [deps.webDist] 빌드된 SPA 경로
 */
export function createApp({ config, getPool, webDist = defaultWebDist }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  if (config.apiToken) {
    const auth = requireToken(config.apiToken);
    app.use('/api', auth);
    app.use('/media', auth);
  }

  app.use('/api/health', healthRouter({ getPool }));
  app.use('/api/quota', quotaRouter({ getPool }));
  app.use('/api/public-config', publicConfigRouter({ config, getPool }));
  app.use('/api/complexes', complexesRouter({ getPool }));
  app.use('/api/snapshots', snapshotsRouter({ getPool }));
  app.use('/api/compare', compareRouter({ getPool }));
  app.use('/api/master-revisions', masterRevisionsRouter({ getPool }));
  app.use('/api/comparisons', comparisonsRouter({ getPool }));
  app.use('/api/settings', settingsRouter({ getPool }));
  app.use('/api/anchors', anchorsRouter({ getPool }));
  app.use('/api/backup', backupRouter({ config }));
  app.use('/api/schools', schoolsRouter({ getPool }));
  app.use('/api/visits', visitsRouter({ getPool }));
  app.use('/api/redev-refs', redevRouter({ getPool }));
  app.use('/api/media', mediaApiRouter({ getPool, config }));
  app.use('/media', mediaFileRouter({ getPool, config }));

  app.use('/api', (_req, _res, next) => next(new AppError('NOT_FOUND', '없는 API입니다', 404)));

  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    // Express 5 (path-to-regexp v8) 와일드카드 문법
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    if (err.name === 'ConnectionError') {
      return res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB에 연결할 수 없습니다' } });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'BAD_JSON', message: 'JSON 형식 오류' } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL', message: '서버 오류' } });
  });

  return app;
}
