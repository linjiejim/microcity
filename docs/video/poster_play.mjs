// 给海报加一个居中的播放键（README 里用）：node docs/video/poster_play.mjs in.jpg out.jpg
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(HERE, '../../package.json'));
const { chromium } = require('@playwright/test');
const [src, out] = process.argv.slice(2);
const b64 = readFileSync(resolve(src)).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.setContent(`<html><body style="margin:0">
<div style="position:relative;width:1920px;height:1080px;background:url(data:image/${src.endsWith('.png') ? 'png' : 'jpeg'};base64,${b64}) center/cover">
  <div style="position:absolute;inset:0;background:radial-gradient(circle at 50% 50%, rgba(38,36,31,0.18), rgba(38,36,31,0) 30%)"></div>
  <div style="position:absolute;left:50%;top:50%;width:168px;height:168px;margin:-84px 0 0 -84px;border-radius:50%;
       background:rgba(255,255,255,0.94);box-shadow:0 18px 50px rgba(38,36,31,0.28), 0 0 0 1.5px #e7e0d5;display:flex;align-items:center;justify-content:center">
    <svg width="64" height="64" viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="#1f5f63"/></svg>
  </div>
</div></body></html>`);
for (const q of [86, 80, 74, 68]) {
  await page.screenshot({ path: resolve(out), type: 'jpeg', quality: q });
  if (statSync(resolve(out)).size < 390000) break;
}
await browser.close();
console.log('saved', out, statSync(resolve(out)).size, 'bytes');
