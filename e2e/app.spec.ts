import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = 'test-results/screens';
mkdirSync(SHOTS, { recursive: true });

let page: Page;
const errors: string[] = [];
const IGNORE = [/THREE\.Clock/, /Download the React DevTools/];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORE.some((r) => r.test(m.text()))) errors.push(`console: ${m.text()}`);
  });
});

test.afterAll(async () => {
  await page.close();
});

// 弹窗与抽屉有 0.15s 左右的渐显，截图前稍等
const shot = async (name: string) => {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
const clockText = () => page.getByTestId('clock-time').innerText();
const runId = () => page.evaluate(() => localStorage.getItem('microcity.run'));

/** 倍速、单步、快进、发布新闻都在顶栏的“更多”弹层里（v4） */
async function more() {
  if (!(await page.getByTestId('more-panel').isVisible())) await page.getByTestId('more-controls').click();
}

async function jump(to: string) {
  await more();
  await page.getByTestId('jump').selectOption(to);
  await expect(page.getByTestId('clock-time')).toHaveText(to, { timeout: 60_000 });
}

test('第一次打开：进入“设计”，模板与预览就绪；离线时对话建镇不可用', async () => {
  await page.goto('/');
  await expect(page.getByTestId('design')).toBeVisible();
  await expect(page.getByTestId('ws-design')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('minimap')).toBeVisible();
  await expect(page.getByTestId('town-stats')).toContainText('30');
  await expect(page.getByTestId('chat-input')).toBeDisabled();
  await expect(page.getByTestId('builder-chat')).toContainText('离线');
  await shot('01-design');
});

test('观察：经典小镇 30 位居民、城市画布有内容；播放、倍速、暂停、单步', async () => {
  await page.getByTestId('ws-observe').click();
  await expect(page.getByTestId('clock-time')).toHaveText('D01 06:00');
  await page.getByTestId('tab-people').click();
  await expect(page.locator('[data-testid^="agent-row-"]')).toHaveCount(30);
  await page.waitForTimeout(1200);
  const png = await page.getByTestId('city').screenshot();
  expect(png.byteLength, '城市画面不是空白').toBeGreaterThan(60_000);
  await more();
  await page.getByTestId('speed-1800').click();
  await page.getByTestId('play').click();
  await page.waitForTimeout(2500);
  expect(await clockText()).not.toBe('D01 06:00');
  await page.getByTestId('play').click();
  await page.waitForTimeout(400);
  const t2 = await clockText();
  await page.waitForTimeout(1200);
  expect(await clockText()).toBe(t2);
  await more();
  await page.getByTestId('step-10').click();
  await expect.poll(clockText).not.toBe(t2);
  await shot('02-observe');
});

test('快进到发布后：现场叙事出现“发布”与“第一个相信”，新闻列表有通知', async () => {
  await jump('D03 12:05');
  await page.getByTestId('tab-feed').click();
  await expect(page.getByTestId('beat-publish').first()).toBeVisible();
  await expect(page.getByTestId('beat-first_belief').first()).toBeVisible();
  await page.getByTestId('tab-news').click();
  await expect(page.getByTestId('news-N001')).toBeVisible();
  await page.getByTestId('tab-feed').click();
  await shot('03-feed');
});

test('人物卡：此刻、想法、相信什么；完整档案抽屉六个标签都有内容', async () => {
  await page.getByTestId('tab-people').click();
  await page.getByTestId('agent-row-a01').click();
  await expect(page.getByTestId('person-panel')).toBeVisible();
  await expect(page.getByTestId('insp-name')).toHaveText('周旻');
  await expect(page.getByTestId('thought')).toContainText('“');
  await shot('04-person');
  await page.getByTestId('open-profile').click();
  await expect(page.getByTestId('profile-drawer')).toBeVisible();
  await expect(page.getByTestId('profile-name')).toHaveText('周旻');
  for (const t of ['mind', 'memory', 'relations', 'decisions', 'timeline', 'overview'] as const) {
    await page.getByTestId(`tab-${t}`).click();
    await expect(page.getByTestId(`insp-${t}`)).toBeVisible({ timeout: 10_000 });
  }
  await page.getByTestId('tab-mind').click();
  await expect(page.getByTestId('evidence-chain')).toBeVisible();
  await shot('05-profile');
  await page.getByTestId('profile-close').click();
  await expect(page.getByTestId('profile-drawer')).toBeHidden();
});

test('决策详情：候选、因子来源、概率与随机抽样都可见', async () => {
  const decisions = await (await page.request.get(`/api/runs/${await runId()}/decisions`)).json();
  const reaction = decisions.find((d: { kind: string }) => d.kind === 'reaction');
  expect(reaction, '停电消息发布后应有人做过“怎么应对”的决定').toBeTruthy();
  await page.getByTestId('insp-close').click();
  await page.getByTestId('agent-row-' + reaction.agent).click();
  await page.getByTestId('open-profile').click();
  await page.getByTestId('tab-decisions').click();
  await page.getByTestId(`decision-${reaction.id}`).click();
  const modal = page.getByTestId('decision-modal');
  await expect(modal).toBeVisible();
  await expect(modal.getByTestId('candidates-table').locator('tbody tr')).not.toHaveCount(0);
  await expect(modal).toContainText('非内部推理');
  await shot('06-decision');
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

test('版本血缘：发布版与转述版都在树里', async () => {
  await page.getByTestId('tab-news').click();
  await page.getByTestId('lineage-N001').click();
  const m = page.getByTestId('lineage-modal');
  await expect(m).toBeVisible();
  expect(await m.locator('.lin-node').count()).toBeGreaterThanOrEqual(2);
  await shot('07-lineage');
  await page.getByTestId('lineage-modal-close').click();
});

test('发布新闻：校验、预设、发布后标记为干预', async () => {
  await more();
  await page.getByTestId('open-news').click();
  const ed = page.getByTestId('news-editor');
  await expect(ed).toBeVisible();
  await page.getByTestId('news-submit').click();
  await expect(page.getByTestId('news-error')).toContainText('标题');
  await page.getByTestId('preset-road').click();
  await expect(page.getByTestId('preview-headline')).toContainText('南区');
  await page.getByTestId('news-submit').click();
  await expect(ed).toBeHidden();
  await expect(page.getByTestId('toast').first()).toContainText('已发布');
  await page.getByTestId('tab-news').click();
  await expect(page.locator('[data-testid^="news-A"]').first()).toContainText('干预');
});

test('停电当天：北区挂出“停电中”，被停电影响的人可以筛出来', async () => {
  await page.getByTestId('tab-people').click();
  await jump('D04 14:30');
  await expect(page.getByTestId('outage-banner')).toBeVisible();
  await page.getByTestId('people-filter').selectOption('hit');
  await expect(page.locator('[data-testid^="agent-row-"]').first()).toBeVisible();
  await page.getByTestId('people-filter').selectOption('all');
  await page.getByTestId('toggle-roofs').click();
  await page.waitForTimeout(600);
  await shot('08-outage');
  await page.getByTestId('toggle-roofs').click();
});

test('章节条：点过去回到当时（只读），再返回实时；明细车道可切换', async () => {
  const bar = page.getByTestId('timeline-canvas');
  const box = (await bar.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.6);
  await expect(page.getByTestId('history-banner')).toBeVisible();
  await shot('09-history');
  await page.getByTestId('back-live').click();
  await expect(page.getByTestId('history-banner')).toBeHidden();
  await page.getByTestId('tl-detail').click();
  await expect(page.getByTestId('tl-range')).toBeVisible();
  await page.getByTestId('tl-chapters').click();
  await expect(page.getByTestId('scrubber')).toBeVisible();
});

test('复盘·反应墙：每人一张卡、与发布前相比的变化高亮；点卡片看轨迹', async () => {
  await jump('D04 16:10');
  await page.getByTestId('ws-review').click();
  await expect(page.getByTestId('wall')).toBeVisible();
  await expect(page.locator('[data-testid^="card-a"]')).toHaveCount(30);
  await expect(page.locator('.wall-card.changed').first()).toBeVisible();
  await expect(page.getByTestId('stage-summary')).toContainText('相信');
  await shot('10-wall');
  await page.getByTestId('only-changed').click();
  expect(await page.locator('.wall-card').count()).toBeLessThanOrEqual(30);
  await page.getByTestId('only-changed').click();
  await page.getByTestId('card-a01').click();
  await expect(page.getByTestId('trajectory')).toBeVisible();
  await expect(page.getByTestId('trajectory-name')).toHaveText('周旻');
  await expect(page.getByTestId('trajectory-steps').locator('li')).not.toHaveCount(0);
  await shot('11-trajectory');
  await page.getByTestId('trajectory-close').click();
  // 回看某个关键时刻：时间刷跳到上一个章节；连续往回跳不能停在原地，再往前跳能回到刚才那一刻
  await page.getByTestId('chapter-prev').click();
  await expect(page.getByTestId('review-time')).not.toHaveText('D04 16:10');
  const first = await page.getByTestId('review-time').innerText();
  await page.getByTestId('chapter-prev').click();
  await expect(page.getByTestId('review-time')).not.toHaveText(first);
  await page.getByTestId('chapter-next').click();
  await expect(page.getByTestId('review-time')).toHaveText(first);
  await page.getByTestId('review-now').click();
  await expect(page.getByTestId('review-time')).toHaveText(/D04 16:1/);
});

test('复盘·社会：信念构成与信任曲线、谁告诉了谁、漏斗', async () => {
  await page.getByTestId('tab-society').click();
  await expect(page.getByTestId('kpis')).toBeVisible();
  await expect(page.getByTestId('chart-beliefs').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('chart-trust').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('network').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('social-change')).toContainText('对官方信任');
  await expect(page.getByTestId('funnel-exposed').locator('.funnel-n')).not.toHaveText('0');
  await shot('12-society');
});

test('复盘·报告（离线）：由事实表生成模板报告，引用可以展开', async () => {
  await page.getByTestId('tab-report').click();
  await page.getByTestId('report-make').click();
  const body = page.getByTestId('report-body');
  await expect(body).toBeVisible({ timeout: 30_000 });
  await expect(body).toContainText('模板报告');
  await body.locator('.cite').first().click();
  await expect(page.getByTestId('fact-pop')).toBeVisible();
  await shot('13-report');
});

test('复盘·对照：5 个随机种子 × A/B/C/D，分布与配对比较；能在城市里打开分支', async () => {
  await page.getByTestId('tab-compare').click();
  await expect(page.getByTestId('experiment-new')).toBeVisible();
  await page.getByTestId('exp-seeds-5').click();
  await page.getByTestId('exp-provider-rule').click();
  await page.getByTestId('exp-start').click();
  const cmp = page.getByTestId('compare');
  await expect(cmp).toBeVisible({ timeout: 90_000 });
  await expect(cmp).toContainText('分叉前状态哈希一致');
  await expect(cmp).toContainText('5 个随机种子');
  await expect(page.getByTestId('cmp-C-t50')).toContainText('vs A');
  await shot('14-compare');
  await page.getByTestId('open-branch-A').click();
  await expect(page.getByTestId('run-picker')).toContainText('分支 A', { timeout: 15_000 });
  await expect(page.getByTestId('observe')).toBeVisible();
});

test('设计：换成“老城区”模板、调参数、加一轮停电，再开始观察', async () => {
  await page.getByTestId('ws-design').click();
  await page.getByTestId('preset-select').selectOption('oldtown');
  await expect(page.getByTestId('town-stats')).toContainText('40', { timeout: 10_000 });
  await page.getByTestId('event-add').click();
  await expect(page.getByTestId('event-1')).toBeVisible();
  await page.locator('.spec-details summary').click();
  await page.getByTestId('spec-push').fill('0.1');
  await expect(page.locator('[data-testid="msg-assistant"]').last()).toContainText('订阅推送', { timeout: 10_000 });
  await shot('15-design-oldtown');
  await page.getByTestId('launch-run').click();
  await expect(page.getByTestId('observe')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('run-picker')).toContainText('老城区');
  await page.getByTestId('tab-people').click();
  await expect(page.locator('[data-testid^="agent-row-"]')).toHaveCount(40);
  await page.waitForTimeout(1200);
  await shot('16-oldtown-observe');
});

test('诊断：重放校验，初始状态 + 事件日志重建出同一哈希', async () => {
  await more();
  await page.getByTestId('step-10').click();
  await page.getByTestId('open-diagnostics').click();
  await page.getByTestId('replay-check').click();
  await expect(page.getByTestId('replay-result')).toContainText('一致', { timeout: 30_000 });
  await page.keyboard.press('Escape');
});

test('重连后前端重建的状态与服务端逐字节一致（同构 reducer）', async () => {
  const { contentHash } = await import('@microcity/sim');
  await page.reload();
  await expect(page.getByTestId('conn')).toContainText('在线');
  const id = await runId();
  await page.request.post(`/api/runs/${id}/control`, { data: { op: 'pause' } });
  await page.request.post(`/api/runs/${id}/control`, { data: { op: 'step', step: '10min' } });
  await page.waitForTimeout(800);
  const server = await (await page.request.get(`/api/runs/${id}/state`)).json();
  const client = await page.evaluate(() => (window as unknown as { __microcity: { stateHash: () => { seq: number; hash: string } } }).__microcity.stateHash());
  expect(client.seq).toBe(server.seq);
  expect(client.hash).toBe(contentHash(server.state));
});

test('帮助与快捷键', async () => {
  await page.keyboard.press('?');
  await expect(page.getByTestId('help-modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('help-modal')).toBeHidden();
  await page.keyboard.press('r');
  await expect(page.getByTestId('review')).toBeVisible();
  await page.keyboard.press('o');
  await expect(page.getByTestId('observe')).toBeVisible();
});

test('实验广场：先猜再揭晓；在这里重跑，看结果时预测已自动判定；复制并修改打开实验清单', async () => {
  await page.getByTestId('ws-gallery').click();
  await expect(page.getByTestId('gallery')).toBeVisible();
  await expect(page.getByTestId('gallery-telephone')).toBeVisible();
  await expect(page.getByTestId('answer-telephone')).toHaveCount(0);
  await page.getByTestId('guess-telephone-2').click();
  await expect(page.getByTestId('answer-telephone')).toContainText('猜对了');
  await shot('20-gallery');
  await page.getByTestId('gallery-run-telephone').click();
  await page.getByTestId('gallery-open-telephone').click({ timeout: 120_000 });
  await expect(page.getByTestId('compare')).toBeVisible({ timeout: 30_000 });
  const preds = page.getByTestId('predictions');
  await expect(preds).toBeVisible();
  await expect(preds.locator('.pred-row')).toHaveCount(2);
  await expect(preds).not.toContainText('待判定');
  await shot('21-gallery-result');
  await page.getByTestId('exp-copy').click();
  await expect(page.getByTestId('manifest-editor')).toBeVisible();
  const text = await page.getByTestId('manifest-json').inputValue();
  expect(JSON.parse(text).predictions).toHaveLength(2);
  await page.getByTestId('manifest-json').fill('{ 这不是 JSON');
  await page.getByTestId('manifest-start').click();
  await expect(page.getByTestId('manifest-error')).toContainText('JSON');
  await page.getByTestId('manifest-editor-close').click();
});

test('全程没有页面错误', async () => {
  expect(errors).toEqual([]);
});
