import { defineConfig } from '@playwright/test';

// E2E 用独立端口与独立数据库，离线模式（规则决策，不花钱），不碰开发环境
const API = 5417;
const WEB = 5418 + 100;
const data = '/tmp/microcity-e2e';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${WEB}`,
    viewport: { width: 1600, height: 980 },
    launchOptions: { args: ['--use-gl=angle', '--ignore-gpu-blocklist'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `rm -rf ${data} && MICROCITY_OFFLINE=1 MICROCITY_DATA=${data} MICROCITY_PORT=${API} node --no-warnings=ExperimentalWarning --import tsx apps/server/src/main.ts`,
      url: `http://127.0.0.1:${API}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `MICROCITY_PORT=${API} MICROCITY_WEB_PORT=${WEB} pnpm --filter @microcity/web exec vite --port ${WEB} --strictPort`,
      url: `http://127.0.0.1:${WEB}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
