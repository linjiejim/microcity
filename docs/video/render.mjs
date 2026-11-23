// 渲染：node docs/video/render.mjs [--workers 6] [--from 0 --to 100]
// 每个工人一个 Chromium，按帧 seek（快门里多取样的帧由页面自己平均），截成 JPEG，最后用 ffmpeg 编码。
import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(HERE, '../../package.json'));
const { chromium } = require('@playwright/test');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const WORKERS = arg('--workers', 6), FPS = 30;
const OUT = resolve(HERE, '.work/frames'); mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const probe = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await probe.goto('file://' + resolve(HERE, 'comp.html'));
const dur = await probe.evaluate(async () => { await window.__ready; return window.__meta.dur; });
await probe.close();
const N = Math.round(dur * FPS);
const f0 = Math.round(arg('--from', 0) * FPS), f1 = Math.min(N, Math.round(arg('--to', dur) * FPS));
const t0 = Date.now();
let done = 0, samples = 0;
const chunk = Math.ceil((f1 - f0) / WORKERS);
await Promise.all([...Array(WORKERS)].map(async (_, w) => {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => console.log(`[w${w}] page error:`, e.message));
  await page.goto('file://' + resolve(HERE, 'comp.html'));
  await page.evaluate(() => window.__ready);
  for (let f = f0 + w * chunk; f < Math.min(f1, f0 + (w + 1) * chunk); f++) {
    samples += await page.evaluate((t) => window.__seek(t), f / FPS);
    await page.screenshot({ path: `${OUT}/${String(f).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 93 });
    if (++done % 300 === 0) console.log(`${done}/${f1 - f0} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  await page.close();
}));
await browser.close();
console.log(`rendered ${f1 - f0} frames (${N} total, ${dur.toFixed(2)} s) with ${samples} samples in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
