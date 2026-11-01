// 用法：node --import tsx scripts/shot.ts <url> <out.png> [w] [h] [waitMs] [clip x,y,w,h]
import { chromium } from '@playwright/test';
const [url = 'http://127.0.0.1:5318/', out = '/tmp/mc.png', w = '1600', h = '980', wait = '2500', clip] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
const logs: string[] = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(Number(wait));
const c = clip?.split(',').map(Number);
await page.screenshot({ path: out, ...(c ? { clip: { x: c[0]!, y: c[1]!, width: c[2]!, height: c[3]! } } : {}) });
console.log(logs.slice(0, 20).join('\n') || 'no console errors');
await browser.close();
