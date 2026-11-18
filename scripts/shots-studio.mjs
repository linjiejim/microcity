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
/** 名字 → 链接参数（带 t 的链接打开就停在那一刻）、要依次点的 data-testid、等多久 */
const SHOTS = {
  'app-dinner': { q: '?t=D02%2018:40&who=p001', wait: 9000 },
  'app-street': { q: '?t=D02%2007:33:40&who=p095', wait: 9000 },
  'app-pov': { q: '?t=D02%2007:33:40&who=p095', click: ['camera >> text=贴身'], wait: 7000 },
  'app-overview': { q: '?t=D02%2010:10', wait: 5000 },
  'app-night': { q: '?t=D02%2019:40', wait: 5000 },
  'app-portrait': { q: '?v=portrait', wait: 9000, full: true },
  'app-calibration': { q: '?v=portrait', click: ['portrait-tabs >> text=校准'], wait: 9000 },
  'app-paper': { q: '?v=portrait', click: ['portrait-tabs >> text=日报'], wait: 6000 },
  'app-lab': { q: '?v=lab', click: ['case-rain', 'lab-run'], waitFor: 'lab-affected', then: ['affected >> nth=0'], wait: 5000, full: true },
  'app-community': { q: '', click: ['community-open', 'pack-factory'], wait: 2500 },
  'app-factory': { q: '?c=factory&t=D02%2012:05', wait: 6000 },
};

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
page.on('pageerror', (e) => console.log('page error:', e.message));
for (const [name, s] of Object.entries(SHOTS)) {
  if (process.argv.length > 2 && !process.argv.includes(name)) continue;
  await page.goto(BASE + '/' + s.q);
  await page.waitForSelector('[data-testid=app][data-phase=ready]', { timeout: 60_000 });
  const sel = (id) => {
    const [testId, rest] = id.split(' >> ');
    const base = testId === 'affected' ? '[data-testid^=affected-]' : `[data-testid=${testId}]`;
    return rest ? `${base} >> ${rest}` : base;
  };
  for (const id of s.click ?? []) await page.locator(sel(id)).first().click();
  if (s.waitFor) await page.waitForSelector(`[data-testid=${s.waitFor}]`, { timeout: 120_000 });
  for (const id of s.then ?? []) await page.locator(sel(id)).first().click();
  await page.waitForTimeout(s.wait);
  if (s.full) {
    // 纸页是自己滚动的：把视口拉到内容那么高再拍
    const h = await page.evaluate(() => document.querySelector('.page')?.scrollHeight ?? 1000);
    await page.setViewportSize({ width: 1600, height: Math.min(4200, Math.max(1000, h)) });
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 86 });
  if (s.full) await page.setViewportSize({ width: 1600, height: 1000 });
  console.log('saved', `${OUT}/${name}.jpg`);
}
await browser.close();
