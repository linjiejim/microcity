// 交互巡检：选人 → 检查器各标签 → 决策详情 → 新闻编辑器 → 实验弹窗，逐一截图
import { chromium } from '@playwright/test';
const base = process.argv[2] ?? 'http://127.0.0.1:5318/';
const out = process.argv[3] ?? '/tmp/tour';
const agent = process.argv[4] ?? 'a01';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 980 } });
const errs: string[] = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.click(`[data-testid="agent-row-${agent}"]`);
await page.waitForTimeout(1800);
for (const tab of ['overview', 'mind', 'memory', 'relations', 'decisions', 'timeline']) {
  await page.click(`[data-testid="tab-${tab}"]`);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}-insp-${tab}.png`, clip: { x: 1140, y: 70, width: 460, height: 720 } });
}
await page.click('[data-testid="tab-decisions"]');
await page.waitForTimeout(500);
const d = page.locator('[data-testid^="decision-d"]').first();
if (await d.count()) {
  await d.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}-decision.png` });
  await page.keyboard.press('Escape');
}
await page.screenshot({ path: `${out}-selected.png` });
await page.click('[data-testid="open-news"]');
await page.waitForTimeout(600);
await page.click('[data-testid="preset-clarify"]');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}-news.png` });
await page.keyboard.press('Escape');
await page.click('[data-testid="open-experiment"]');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}-exp.png` });
console.log(errs.length ? errs.slice(0, 10).join('\n') : 'no page errors');
await browser.close();
