// 新版应用的截图（真实的模拟数据，不是样片）：先起 `pnpm dev:studio`，再 `node scripts/shots-studio.mjs`
// 输出 JPG 到 docs/assets/v5/；用仓库里的 Playwright。
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(ROOT + '/package.json');
const { chromium } = require('@playwright/test');
const OUT = process.env.OUT ?? ROOT + '/docs/assets/v5';
const BASE = process.env.URL ?? 'http://127.0.0.1:5320';

/** 名字 → 链接参数（带 t 的链接打开就停在那一刻）与等镜头到位的时间 */
const SHOTS = {
  'app-dinner': { q: '?t=D02%2018:40&who=p001', wait: 9000 },
  'app-street': { q: '?t=D02%2007:33:40&who=p095', wait: 9000 },
  'app-overview': { q: '?t=D02%2010:10', wait: 5000 },
  'app-night': { q: '?t=D02%2019:40', wait: 5000 },
};

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
page.on('pageerror', (e) => console.log('page error:', e.message));
for (const [name, s] of Object.entries(SHOTS)) {
  if (process.argv.length > 2 && !process.argv.includes(name)) continue;
  await page.goto(BASE + '/' + s.q);
  await page.waitForSelector('[data-testid=app][data-phase=ready]', { timeout: 60_000 });
  await page.waitForTimeout(s.wait);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 86 });
  console.log('saved', `${OUT}/${name}.jpg`);
}
await browser.close();
