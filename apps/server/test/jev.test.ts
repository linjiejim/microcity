import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// 离线夹具测试：用假的 fetch；LIVE=1 时才真实调用一次
const LIVE = process.env.LIVE === '1';
if (!LIVE) {
  process.env.OPENROUTER_API_KEY = 'sk-or-test-fixture';
  process.env.MICROCITY_OFFLINE = '';
}
const { Store } = await import('../src/db.ts');
const { JevProvider, buildJevPayload } = await import('../src/providers/jev.ts');
const sim = await import('@microcity/sim');

let req: import('@microcity/sim').DecisionRequest;

beforeAll(() => {
  // 用内核真实产生的第一个 reaction 请求做夹具
  const e = sim.Engine.create(sim.town30(), { seed: 42, decisionMode: 'external' });
  for (let t = e.now; t < sim.parseTime('D03 12:00'); t += 600) {
    e.advance(t);
    const r = e.pendingRequests().find((x) => x.kind === 'reaction');
    if (r) {
      req = r;
      break;
    }
  }
  expect(req, '发布后应产生 reaction 请求').toBeTruthy();
});

afterEach(() => vi.unstubAllGlobals());

function fakeResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) } as unknown as Response;
}

describe.skipIf(LIVE)('Jev 适配（夹具）', () => {
  it('请求体：state 只含主观信息，问题含 choice/score/noul，候选映射为 o1..oN', () => {
    const { state, questions, optionIds } = buildJevPayload(req);
    expect(Object.keys(questions).sort()).toEqual(['concern', 'fit', 'verify_need']);
    const fit = questions.fit as { type: string; criteria: Record<string, string> };
    expect(fit.type).toBe('choice');
    expect(Object.keys(fit.criteria)).toEqual(req.candidates.map((_, i) => `o${i + 1}`));
    expect(optionIds).toEqual(req.candidates.map((c) => c.id));
    const s = JSON.stringify(state);
    expect(s).not.toContain('powered'); // 不含世界真相
    expect(s).toContain(req.observation.person.name);
  });

  it('答案映射：choice 概率 → 候选 fit（归一化），score → concern，noul → verify_need；相同请求第二次命中缓存', async () => {
    const store = new Store(':memory:');
    const jev = new JevProvider(store);
    const probs = Object.fromEntries(req.candidates.map((_, i) => [`o${i + 1}`, i === 0 ? 0.7 : 0.3 / (req.candidates.length - 1)]));
    const fetchMock = vi.fn(async () => fakeResponse({ model: 'typesafe/jev-1.13-20260917', answers: { fit: { type: 'choice', probabilities: probs }, concern: { type: 'score', score: 3 }, verify_need: { type: 'noul', noul: 0.8 } }, usage: { cost: 0.00003 } }));
    vi.stubGlobal('fetch', fetchMock);
    const a = await jev.answer(req, 'run_x');
    expect(a.provider).toBe('jev');
    expect(a.fallback).toBeUndefined();
    expect(a.concern).toBe(0.75);
    expect(a.verifyNeed).toBe(0.8);
    const fits = Object.values(a.fit!);
    expect(fits.reduce((x, y) => x + y, 0)).toBeGreaterThan(0.98);
    expect(a.fit![req.candidates[0]!.id]).toBeGreaterThan(0.6);
    const b = await jev.answer(req, 'run_x');
    expect(b.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.callStats('run_x')).toMatchObject({ calls: 2, cached: 1, errors: 0 });
  });

  it('失败回退：HTTP 500 → 规则因子 + fallback 标记，且记入调用日志', async () => {
    const store = new Store(':memory:');
    const jev = new JevProvider(store);
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({ error: { message: 'boom' } }, 500)));
    const a = await jev.answer(req, 'run_y');
    expect(a.fallback).toBe('error');
    expect(a.fit).toEqual(req.semanticRule.fit);
    expect(store.callStats('run_y').errors).toBe(1);
  });

  it('预算闸：本运行花费到上限后不再请求，直接回退', async () => {
    const store = new Store(':memory:');
    store.logModelCall({ id: 'seed', run_id: 'run_z', provider: 'jev', model: 'm', purpose: 'reaction', cache_key: 'k', request: '{}', response: null, cost_usd: 10, latency_ms: 1, cached: 0, error: null });
    const jev = new JevProvider(store);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const a = await jev.answer(req, 'run_z', { bypassCache: true });
    expect(a.fallback).toMatch(/budget/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe.runIf(LIVE)('Jev 真实冒烟（LIVE=1）', () => {
  it('经 OpenRouter 调用 typesafe/jev-1.13 一次并解析出三类因子', async () => {
    const store = new Store(':memory:');
    const a = await new JevProvider(store).answer(req, 'live', { bypassCache: true });
    expect(a.fallback).toBeUndefined();
    expect(a.model).toMatch(/jev/);
    expect(Object.keys(a.fit ?? {})).toHaveLength(req.candidates.length);
    expect(a.concern).toBeGreaterThanOrEqual(0);
    expect(a.verifyNeed).toBeGreaterThanOrEqual(0);
  });
});
