import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 배포마다 달라지는 앱 버전 (Vercel 커밋 SHA, 로컬은 빌드 시각)
const APP_VERSION = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || `dev-${Date.now().toString(36)}`;

/** 태블릿이 새 배포를 감지할 수 있도록 dist/version.json 생성 */
const versionFilePlugin = (): Plugin => ({
  name: 'studycalm-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: APP_VERSION }) });
  },
});

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), versionFilePlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 3000,
  },
  // @ts-expect-error vitest config
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
  },
});
