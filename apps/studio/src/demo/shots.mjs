// 样片验收截图：先起 `pnpm dev:studio`，再 `node apps/studio/src/demo/shots.mjs [名字 ...]`
// 输出到 docs/assets/v5/（OUT 可改）；用仓库里的 Playwright，不需要另装东西。
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(ROOT + '/package.json');
const { chromium } = require('@playwright/test');
const OUT = process.env.OUT ?? ROOT + '/docs/assets/v5';

const SHOTS = {
  'm0-overview': { h: 10, m: 0, mode: 'overview', orbit: { x: 88, z: 74, dist: 380, yaw: 0.5, pitch: 0.86 } },
  'm0-dusk': { h: 17, m: 50, mode: 'street', orbit: { x: 84, z: 72, dist: 92, yaw: 0.45, pitch: 0.45 } },
  'm0-night': { h: 20, m: 10, mode: 'street', orbit: { x: 100, z: 70, dist: 130, yaw: 0.4, pitch: 0.6 } },
  'm0-follow': { h: 6, m: 44, follow: true, js: '__demo.world.debugOrbit({ yaw: 3.3, dist: 24, pitch: 0.5 })', wait: 2500 },
  'm0-interior': { h: 11, m: 55, follow: true, wait: 2500 },
  'x-market': { h: 9, m: 23, follow: true, js: '__demo.world.debugOrbit({ yaw: 0.2, dist: 22, pitch: 0.5 })', wait: 2500 },
  'x-apartment': { h: 21, m: 0, mode: 'follow', js: "__demo.world.setFollow('r5_0'); __demo.world.setCameraMode('follow')", wait: 2500 },
  // 第二轮：角色近景、身后视角、白天街景、公交进站
  'p2-character': { h: 6, m: 44, follow: true, js: '__demo.world.debugOrbit({ yaw: 3.25, dist: 9.5, pitch: 0.2 })', wait: 2500 },
  'p2-pov': { h: 6, m: 43, follow: true, mode: 'pov', wait: 3200 },
  'p2-street': { h: 9, m: 40, mode: 'street', orbit: { x: 70, z: 74, dist: 42, yaw: 0.25, pitch: 0.3 } },
  'p2-bus': { h: 7, m: 50, mode: 'street', orbit: { x: 166, z: 70, dist: 44, yaw: 0.5, pitch: 0.4 } },
  'x-eat': { h: 7, m: 0, follow: true, js: '__demo.world.debugOrbit({ yaw: 0.6, dist: 9, pitch: 0.55 })', wait: 2500 },
  'x-dance2': { h: 19, m: 30, follow: true, js: '__demo.world.debugOrbit({ yaw: 3.0, dist: 16, pitch: 0.3 })', wait: 2500 },
  'x-pov-in': { h: 11, m: 55, follow: true, mode: 'pov', wait: 3200 },
  'x-rain': { h: 15, m: 0, weather: 'rain', mode: 'street', orbit: { x: 96, z: 70, dist: 90, yaw: 0.6, pitch: 0.5 } },
  'x-dance': { h: 19, m: 30, mode: 'street', orbit: { x: 104, z: 56, dist: 46, yaw: 0.3, pitch: 0.5 } },
  'x-park': { h: 7, m: 30, mode: 'street', orbit: { x: 28, z: 26, dist: 60, yaw: 0.7, pitch: 0.55 } },
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS).filter((n) => n.startsWith('m0-'));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto((process.env.URL ?? 'http://127.0.0.1:5320') + '/?demo=1');
await page.waitForFunction(() => !!window.__demo);
await page.addStyleTag({ content: '[data-testid=demo-panel]{display:none !important}' });
for (const n of names) {
  const s = SHOTS[n];
  if (!s) continue;
  await page.evaluate((o) => window.__demo.shot({ weather: 'sun', play: false, follow: false, ...o }), s);
  if (s.js) await page.evaluate(s.js);
  await page.waitForTimeout(s.wait ?? 1200);
  await page.screenshot({ path: `${OUT}/${n}.png` });
  console.log('saved', `${OUT}/${n}.png`);
}
await browser.close();
