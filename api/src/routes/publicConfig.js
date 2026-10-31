// 프론트 공개 설정. 비밀값은 내보내지 않는다 (ncpKeyId만 — 도메인 제한 키).
// DB가 없어도 기본값으로 응답 → 지도는 DB 장애와 무관하게 뜬다.
import { Router } from 'express';
import { getSettings } from '../services/SettingService.js';

export function publicConfigRouter({ config, getPool }) {
  const r = Router();
  r.get('/', async (_req, res) => {
    let s = {};
    try {
      s = await getSettings(await getPool(), ['map_engine', 'stale_days']);
    } catch {
      s = {};
    }
    res.json({
      mapEngine: s.map_engine ?? 'NAVER',
      ncpKeyId: config.keys?.ncpKeyId ?? null,
      staleDays: Number(s.stale_days ?? 30),
    });
  });
  return r;
}
