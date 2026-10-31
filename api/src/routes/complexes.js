import { Router } from 'express';
import { listSummary } from '../services/ComplexService.js';
import { createManual, patchComplex, getComplex } from '../services/ComplexWriteService.js';
import { listSnapshots, getDraft, createSnapshot, getSeries, getCommuteSeries } from '../services/SnapshotService.js';
import { listTrades } from '../services/TradeService.js';
import { revisionDiff } from '../services/MasterService.js';
import { complexSchools, assignSchool } from '../services/SchoolService.js';
import { idParam } from './params.js';
import { AppError } from '../util/errors.js';

export function complexesRouter({ getPool }) {
  const r = Router();

  r.get('/summary', async (_req, res) => {
    res.json({ items: await listSummary(await getPool()) });
  });

  r.post('/manual', async (req, res) => {
    res.status(201).json(await createManual(await getPool(), req.body));
  });

  r.get('/:id', async (req, res) => {
    res.json(await getComplex(await getPool(), idParam(req.params.id)));
  });

  r.patch('/:id', async (req, res) => {
    res.json(await patchComplex(await getPool(), idParam(req.params.id), req.body));
  });

  r.get('/:id/snapshots', async (req, res) => {
    const includeVoid = req.query.includeVoid === '1';
    res.json({ items: await listSnapshots(await getPool(), idParam(req.params.id), { includeVoid }) });
  });

  r.get('/:id/snapshots/draft', async (req, res) => {
    const observedAt = req.query.observedAt;
    if (observedAt != null && !/^\d{4}-\d{2}-\d{2}$/.test(observedAt)) {
      throw new AppError('VALIDATION', 'observedAt 은 YYYY-MM-DD 형식', 400);
    }
    res.json(await getDraft(await getPool(), idParam(req.params.id), observedAt));
  });

  r.post('/:id/snapshots', async (req, res) => {
    res.status(201).json(await createSnapshot(await getPool(), idParam(req.params.id), req.body));
  });

  r.get('/:id/series', async (req, res) => {
    const fields = String(req.query.fields ?? '')
      .split(',')
      .map((f) => f.trim())
      .filter((f) => /^[a-z0-9_]{1,40}$/.test(f));
    if (!fields.length) throw new AppError('VALIDATION', 'fields 파라미터가 필요합니다', 400);
    res.json({ items: await getSeries(await getPool(), idParam(req.params.id), fields.slice(0, 20)) });
  });

  r.get('/:id/commutes', async (req, res) => {
    res.json({ items: await getCommuteSeries(await getPool(), idParam(req.params.id)) });
  });

  r.get('/:id/trades', async (req, res) => {
    const from = req.query.from;
    if (from != null && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new AppError('VALIDATION', 'from 은 YYYY-MM-DD', 400);
    res.json(await listTrades(await getPool(), idParam(req.params.id), { from }));
  });

  r.get('/:id/schools', async (req, res) => {
    res.json({ items: await complexSchools(await getPool(), idParam(req.params.id)) });
  });

  r.post('/:id/schools', async (req, res) => {
    res.status(201).json(await assignSchool(await getPool(), idParam(req.params.id), req.body));
  });

  r.get('/:id/master-diff', async (req, res) => {
    res.json(await revisionDiff(await getPool(), idParam(req.params.id)));
  });

  return r;
}
