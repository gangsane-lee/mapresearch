import { Router } from 'express';
import { usage } from '../external/quota.js';

export function quotaRouter({ getPool }) {
  const r = Router();
  r.get('/', async (_req, res) => {
    res.json({ items: await usage(await getPool()) });
  });
  return r;
}
