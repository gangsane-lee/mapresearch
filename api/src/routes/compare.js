import { Router } from 'express';
import { compare, MAX_COMPARE } from '../services/CompareService.js';
import { idParam } from './params.js';
import { AppError } from '../util/errors.js';

/** GET /api/compare?ids=1,2&asOf=2026-10-01&areas=1:3,2:5 */
export function compareRouter({ getPool }) {
  const r = Router();
  r.get('/', async (req, res) => {
    const ids = [...new Set(String(req.query.ids ?? '').split(',').filter(Boolean).map(idParam))];
    if (!ids.length || ids.length > MAX_COMPARE) throw new AppError('VALIDATION', `ids는 1~${MAX_COMPARE}개`, 400);
    const asOf = req.query.asOf;
    if (asOf != null && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new AppError('VALIDATION', 'asOf 는 YYYY-MM-DD', 400);
    const areas = new Map();
    for (const pair of String(req.query.areas ?? '').split(',').filter(Boolean)) {
      const [c, a] = pair.split(':');
      areas.set(idParam(c), idParam(a));
    }
    res.json(await compare(await getPool(), ids, { asOf, areas }));
  });
  return r;
}
