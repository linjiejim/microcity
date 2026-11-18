import { expect, test, type Page } from '@playwright/test';

// 新版应用（v5，M2）的主流程：打开就是在过日子的社区；点人即跟随；时间轴可拖；设置里填密钥、看用量。
// 不访问真实的 OpenRouter：所有发往 openrouter.ai 的请求都被拦下并给出假回答。

const FAKE_KEY = `sk-or-${'e2e'.repeat(8)}`;

async function ready(page: Page, query = ''): Promise<void> {
  // 无头浏览器没有显卡：用低画质
  await page.goto(`/${query ? `${query}&q=low` : '?q=low'}`);
  await expect(page.getByTestId('app')).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 });
  await expect(page.getByTestId('timebar')).toBeVisible();
}

const clockMinutes = async (page: Page): Promise<number> => {
  const [h, m] = (await page.getByTestId('clock').innerText()).split(':').map(Number);
  return h! * 60 + m!;
};

test('打开就是在过日子的社区：时间在走，可以暂停', async ({ page }) => {
  await ready(page);
  await expect(page.getByTestId('where')).toContainText('和平里');
  const a = await clockMinutes(page);
  await page.waitForTimeout(1500);
  expect(await clockMinutes(page)).toBeGreaterThan(a);
  await page.getByTestId('play').click();
  const b = await clockMinutes(page);
  await page.waitForTimeout(800);
  expect(await clockMinutes(page)).toBe(b);
});

test('点一个人就跟随：人物卡、时间轴着色、为什么', async ({ page }) => {
  await ready(page, '?t=D02%2010:30');
  await page.getByTestId('people-toggle').click();
  await page.getByTestId('people-group').getByText('老人').click();
  const first = page.getByTestId('people').locator('.person-row').first();
  const name = (await first.locator('b').innerText()).trim();
  await first.click();
  const card = page.getByTestId('person-card');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('person-name')).toHaveText(name);
  await expect(page.getByTestId('doing')).not.toBeEmpty();
  await expect(page.getByTestId('thought')).not.toBeEmpty();
  for (const k of ['hunger', 'energy', 'social', 'fun']) await expect(page.getByTestId(`need-${k}`)).toBeVisible();
  await expect(page.getByTestId('wallet')).toContainText('¥');
  // 时间轴按这个人的活动着色
  expect(await page.getByTestId('strip').locator('.seg-block').count()).toBeGreaterThan(3);
  await expect(page.getByTestId('camera').locator('button.on')).toHaveText(/跟随/);
  // 不再跟随
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
});

test('时间轴可以拖到这一天的任一时刻，也可以换天', async ({ page }) => {
  await ready(page, '?t=D02%2008:00');
  const strip = page.getByTestId('strip');
  const box = (await strip.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  await expect.poll(() => clockMinutes(page)).toBeGreaterThan(17 * 60 + 40);
  expect(await clockMinutes(page)).toBeLessThan(18 * 60 + 20);
  await expect(page.getByTestId('day-label')).toContainText('第 2 天');
  await page.getByTestId('day-next').click();
  await expect(page.getByTestId('day-label')).toContainText('第 3 天');
  await page.getByTestId('day-prev').click();
  await page.getByTestId('day-prev').click();
  await expect(page.getByTestId('day-label')).toContainText('第 1 天');
  await expect(page.getByTestId('day-prev')).toBeDisabled();
});

test('同一个链接看到同一刻的同一个人', async ({ page }) => {
  await ready(page, '?seed=1&t=D02%2019:10&who=p001');
  await expect(page.getByTestId('person-card')).toBeVisible();
  const name = await page.getByTestId('person-name').innerText();
  const doing = await page.getByTestId('doing').innerText();
  await ready(page, '?seed=1&t=D02%2019:10&who=p001');
  await expect(page.getByTestId('person-name')).toHaveText(name);
  // 带 t 的链接打开就停在那一刻：两次看到的完全相同
  await expect(page.getByTestId('doing')).toHaveText(doing);
});

test('为什么：自由选择能展开全部候选与因子', async ({ page }) => {
  await ready(page, '?t=D02%2010:20');
  await page.getByTestId('people-toggle').click();
  await page.getByTestId('people-group').getByText('老人').click();
  const rows = page.getByTestId('people').locator('.person-row');
  // 找一个此刻是自由选择（不是固定安排）的人
  const n = Math.min(12, await rows.count());
  let opened = false;
  for (let i = 0; i < n && !opened; i++) {
    await rows.nth(i).click();
    if (await page.getByTestId('why-toggle').isVisible().catch(() => false)) {
      await page.getByTestId('why-toggle').click();
      await expect(page.getByTestId('options')).toBeVisible();
      expect(await page.getByTestId('options').locator('tr').count()).toBeGreaterThan(1);
      await expect(page.getByTestId('options').locator('tr.on')).toHaveCount(1);
      opened = true;
    }
  }
  expect(opened).toBe(true);
});

test('设置：不填密钥照常用；填了密钥能查用量、让语言模型说一句', async ({ page }) => {
  let completions = 0;
  await page.route('https://openrouter.ai/**', async (route) => {
    const url = route.request().url();
    expect(route.request().headers().authorization ?? '').toMatch(/^(Bearer sk-or-(e2e)+)?$/);
    if (url.endsWith('/key')) return route.fulfill({ json: { data: { label: 'e2e', usage: 1.25, limit: 5, limit_remaining: 3.75 } } });
    if (url.endsWith('/models')) return route.fulfill({ json: { data: [{ id: 'deepseek/deepseek-v4-flash' }, { id: 'typesafe/jev-1.13' }] } });
    completions++;
    return route.fulfill({ json: { choices: [{ message: { content: '日子就这么过着，挺好。' } }], usage: { prompt_tokens: 200, completion_tokens: 12, cost: 0.0004 } } });
  });
  await ready(page, '?t=D02%2015:00&who=p001');
  await expect(page.getByTestId('person-card')).toBeVisible();

  // 没有密钥：用模板想法，并说明原因
  const before = await page.getByTestId('thought').innerText();
  await page.getByTestId('monologue').click();
  await expect(page.getByTestId('person-card').locator('.note')).toContainText('密钥');
  await expect(page.getByTestId('thought')).toHaveText(before);
  expect(completions).toBe(0);

  await page.getByTestId('settings-open').click();
  const modal = page.getByTestId('settings');
  await expect(modal).toBeVisible();
  await expect(page.getByTestId('model-language')).toHaveValue('deepseek/deepseek-v4-flash');
  await expect(page.getByTestId('model-decision')).toHaveValue('typesafe/jev-1.13');
  await page.getByTestId('key-input').fill(FAKE_KEY);
  await page.getByTestId('key-save').click();
  await expect(page.getByTestId('key-mask')).not.toContainText('e2ee2ee2e');
  await page.getByTestId('usage-check').click();
  await expect(page.getByTestId('usage-account')).toContainText('$1.250');
  await expect(page.getByTestId('usage-account')).toContainText('还剩 $3.750');
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();

  await page.getByTestId('monologue').click();
  await expect(page.getByTestId('thought')).toHaveText('日子就这么过着，挺好。');
  expect(completions).toBe(1);
  await page.getByTestId('settings-open').click();
  await expect(page.getByTestId('usage-local')).toContainText('调用 1 次');
  await page.getByTestId('key-clear').click();
  await expect(page.getByTestId('key-input')).toHaveValue('');
});
