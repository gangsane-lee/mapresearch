// 기준점(설정의 지하철역 등)까지 대중교통 소요시간 제안 (계획서 §5.3 POST /api/commute/suggest)
// 스냅샷 입력 화면에서 사용자가 "자동 계산"을 눌렀을 때만 호출 — 화면 로딩 경로가 아니다.
// 결과는 제안값: 화면에 채워 보여 주고, 사용자가 저장한 값만 commute 에 남는다(suggested_minutes 는 참고 기록).
import { Router } from 'express';
import { z } from 'zod';
import sql from 'mssql';
import { listAnchors } from '../services/SettingService.js';
import { transitRoute } from '../external/kakaoTransit.js';
import { AppError } from '../util/errors.js';

const input = z.object({
  complexId: z.number().int().positive(),
  anchorIds: z.array(z.number().int().positive()).max(20).optional(),
});

export function commuteRouter({ getPool, config }) {
  const r = Router();
  r.post('/suggest', async (req, res) => {
    const p = input.safeParse(req.body);
    if (!p.success) throw new AppError('VALIDATION', `${p.error.issues[0].path.join('.')}: ${p.error.issues[0].message}`, 400);
    const { complexId, anchorIds } = p.data;
    const pool = await getPool();
    const c = (await pool.request().input('c', sql.Int, complexId).query('SELECT lat, lng FROM dbo.complex WHERE complex_id = @c')).recordset[0];
    if (!c) throw new AppError('NOT_FOUND', '단지를 찾을 수 없습니다', 404);
    if (c.lat == null) throw new AppError('VALIDATION', '단지 위치(핀)가 없어 계산할 수 없습니다. 단지 상세에서 위치를 지정하세요', 400);
    const from = { lat: Number(c.lat), lng: Number(c.lng) };
    const anchors = (await listAnchors(pool)).filter((a) => a.active && a.lat != null && (!anchorIds || anchorIds.includes(a.anchorId)));
    if (!anchors.length) throw new AppError('VALIDATION', '좌표가 있는 기준점이 없습니다. 설정 › 기준점에서 위도·경도를 입력하세요', 400);

    const items = [];
    const errors = [];
    // 순서대로 호출 (쿼터 카운트가 정확하도록, 기준점은 많아야 몇 개)
    for (const a of anchors) {
      try {
        const t = await transitRoute({ pool, restKey: config?.keys?.kakaoRest, from, to: { lat: a.lat, lng: a.lng }, complexId });
        items.push({ anchorId: a.anchorId, anchorName: a.name, ...t });
      } catch (err) {
        // 키 없음·쿼터 초과는 나머지도 똑같이 실패하므로 바로 알린다
        if (['CONFIG', 'QUOTA_EXCEEDED', 'QUOTA_NOT_CONFIGURED'].includes(err.code)) throw err;
        errors.push({ anchorId: a.anchorId, anchorName: a.name, message: err.message });
      }
    }
    res.json({ items, errors });
  });
  return r;
}
