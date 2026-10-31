import { Router } from 'express';
import { getSnapshot, correctSnapshot, voidSnapshot, getDiff } from '../services/SnapshotService.js';
import { idParam } from './params.js';

export function snapshotsRouter({ getPool }) {
  const r = Router();
  r.get('/:id', async (req, res) => {
    res.json(await getSnapshot(await getPool(), idParam(req.params.id)));
  });
  r.get('/:id/diff', async (req, res) => {
    res.json(await getDiff(await getPool(), idParam(req.params.id)));
  });
  r.post('/:id/correct', async (req, res) => {
    res.status(201).json(await correctSnapshot(await getPool(), idParam(req.params.id), req.body));
  });
  r.post('/:id/void', async (req, res) => {
    res.json(await voidSnapshot(await getPool(), idParam(req.params.id), req.body));
  });
  return r;
}
