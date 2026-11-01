import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// 生成模型路径的夹具测试：假密钥 + 假 fetch，不花钱
process.env.OPENROUTER_API_KEY = 'sk-or-test-fixture';
process.env.MICROCITY_OFFLINE = '';
const { Store } = await import('../src/db.ts');
const { RunManager } = await import('../src/runs.ts');
const { buildApi, makeServices } = await import('../src/api.ts');
const { validateReport, templateReport } = await import('../src/report.ts');
const { validateMonologue } = await import('../src/providers/monologue.ts');
const sim = await import('@microcity/sim');

const json = <T = any>(r: { body: string }) => JSON.parse(r.body) as T;
function chatResponse(content: unknown, cost = 0.0002) {
  const body = { model: 'deepseek/deepseek-v4-flash-20260901', choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }], usage: { cost } };
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as unknown as Response;
}

let runs: InstanceType<typeof RunManager>;
let app: Awaited<ReturnType<typeof buildApi>>;
let runId = '';

beforeAll(async () => {
  runs = new RunManager(new Store(':memory:'));
  app = await buildApi(runs, makeServices(runs));
  runId = runs.create({ seed: 42, provider: 'rule' }).id;
  await runs.get(runId)!.runHeadless(sim.parseTime('D04 20:00'));
});
afterEach(() => vi.unstubAllGlobals());

describe('对话建镇（夹具）', () => {
  it('模型给出补丁：白名单合并、越界夹回、未知字段忽略，并记账', async () => {
    const s = json(await app.inject({ method: 'POST', url: '/api/builder/sessions', payload: { preset: 'oldtown' } }));
    expect(s.modelAccess).toBe(true);
    const fetchMock = vi.fn(async () => chatResponse({ reply: '好的，把人口加到 45，老人比例调高。', patch: { population: { size: 45, seniors: 0.9 }, media: { push: 0.05 }, weather: 'rain' }, suggestions: ['再加一轮南区停电'] }));
    vi.stubGlobal('fetch', fetchMock);
    const r = json(await app.inject({ method: 'POST', url: `/api/builder/sessions/${s.id}/messages`, payload: { text: '人再多点，老人更多，几乎没人订推送' } }));
    expect(r.reply.source).toBe('model');
    expect(r.spec.population.size).toBe(45);
    expect(r.spec.population.seniors).toBe(0.6);
    expect(r.spec.media.push).toBe(0.05);
    expect(r.reply.warnings.join('')).toContain('weather');
    expect(r.reply.warnings.join('')).toContain('老人比例');
    expect(r.reply.changes.join('')).toContain('人口');
    expect(r.preview.stats.population).toBe(45);
    // 请求里带着模板规则与当前规格
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.messages[0].content).toContain('TownSpec');
    expect(body.response_format.type).toBe('json_object');
    const call = runs.store.db.prepare("SELECT * FROM model_calls WHERE purpose = 'builder'").get() as { cost_usd: number };
    expect(call.cost_usd).toBeGreaterThan(0);
  });

  it('模型输出不是 JSON：规格不变，回复说明没拿到修改', async () => {
    const s = json(await app.inject({ method: 'POST', url: '/api/builder/sessions', payload: { preset: 'newtown' } }));
    vi.stubGlobal('fetch', vi.fn(async () => chatResponse('这不是 JSON')));
    const r = json(await app.inject({ method: 'POST', url: `/api/builder/sessions/${s.id}/messages`, payload: { text: '随便改改' } }));
    expect(r.reply.source).toBe('error');
    expect(r.spec).toEqual(s.spec);
  });
});

describe('实验报告（夹具）', () => {
  it('模型只复述事实表：通过校验就用模型报告', async () => {
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const req = JSON.parse(init.body);
      const facts = JSON.parse(req.messages[1].content) as { groups: Array<{ 类别: string; 事实: Array<{ id: string; text: string }> }> };
      const all = facts.groups.flatMap((g) => g.事实);
      const outcome = facts.groups.find((g) => g.类别 === '结果')!.事实;
      const soc = facts.groups.find((g) => g.类别 === '社会形态')!.事实;
      return chatResponse({
        title: '北区停电通知实验',
        summary: outcome[0]!.text.slice(0, 100),
        findings: outcome.slice(0, 3).map((f) => ({ text: f.text.slice(0, 80), cites: [f.id] })),
        stories: [],
        socialChange: { text: soc[0]!.text, cites: [soc[0]!.id] },
        caveats: [all.at(-1)!.text.slice(0, 60)],
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = json(await app.inject({ method: 'POST', url: `/api/runs/${runId}/report`, payload: { force: true } }));
    expect(r.source).toBe('model');
    expect(r.validation.ok).toBe(true);
    expect(r.report.findings.length).toBe(3);
    expect(r.cost).toBeGreaterThan(0);
  });

  it('编造数字：重试一次仍不过就回退到模板报告，并记下问题', async () => {
    const fetchMock = vi.fn(async () => chatResponse({ title: '报告', summary: '有 37.5% 的人在 15:42 知道了。', findings: [{ text: '全镇 99 人都信了', cites: ['F1'] }, { text: '一切正常', cites: ['F999'] }], stories: [], socialChange: { text: '无', cites: ['F1'] }, caveats: ['合成'] }));
    vi.stubGlobal('fetch', fetchMock);
    const r = json(await app.inject({ method: 'POST', url: `/api/runs/${runId}/report`, payload: { force: true } }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.source).toBe('template');
    expect(r.validation.ok).toBe(false);
    expect(r.validation.attempts).toBe(2);
    expect(r.validation.problems.join('')).toMatch(/37\.5|15:42|99|F999/);
  });

  it('校验器单测：模板报告自身一定能通过校验', async () => {
    const { runFacts } = await import('../src/report.ts');
    const svc = makeServices(runs);
    const facts = runFacts(runs, svc.analysis, runId);
    const t = templateReport(facts);
    const v = validateReport(t, facts);
    expect(v.problems).toEqual([]);
  });
});

describe('独白（夹具）', () => {
  it('编造时刻被拒、回退模板；只复述事实就采用', async () => {
    expect(validateMonologue('下午 3:30 就停了', '相信「北区周四下午停电」')).not.toEqual([]);
    expect(validateMonologue('听说要停一整天', '相信「北区周四下午停电」')).not.toEqual([]);
    expect(validateMonologue('周四下午停电，我改去图书馆了', '相信「北区周四下午停电」 改了安排：去图书馆办公')).toEqual([]);
    vi.stubGlobal('fetch', vi.fn(async () => chatResponse({ text: '周四 15:30 停电，我得早点走。' })));
    const bad = json(await app.inject({ method: 'POST', url: `/api/runs/${runId}/agents/a02/monologue`, payload: {} }));
    expect(bad.source).toBe('template');
    vi.stubGlobal('fetch', vi.fn(async () => chatResponse({ text: '唉，停电那会儿店里照样忙，还好提前有准备。' })));
    const ok = json(await app.inject({ method: 'POST', url: `/api/runs/${runId}/agents/a02/monologue`, payload: {} }));
    expect(ok.source).toBe('model');
    expect(ok.text).toContain('提前');
  });
});
