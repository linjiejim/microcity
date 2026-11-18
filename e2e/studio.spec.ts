import { expect, test, type Page } from '@playwright/test';

// 新版应用（v5，M2）的主流程：打开就是在过日子的社区；点人即跟随；时间轴可拖；设置里填密钥、看用量。
// 不访问真实的 OpenRouter：所有发往 openrouter.ai 的请求都被拦下并给出假回答。

const FAKE_KEY = `sk-or-${'e2e'.repeat(8)}`;

async function ready(page: Page, query = ''): Promise<void> {
  // 无头浏览器没有显卡：用低画质
  await page.goto(`/${query ? `${query}&q=low` : '?q=low'}`);
  await expect(page.getByTestId('app')).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 });
  if (!/[?&]v=(lab|portrait)/.test(query)) await expect(page.getByTestId('timebar')).toBeVisible();
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

// ───────────────────────── M3–M5：画像、实验台、多社区

test('画像：社区、人群、日报、校准都有内容；没选人时请去挑一个', async ({ page }) => {
  await ready(page, '?t=D02%2012:00');
  await page.getByTestId('nav').getByText('画像').click();
  await expect(page.getByTestId('portrait')).toBeVisible();
  await expect(page.getByTestId('p-headline')).toContainText('人');
  await expect(page.getByTestId('p-heat')).toBeVisible();
  expect(await page.getByTestId('p-flows').locator('.bars-row').count()).toBeGreaterThan(5);
  await expect(page.getByTestId('p-flows')).not.toContainText('firm');

  await page.getByTestId('portrait-tabs').getByText('人群').click();
  expect(await page.getByTestId('p-groups').locator('.grouprow').count()).toBeGreaterThan(3);

  await page.getByTestId('portrait-tabs').getByText('日报').click();
  await expect(page.getByTestId('p-paper')).toContainText('和平里日报');
  await expect(page.getByTestId('p-paper')).toContainText('第 1 天');
  await page.getByTestId('paper-next').click();
  await expect(page.getByTestId('p-paper')).toContainText('第 2 天');

  await page.getByTestId('portrait-tabs').getByText('校准').click();
  await expect(page.getByTestId('p-calibration')).toContainText('有酬劳动');
  await expect(page.getByTestId('p-calibration')).toContainText('2018 年全国时间利用调查');

  await page.getByTestId('portrait-tabs').getByText('个人').click();
  await page.getByTestId('p-pick').click();
  await expect(page.getByTestId('people')).toBeVisible();
  await page.getByTestId('people').locator('.person-row').first().click();
  await page.getByTestId('nav').getByText('画像').click();
  await page.getByTestId('portrait-tabs').getByText('个人').click();
  await expect(page.getByTestId('p-person')).toBeVisible();
  await expect(page.getByTestId('p-person').locator('.ring svg')).toBeVisible();
});

test('实验台：选案例、先猜、跑、看判定；找到受影响最大的人，再到那条世界线里看', async ({ page }) => {
  test.setTimeout(180_000);
  await ready(page, '?v=lab');
  await expect(page.getByTestId('lab')).toBeVisible();
  expect(await page.getByTestId('cases').locator('.case').count()).toBeGreaterThanOrEqual(6);
  await page.getByTestId('case-rain').click();
  // 测试里跑小一点：2 个种子、7 天
  await page.getByTestId('lab-seeds').fill('2');
  await page.getByTestId('lab-days').fill('7');
  await expect(page.getByTestId('iv-0')).toContainText('雨天');
  await expect(page.getByTestId('lab-run')).toContainText('不猜了');
  for (const id of ['P1', 'P2', 'P3', 'P4']) await page.getByTestId(`guess-pick-${id}`).getByText('会更低').click();
  await expect(page.getByTestId('lab-run')).toContainText('看猜得对不对');
  await page.getByTestId('lab-run').click();
  await expect(page.getByTestId('lab-result')).toBeVisible({ timeout: 120_000 });
  // 去公园的人次更少：猜对；去茶馆的人次：猜的是更低，实际更高，猜错
  await expect(page.getByTestId('verdict-P1')).toContainText('你猜对了');
  await expect(page.getByTestId('verdict-P1')).toContainText('支持');
  await expect(page.getByTestId('verdict-P2')).toContainText('你猜错了');
  await page.getByTestId('lab-all').click();
  expect(await page.getByTestId('lab-allmetrics').locator('tr').count()).toBeGreaterThan(5);

  const first = page.getByTestId('lab-affected').locator('.person-row').first();
  const name = (await first.locator('b').innerText()).trim();
  await first.click();
  await expect(page.getByTestId('micro')).toContainText(name);
  // 这一天要在两条世界线上各重算一遍，稍等
  await expect(page.getByTestId('micro').locator('.micro-line')).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByTestId('micro-nums')).toContainText('有这件事');
  await expect.poll(() => page.getByTestId('micro').locator('.seg-block').count(), { timeout: 60_000 }).toBeGreaterThan(8);

  await page.getByTestId('micro-open').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-view', 'world');
  await expect(page.getByTestId('app')).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 });
  await expect(page.getByTestId('iv-chip')).toContainText('有干预');
  await expect(page.getByTestId('person-name')).toHaveText(name, { timeout: 30_000 });
  await page.getByTestId('iv-clear').click();
  await expect(page.getByTestId('iv-chip')).toBeHidden();
});

test('实验台：自己搭一个；实验的链接能把同一份清单带到别处', async ({ page }) => {
  await ready(page, '?v=lab');
  await page.getByTestId('case-voucher').click();
  await page.getByTestId('iv-add-rent').click();
  await expect(page.getByTestId('iv-1')).toContainText('房租');
  await page.getByTestId('iv-remove-1').click();
  await page.getByTestId('iv-amount').fill('800');
  await expect(page.getByTestId('iv-0')).toContainText('800 元');
  await page.getByTestId('lab-days').fill('99');
  await expect(page.getByTestId('lab-run')).toBeDisabled();
  await page.getByTestId('lab-days').fill('9');
  await expect(page.getByTestId('lab-run')).toBeEnabled();
  // 链接：直接按同样的编码规则构造再打开
  const link = await page.evaluate(async () => {
    const m = await import('/src/share.ts');
    const p = await import('/src/lab/presets.ts');
    const x = p.CASES.find((c: { id: string }) => c.id === 'voucher')!.experiment;
    return m.experimentLink('', { ...x, days: 9, interventions: [{ kind: 'grant', amount: 800, day: 4 }] });
  });
  await page.goto(`/${link.replace('?v=lab', '?v=lab&q=low')}`);
  await expect(page.getByTestId('lab')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('iv-0')).toContainText('800 元');
  await expect(page.getByTestId('lab-days')).toHaveValue('9');
  await expect(page.getByTestId('lab-community')).toHaveValue('village');
});

test('多社区：四个配方可选，配方画像跟着变；进入后世界与画像都换了', async ({ page }) => {
  await ready(page);
  await page.getByTestId('community-open').click();
  await expect(page.getByTestId('community')).toBeVisible();
  expect(await page.getByTestId('packs').locator('.pack').count()).toBe(4);
  await expect(page.getByTestId('community-enter')).toBeDisabled();
  await page.getByTestId('pack-newtown').click();
  const before = await page.getByTestId('recipe').innerText();
  await page.getByTestId('spec-city').fill('0.2');
  await expect.poll(() => page.getByTestId('recipe').innerText()).not.toBe(before);
  await page.getByTestId('pack-factory').click();
  await expect(page.getByTestId('recipe')).toContainText('在本地上班');
  await page.getByTestId('community-enter').click();
  await expect(page.getByTestId('community')).toBeHidden();
  await expect(page.getByTestId('app')).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 });
  await expect(page.getByTestId('where')).toContainText('红星厂');
  await page.getByTestId('people-toggle').click();
  await page.getByTestId('people-search').fill('车间');
  expect(await page.getByTestId('people').locator('.person-row').count()).toBeGreaterThan(20);
  await page.getByTestId('nav').getByText('画像').click();
  await expect(page.getByTestId('portrait')).toContainText('红星厂的画像');

  // 链接也能直接打开某个社区
  await ready(page, '?c=village');
  await expect(page.getByTestId('where')).toContainText('塘尾村');
});

test('贴身视角：先选人；对话建镇与第二意见走假的网络', async ({ page }) => {
  let asked = 0;
  await page.route('https://openrouter.ai/**', async (route) => {
    const url = route.request().url();
    asked++;
    if (url.endsWith('/systemone')) {
      const body = route.request().postDataJSON() as { model: string; questions: { fit: { criteria: Record<string, string> } } };
      expect(body.model).toBe('typesafe/jev-1.13');
      const keys = Object.keys(body.questions.fit.criteria);
      return route.fulfill({ json: { answers: { fit: { choice: keys[0], probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 0.7 : 0.3 / Math.max(1, keys.length - 1)])) } }, usage: { input_tokens: 400, cost: 0.00002 } } });
    }
    return route.fulfill({ json: { choices: [{ message: { content: '{"template":"newtown","population":999,"cityShare":0.8,"secret":1}' } }], usage: { prompt_tokens: 300, completion_tokens: 30, cost: 0.0003 } } });
  });
  await ready(page, '?t=D02%2010:20');
  // 没选人时点“贴身”：打开名单，镜头不变
  await page.getByTestId('camera').getByText('贴身').click();
  await expect(page.getByTestId('people')).toBeVisible();
  await page.getByTestId('people-group').getByText('老人').click();
  const rows = page.getByTestId('people').locator('.person-row');
  let found = false;
  for (let i = 0; i < Math.min(12, await rows.count()) && !found; i++) {
    await rows.nth(i).click();
    found = await page.getByTestId('why-toggle').isVisible().catch(() => false);
  }
  expect(found).toBe(true);
  await page.getByTestId('camera').getByText('贴身').click();
  await expect(page.getByTestId('camera').locator('button.on')).toHaveText(/贴身/);

  // 第二意见：没有密钥时说明原因，不发请求
  await page.getByTestId('why-toggle').click();
  await page.getByTestId('second-ask').click();
  await expect(page.getByTestId('person-card').locator('.note')).toContainText('密钥');
  expect(asked).toBe(0);
  await page.getByTestId('settings-open').click();
  await page.getByTestId('key-input').fill(FAKE_KEY);
  await page.getByTestId('key-save').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('second-ask').click();
  await expect(page.getByTestId('second')).toContainText('模型');
  await expect(page.getByTestId('second')).toContainText('◀');
  await expect(page.getByTestId('second')).toContainText(/6\d%/);
  expect(asked).toBe(1);

  // 对话建镇：越界的值被拉回并说明，白名单外的字段不采用
  await page.getByTestId('community-open').click();
  await page.getByTestId('builder-input').fill('年轻人很多、白天都去城里上班的新小区');
  await page.getByTestId('builder-run').click();
  await expect(page.getByTestId('builder-notes')).toContainText('超出范围');
  await expect(page.getByTestId('builder-notes')).toContainText('没有采用的字段：secret');
  await expect(page.getByTestId('pack-newtown')).toHaveClass(/on/);
  await expect(page.getByTestId('spec-population')).toHaveValue('220');
  await page.getByTestId('community-enter').click();
  await expect(page.getByTestId('app')).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 });
  await expect(page.getByTestId('where')).toContainText('青禾苑');
});
