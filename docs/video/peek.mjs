// 快速看几张：node docs/video/peek.mjs '<query>' out.jpg [w h dpr] [clicks...]
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(ROOT + '/package.json');
const { chromium } = require('@playwright/test');
const BASE = process.env.URL ?? 'http://127.0.0.1:5340';
const [q = '', out = '/tmp/peek.jpg', w = '1440', h = '810', dpr = '1.3333', ...clicks] = process.argv.slice(2);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto(BASE + '/' + q);
await page.waitForSelector('[data-testid=app][data-phase=ready]', { timeout: 60_000 });
for (const c of clicks) {
  if (c.startsWith('wait:')) { await page.waitForTimeout(+c.slice(5)); continue; }
  if (c.startsWith('key:')) { await page.keyboard.press(c.slice(4)); continue; }
  await page.locator(c).first().click();
}
await page.waitForTimeout(6000);
await page.screenshot({ path: out, type: 'jpeg', quality: 85 });
await browser.close();
console.log('saved', out);
