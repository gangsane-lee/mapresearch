import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const apiPort = process.env.PORT ?? '5180';

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
