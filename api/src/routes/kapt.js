import { Router } from 'express';
import { searchKapt, kaptDraft, kaptAt } from '../services/KaptService.js';
import { reverseGeocode } from '../external/ncpGeocode.js';
import { syncTrades } from '../services/TradeSyncService.js';
import { AppError } from '../util/errors.js';

/** 단지 식별정보 검색 (로컬 DB) */
export function kaptRouter({ getPool, config }) {
  const r = Router();
  /**
   * 지도 우클릭 위치의 단지 후보 — 역지오코딩 1회(외부 API, 쿼터 가드) + 로컬 DB 조회.
   * 사용자가 지도에서 단지를 등록하려고 누른 경우에만 호출된다 (화면 로딩 경로 아님).
   * 결과 주소·후보는 제안값이며, 등록 폼에서 사용자가 확인한 값만 저장된다.
   */
  r.post('/locate', async (req, res) => {
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    if (!(lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132)) throw new AppError('VALIDATION', '국내 좌표가 아닙니다', 400);
    const pool = await getPool();
    const place = await reverseGeocode({ pool, keyId: config?.keys?.ncpKeyId, secret: config?.keys?.ncpClientSecret, lat, lng });
    res.json({ place, candidates: place ? await kaptAt(pool, place) : [] });
  });
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
