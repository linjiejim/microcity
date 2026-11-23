import { defineConfig } from '@playwright/test';

// E2E 用独立端口与独立数据库，离线模式（规则决策，不花钱），不碰开发环境
const API = 5417;
const WEB = 5418 + 100;
const data = '/tmp/microcity-e2e';
// 新版应用（v5）：纯静态，没有服务端
const STUDIO = 5520;
const LANDING = 5530;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  projects: [
    { name: 'classic', testMatch: 'app.spec.ts', use: { baseURL: `http://127.0.0.1:${WEB}` } },
    { name: 'studio', testMatch: 'studio.spec.ts', use: { baseURL: `http://127.0.0.1:${STUDIO}` } },
    { name: 'landing', testMatch: 'landing.spec.ts', use: { baseURL: `http://127.0.0.1:${LANDING}` } },
  ],
  use: {
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
    {
      command: `MICROCITY_STUDIO_PORT=${STUDIO} pnpm --filter @microcity/studio exec vite --port ${STUDIO} --strictPort`,
      url: `http://127.0.0.1:${STUDIO}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `MICROCITY_LANDING_PORT=${LANDING} pnpm --filter @microcity/landing exec vite --port ${LANDING} --strictPort`,
      url: `http://127.0.0.1:${LANDING}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
