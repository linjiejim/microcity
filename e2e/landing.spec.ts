import { expect, test } from '@playwright/test';

// 落地页（D100）：中英两种语言，入口都指向新版与经典版，视频（或还没做好时的说明）在页上
test('落地页：首屏、入口、视频、结果；切到英文再切回来', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?lang=zh');
  await expect(page.locator('.hero h1')).toContainText('分叉的小社会');
  await expect(page.locator('.hero .btn.primary')).toHaveAttribute('href', /5320\/|\/app\//);
  await expect(page.locator('a[href="/classic/"]')).toHaveCount(1);
  await expect(page.locator('#video .video-frame')).toBeVisible();
  expect(await page.locator('.feature').count()).toBeGreaterThanOrEqual(6);
  expect(await page.locator('.finding').count()).toBe(4);
  await expect(page.locator('.finding').first()).toContainText('%');
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/[—–]/);
  await page.locator('.lang').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.hero h1')).toContainText('pause, rewind and fork');
  await expect(page.locator('#results')).toContainText('held in all three runs');
  // 选过的语言会记住（链接里没有 lang 的时候）
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.locator('.lang').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  expect(errors).toEqual([]);
});
