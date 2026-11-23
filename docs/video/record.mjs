// 录真实应用的镜头：先起开发服务器（见 README），再 `node docs/video/record.mjs [镜头名…]`
//
// 不是录屏：页面里的 requestAnimationFrame 与 performance.now 换成虚拟时钟，
// 每一帧前进整 1/30 秒再截图，所以镜头和机器快慢无关、每帧都均匀。
// 输出 docs/video/.work/footage/<镜头>/NNNN.jpg（1920×1080）与 info.json（帧数、点击的位置与帧号）。
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const require = createRequire(ROOT + '/package.json');
const { chromium } = require('@playwright/test');
const BASE = process.env.URL ?? 'http://127.0.0.1:5340';
const OUT = resolve(HERE, '.work/footage');
const VW = 1440, VH = 810, DPR = 1920 / 1440;
const FPS = 30;

// 每个镜头：q 链接参数；pre 开录前（真实时间）做的事；n 录多少帧；at 第几帧做什么。
// 动作：{click: 选择器} {key: 键} {scroll: [选择器, 起, 止, 帧数]} {waitFor: 选择器}（等的时候每 every 毫秒截一帧）
const T = (id) => `[data-testid=${id}]`;
const SHOTS = {
  // 俯瞰：傍晚到入夜，20 分/秒
  dusk: { q: '?t=D02%2017:25', pre: [{ click: `${T('camera')} >> text=俯瞰` }, { wait: 2500 }, { click: `${T('speed')} >> text=20 分/秒` }], n: 300, at: { 0: [{ click: T('play') }] } },
  // 点一个人：街道视角，在居民名单里点刘晓彤，跟着去小学接孩子，再一起回家（进屋墙让开）
  pickup: {
    q: '?t=D02%2016:20:50',
    pre: [{ click: `${T('camera')} >> text=街道` }, { wait: 2500 }, { click: `${T('people-toggle')}` }, { wait: 800 }, { click: `${T('speed')} >> text=1 分/秒` }],
    n: 1260,
    at: { 18: [{ click: T('person-p082') }], 50: [{ click: T('people-toggle') }], 62: [{ click: T('play') }] },
  },
  // 为什么：茶馆里的邵兴旺，展开全部候选
  why: { q: '?t=D02%2015:43&who=p036', pre: [{ wait: 3000 }, { click: `${T('speed')} >> text=实时` }], n: 200, at: { 0: [{ click: T('play') }], 40: [{ click: 'text=看全部候选' }] } },
  // 贴身：跟在去接孩子的家长身后
  pov: { q: '?t=D02%2016:22:10&who=p082', pre: [{ wait: 2500 }, { click: `${T('speed')} >> text=10 倍` }], n: 240, at: { 8: [{ click: `${T('camera')} >> text=贴身` }], 10: [{ click: T('play') }] } },
  // 一分钟看完一天：打开导演开关
  director: { q: '?t=D02%2006:40&who=p082', pre: [{ wait: 3000 }], n: 420, at: { 15: [{ click: T('director') }] } },
  // 画像：从上往下慢慢滚
  portrait: { q: '?v=portrait', pre: [{ wait: 6000 }], n: 420, at: { 20: [{ scroll: ['.page', 0, 2200, 380] }] } },
  calibration: { q: '?v=portrait', pre: [{ wait: 5000 }], n: 240, at: { 15: [{ click: `${T('portrait-tabs')} >> text=校准` }], 80: [{ scroll: ['.page', 0, 520, 140] }] } },
  // 实验台：看过几个案例，选连日下雨，先猜，跑，等结果，点开日子过得最不一样的人
  lab: {
    q: '?v=lab',
    pre: [{ wait: 4000 }],
    n: 560,
    at: {
      20: [{ click: T('case-market-closed') }],
      42: [{ click: T('case-rumor') }],
      64: [{ click: T('case-rain') }],
      95: [{ click: `${T('guess-pick-P1')} >> text=会更低` }],
      115: [{ click: T('lab-run') }, { waitFor: T('lab-affected'), every: 200 }],
      125: [{ scrollTo: ['.page', '[data-testid^=verdict-]', 110, 70] }],
      250: [{ scrollTo: ['.page', T('lab-affected'), 90, 70] }],
      330: [{ click: '[data-testid^=affected-] >> nth=0' }],
      350: [{ scrollTo: ['.page', T('micro'), 60, 80] }],
    },
  },
  // 四个社区
  community: { q: '?t=D02%2010:10', pre: [{ wait: 3000 }], n: 170, at: { 15: [{ click: T('community-open') }], 55: [{ click: T('pack-newtown') }], 85: [{ click: T('pack-village') }], 115: [{ click: T('pack-factory') }] } },
  factory: { q: '?c=factory&t=D02%2012:05', pre: [{ click: `${T('camera')} >> text=俯瞰` }, { wait: 4000 }, { click: `${T('speed')} >> text=1 分/秒` }], n: 240, at: { 0: [{ click: T('play') }] } },
};

const CLOCK = () => {
  const realRAF = window.requestAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  let manual = false, vt = 0, q = [];
  Object.defineProperty(performance, 'now', { configurable: true, value: () => (manual ? vt : realNow()) });
  window.requestAnimationFrame = (cb) => {
    if (!manual) return realRAF((ts) => cb(manual ? vt : ts));
    q.push(cb);
    return 1e7 + q.length;
  };
  const realCancel = window.cancelAnimationFrame.bind(window);
  window.cancelAnimationFrame = (id) => (id >= 1e7 ? undefined : realCancel(id));
  window.__vclock = {
    start() { vt = realNow(); manual = true; },
    step(ms) { vt += ms; const cbs = q; q = []; for (const cb of cbs) cb(vt); return cbs.length; },
  };
};

const want = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
for (const [name, s] of Object.entries(SHOTS)) {
  if (want.length && !want.includes(name)) continue;
  const dir = `${OUT}/${name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR });
  await ctx.addInitScript(CLOCK);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] page error:`, e.message));
  await page.goto(BASE + '/' + s.q);
  await page.waitForSelector('[data-testid=app][data-phase=ready]', { timeout: 90_000 });
  await page.waitForTimeout(1500);
  const clicks = [];
  const box = async (sel) => {
    await page.locator(sel).first().scrollIntoViewIfNeeded().catch(() => {});
    const b = await page.locator(sel).first().boundingBox();
    return b ? [Math.round((b.x + b.width / 2) * DPR), Math.round((b.y + b.height / 2) * DPR)] : null;
  };
  for (const a of s.pre ?? []) {
    if (a.wait) await page.waitForTimeout(a.wait);
    if (a.click) await page.locator(a.click).first().click();
  }
  await page.mouse.move(VW - 4, VH / 2);
  await page.evaluate(() => window.__vclock.start());
  let f = 0, off = 0;
  const shot = async () => {
    await page.screenshot({ path: `${dir}/${String(f).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 });
    f++;
  };
  const scrolls = [];
  while (f < s.n) {
    for (const a of s.at?.[f - off] ?? []) {
      if (a.click) {
        const at = await box(a.click);
        clicks.push({ f, x: at?.[0], y: at?.[1], sel: a.click });
        await page.locator(a.click).first().click();
      }
      if (a.key) await page.keyboard.press(a.key);
      if (a.scrollTo) {
        const [cont, target, pad, n, edge] = a.scrollTo;
        const [y0, y1] = await page.evaluate(([cont, target, pad, edge]) => {
          const c = document.querySelector(cont), el = document.querySelector(target);
          if (!c || !el) return [0, 0];
          const r = el.getBoundingClientRect(), cr = c.getBoundingClientRect();
          const y = edge === 'bottom' ? c.scrollTop + r.bottom - cr.bottom - pad : c.scrollTop + r.top - cr.top - pad;
          return [c.scrollTop, Math.max(0, Math.min(c.scrollHeight - c.clientHeight, y))];
        }, [cont, target, pad, edge]);
        scrolls.push({ sel: cont, y0, y1, f0: f, n });
      }
      if (a.scroll) scrolls.push({ sel: a.scroll[0], y0: a.scroll[1], y1: a.scroll[2], f0: f, n: a.scroll[3] });
      if (a.waitFor) {
        const t0 = Date.now();
        while (!(await page.locator(a.waitFor).count()) && Date.now() - t0 < 180_000) {
          await page.evaluate(() => window.__vclock.step(1000 / 30));
          await shot();
          await page.waitForTimeout(a.every ?? 250);
        }
        clicks.push({ f, waited: true });
        off = f - Number(Object.keys(s.at).find((k) => s.at[k].includes(a)));
      }
    }
    for (const sc of scrolls) {
      const k = Math.min(1, Math.max(0, (f - sc.f0) / sc.n));
      if (f >= sc.f0 && f <= sc.f0 + sc.n) {
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        await page.evaluate(([sel, y]) => { const el = document.querySelector(sel); if (el) el.scrollTop = y; }, [sc.sel, sc.y0 + (sc.y1 - sc.y0) * e]);
      }
    }
    await page.evaluate(() => window.__vclock.step(1000 / 30));
    await shot();
  }
  writeFileSync(`${dir}/info.json`, JSON.stringify({ n: f, fps: FPS, w: 1920, h: 1080, clicks }, null, 1));
  console.log(`[${name}] ${f} frames, clicks`, JSON.stringify(clicks));
  await ctx.close();
}
await browser.close();
