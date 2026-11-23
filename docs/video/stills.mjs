// 抽几帧看看：node docs/video/stills.mjs out.jpg 1.2 3.4 …（拼成一张，每格 640 宽）
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(HERE, '../../package.json'));
const { chromium } = require('@playwright/test');
const [out, ...ts] = process.argv.slice(2);
const dir = resolve(HERE, '.work/stills'); mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('page error:', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
await page.goto('file://' + resolve(HERE, 'comp.html') + (process.env.Q ? '?' + process.env.Q : process.env.HUD ? '?hud' : ''));
await page.evaluate(() => window.__ready);
const files = [];
for (const t of ts) {
  const n = await page.evaluate((t) => window.__seek(t), Number(t));
  const f = ts.length === 1 && out.endsWith('.png') ? resolve(out) + '.tmp.png' : `${dir}/s-${t}.jpg`; files.push(f);
  await page.screenshot({ path: f, ...(f.endsWith('.png') ? { type: 'png' } : { type: 'jpeg', quality: 88 }) });
  console.log(t, 'samples', n);
}
await browser.close();
if (files.length === 1) { execFileSync('cp', [files[0], resolve(out)]); console.log('saved', out); process.exit(0); }
const cols = Math.min(3, files.length), w = Number(process.env.W ?? 640);
execFileSync('ffmpeg', ['-v', 'error', '-y', ...files.flatMap((f) => ['-i', f]), '-filter_complex', files.map((_, i) => `[${i}]scale=${w}:-1[v${i}]`).join(';') + ';' + files.map((_, i) => `[v${i}]`).join('') + `xstack=inputs=${files.length}:layout=` + files.map((_, i) => `${(i % cols) ? Array.from({ length: i % cols }, () => 'w0').join('+') : '0'}_${Math.floor(i / cols) ? Array.from({ length: Math.floor(i / cols) }, () => 'h0').join('+') : '0'}`).join('|') + (files.length === 1 ? '' : ''), resolve(out)]);
console.log('saved', out);
