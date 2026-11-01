// 실거래 월 배치 (계획서 §5.5): 등록 단지가 있는 시군구 × 최근 N개월 × 매매·전월세 → trade / trade_rent
//
//   node scripts/sync-trades.js                     (등록 단지의 시군구 전부, 최근 3개월)
//   node scripts/sync-trades.js --sgg 11620 --months 12
//   node --env-file=.env.test scripts/sync-trades.js --sgg 11620   (TEST DB)
//
// 신고 기한(계약 후 30일)과 해제 반영 때문에 지난 달들도 다시 받는다. 쿼터 가드(api_quota)를 거친다.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env')); // --env-file 값이 우선
const { loadConfig } = await import('../api/src/config.js');
const { createPool } = await import('../api/src/db/pool.js');
const { syncTrades, targetSigungus } = await import('../api/src/services/TradeSyncService.js');

const { values: a } = parseArgs({ options: { sgg: { type: 'string', multiple: true }, months: { type: 'string', default: '3' } } });
const config = loadConfig();
const pool = await createPool(config.db);
let failed = 0;
try {
  const sggs = a.sgg?.length ? a.sgg : await targetSigungus(pool);
  if (!sggs.length) console.log('등록된 단지가 없어 받을 시군구가 없습니다 (--sgg 로 지정 가능)');
  for (const sigunguCd of sggs) {
    try {
      const r = await syncTrades(pool, { serviceKey: config.keys.dataGoKr, sigunguCd, months: Number(a.months) });
      console.log(`[${sigunguCd}] 연결 매매 ${r.linked.trade} · 전월세 ${r.linked.trade_rent}`);
      console.table(r.results);
    } catch (err) {
      failed++;
      console.error(`[${sigunguCd}] 실패: ${err.message}`);
    }
  }
} finally {
  await pool.close();
}
process.exitCode = failed ? 1 : 0;
