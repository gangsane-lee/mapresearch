// 마스터 리비전·비교 기록·설정·기준점
import { Router } from 'express';
import { acceptRevision, rejectRevision } from '../services/MasterService.js';
import { createComparison, listComparisons } from '../services/ComparisonService.js';
import { listEditableSettings, updateSettings, listAnchors, upsertAnchor } from '../services/SettingService.js';
import { searchSchools, upsertSchool, upsertStat, schoolStats } from '../services/SchoolService.js';
import { idParam } from './params.js';
import { listCalendar, createVisit, patchVisit } from '../services/VisitService.js';
import { listRedevRefs, linkRedevRef } from '../services/RedevService.js';

export function redevRouter({ getPool }) {
  const r = Router();
  r.get('/', async (req, res) => res.json({ items: await listRedevRefs(await getPool(), idParam(req.query.complexId), String(req.query.q ?? '')) }));
  r.patch('/:id', async (req, res) => {
    const c = req.body?.complexId;
    res.json(await linkRedevRef(await getPool(), idParam(req.params.id), c == null ? null : idParam(c)));
  });
  return r;
}

export function visitsRouter({ getPool }) {
  const r = Router();
  r.get('/', async (req, res) => res.json(await listCalendar(await getPool(), String(req.query.from ?? ''), String(req.query.to ?? ''))));
  r.post('/', async (req, res) => res.status(201).json(await createVisit(await getPool(), req.body)));
  r.patch('/:id', async (req, res) => res.json(await patchVisit(await getPool(), idParam(req.params.id), req.body)));
  return r;
}

export function schoolsRouter({ getPool }) {
  const r = Router();
  r.get('/', async (req, res) => res.json({ items: await searchSchools(await getPool(), String(req.query.q ?? '')) }));
  r.post('/', async (req, res) => res.status(201).json(await upsertSchool(await getPool(), null, req.body)));
  r.put('/:id', async (req, res) => res.json(await upsertSchool(await getPool(), idParam(req.params.id), req.body)));
  r.get('/:id/stats', async (req, res) => res.json({ items: await schoolStats(await getPool(), idParam(req.params.id)) }));
  r.put('/:id/stats', async (req, res) => res.json(await upsertStat(await getPool(), idParam(req.params.id), req.body)));
  return r;
}

export function masterRevisionsRouter({ getPool }) {
  const r = Router();
  r.post('/:id/accept', async (req, res) => res.json(await acceptRevision(await getPool(), idParam(req.params.id))));
  r.post('/:id/reject', async (req, res) => res.json(await rejectRevision(await getPool(), idParam(req.params.id))));
  return r;
}

export function comparisonsRouter({ getPool }) {
  const r = Router();
  r.get('/', async (_req, res) => res.json({ items: await listComparisons(await getPool()) }));
  r.post('/', async (req, res) => res.status(201).json(await createComparison(await getPool(), req.body)));
  return r;
}

export function settingsRouter({ getPool }) {
  const r = Router();
  r.get('/', async (_req, res) => res.json(await listEditableSettings(await getPool())));
  r.put('/', async (req, res) => res.json(await updateSettings(await getPool(), req.body)));
  return r;
}

export function anchorsRouter({ getPool }) {
  const r = Router();
  r.get('/', async (_req, res) => res.json({ items: await listAnchors(await getPool()) }));
  r.post('/', async (req, res) => res.status(201).json(await upsertAnchor(await getPool(), null, req.body)));
  r.put('/:id', async (req, res) => res.json(await upsertAnchor(await getPool(), idParam(req.params.id), req.body)));
  return r;
}
