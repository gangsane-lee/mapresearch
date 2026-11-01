import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// PORT 는 실행 도구가 Vite 자신의 포트로 넣는 경우가 있어(→ 프록시가 자기 자신을 가리킴) 별도 변수로 받는다.
// 지정이 없으면 개발용 ../.env.dev 의 PORT(맥미니: 운영 5180 과 따로 5181), 그것도 없으면 5180.
const devEnv = fileURLToPath(new URL('../.env.dev', import.meta.url));
const apiPort =
  process.env.API_PORT ?? (existsSync(devEnv) ? /^PORT=(\d+)/m.exec(readFileSync(devEnv, 'utf8'))?.[1] : null) ?? '5180';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    fs: { allow: ['..'] }, // shared/ (서버·화면 공용 유틸)
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
      '/media': `http://127.0.0.1:${apiPort}`,
    },
  },
  // 상세 팝업 청크(ECharts 포함)는 지연 로딩이라 첫 화면에 영향 없음
  build: { chunkSizeWarningLimit: 700 },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.js'],
  },
});
