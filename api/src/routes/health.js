import { Router } from 'express';

export function healthRouter({ getPool }) {
  const r = Router();
  r.get('/', async (_req, res) => {
    try {
      const pool = await getPool();
      const q = await pool
        .request()
        .query('SELECT DB_NAME() AS db, (SELECT MAX(version) FROM dbo.schema_version) AS schema_version');
      res.json({ ok: true, db: q.recordset[0].db, schemaVersion: q.recordset[0].schema_version });
    } catch (err) {
      res.status(503).json({ ok: false, error: { code: 'DB_UNAVAILABLE', message: err.message } });
    }
  });
  return r;
}
