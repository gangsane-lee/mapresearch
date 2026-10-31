import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { createApp } from './app.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// DB가 아직 준비되지 않아도 서버는 뜨고, /api/health 가 503을 돌려준다.
let poolPromise = null;
function getPool() {
  if (!poolPromise) {
    poolPromise = createPool(config.db).catch((err) => {
      poolPromise = null; // 다음 요청에서 재시도
      throw err;
    });
  }
  return poolPromise;
}

const app = createApp({ config, getPool });
const server = app.listen(config.port, config.host, () => {
  console.log(`AptLog API http://${config.host}:${config.port} (DB ${config.db.database})`);
});

async function shutdown() {
  server.close();
  if (poolPromise) await (await poolPromise.catch(() => null))?.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
