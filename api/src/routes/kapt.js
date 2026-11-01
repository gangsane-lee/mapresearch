import { Router } from 'express';
import { searchKapt, kaptDraft } from '../services/KaptService.js';
import { syncTrades } from '../services/TradeSyncService.js';
import { AppError } from '../util/errors.js';

/** 단지 식별정보 검색 (로컬 DB) */
export function kaptRouter({ getPool }) {
  const r = Router();
  r.get('/search', async (req, res) => {
    const kind = req.query.kind === 'all' ? null : Number(req.query.kind ?? 1);
    res.json({ items: await searchKapt(await getPool(), { q: req.query.q, sigunguCd: req.query.sigunguCd || null, kind }) });
  });
  r.get('/:danjiId/draft', async (req, res) => {
    res.json(await kaptDraft(await getPool(), req.params.danjiId));
  });
  return r;
}

/** 수동 동기화 (외부 API 호출 — 등록·동기화 경로에서만 허용) */
export function syncRouter({ getPool, config }) {
  const r = Router();
  r.post('/trades', async (req, res) => {
    const { sigunguCd, months = 3 } = req.body ?? {};
    if (!config.keys?.dataGoKr) throw new AppError('CONFIG', '.env 에 DATA_GO_KR_KEY 가 없습니다', 503);
    res.json(await syncTrades(await getPool(), { serviceKey: config.keys.dataGoKr, sigunguCd, months: Number(months) }));
  });
  return r;
}
