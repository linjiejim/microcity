import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.MICROCITY_OFFLINE = '1';
const { Store } = await import('../src/db.ts');
const { RunManager } = await import('../src/runs.ts');
const { buildApi, makeServices } = await import('../src/api.ts');
const { config } = await import('../src/config.ts');
const { Gallery } = await import('../src/gallery.ts');
const { ExperimentRunner } = await import('../src/experiments.ts');
const sim = await import('@microcity/sim');

let app: FastifyInstance;
let runs: InstanceType<typeof RunManager>;

beforeAll(async () => {
  runs = new RunManager(new Store(':memory:'));
  app = await buildApi(runs, makeServices(runs));
});
afterAll(async () => {
  await app.close();
});

const json = <T = any>(r: { body: string }) => JSON.parse(r.body) as T;
async function waitExperiment(id: string): Promise<any> {
  let x: any;
  for (let i = 0; i < 1200; i++) {
    x = json(await app.inject({ method: 'GET', url: `/api/experiments/${id}` }));
    if (x.status !== 'running') return x;
    await new Promise((r) => setTimeout(r, 50));
  }
  return x;
}

describe('先猜再跑：预测与自动判定', () => {
  it('预测随实验一起跑，跑完逐 seed 配对判定；分支与指标都可读', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/experiments',
      payload: {
        manifest: {
          name: '推送快不快',
          question: '加推送能不能让人更早知道？',
          seeds: [3, 4],
          provider: 'rule',
          branches: { A: sim.DEFAULT_BRANCHES.A, C: sim.DEFAULT_BRANCHES.C },
          predictions: [
            { id: 'P1', text: '加推送后半数人更早相信', metric: 'E1.t50', a: 'C', b: 'A', expect: 'lower' },
            { id: 'P2', text: '措手不及差不多', metric: 'E1.surprisedPeople', a: 'C', b: 'A', expect: 'same', tolerance: 3 },
          ],
        },
      },
    });
    expect(r.statusCode).toBe(202);
    expect(json(r).manifest.question).toBe('加推送能不能让人更早知道？');
    const x = await waitExperiment(json(r).id);
    expect(x.status).toBe('done');
    const [p1, p2] = x.result.predictions;
    expect(p1).toMatchObject({ id: 'P1', verdict: '支持', n: 2 });
    expect(p1.lower).toBe(1);
    expect(p2.id).toBe('P2');
    expect(['支持', '不支持']).toContain(p2.verdict);
  });

  it('预测校验：不认识的指标、同一个分支、方向写错都拒绝', async () => {
    const base = { seeds: [1], branches: { A: sim.DEFAULT_BRANCHES.A, C: sim.DEFAULT_BRANCHES.C } };
    const bad = async (p: object) => json(await app.inject({ method: 'POST', url: '/api/experiments', payload: { manifest: { ...base, predictions: [{ text: 'x', ...p }] } } })).error as string;
    expect(await bad({ metric: 'E1.nope', a: 'A', b: 'C', expect: 'higher' })).toContain('指标');
    expect(await bad({ metric: 'E1.t50', a: 'A', b: 'A', expect: 'higher' })).toContain('两个不同的分支');
    expect(await bad({ metric: 'E1.t50', a: 'A', b: 'C', expect: 'bigger' })).toContain('方向');
    expect(await bad({ metric: 'E9.t50', a: 'A', b: 'C', expect: 'higher' })).toContain('指标');
  });

  it('分支的事件模式只接受 outage / false_alarm / absent', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/experiments', payload: { branches: { A: { label: '甲' }, B: { label: '乙', patches: [{ event: '$first', mode: 'maybe' }] } } } });
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toContain('事件模式');
  });
});

describe('演示站（公开模式）', () => {
  const saved = { mode: config.publicMode, limits: { ...config.publicLimits } };
  afterAll(() => {
    config.publicMode = saved.mode;
    Object.assign(config.publicLimits, saved.limits);
  });

  it('只开放规则模式、种子数有上限、每个 IP 每小时的次数有上限；健康检查说明限额', async () => {
    config.publicMode = true;
    Object.assign(config.publicLimits, { experimentsPerHour: 1, maxSeeds: 3 });
    const h = json(await app.inject({ method: 'GET', url: '/api/health' }));
    expect(h.public.limits.maxSeeds).toBe(3);
    expect(h.models.jevAllowed).toBe(false);
    const jev = await app.inject({ method: 'POST', url: '/api/runs', payload: { provider: 'jev' } });
    expect(jev.statusCode).toBe(403);
    const many = await app.inject({ method: 'POST', url: '/api/experiments', payload: { seeds: [1, 2, 3, 4] } });
    expect(many.statusCode).toBe(400);
    expect(json(many).error).toContain('最多 3 个');
    const first = await app.inject({ method: 'POST', url: '/api/experiments', payload: { seeds: [1] } });
    expect(first.statusCode).toBe(202);
    const second = await app.inject({ method: 'POST', url: '/api/experiments', payload: { seeds: [2] } });
    expect(second.statusCode).toBe(429);
    await waitExperiment(json(first).id);
    config.publicMode = false;
  });

  it('清理：过期的访客实验与运行连同落库的数据一起删掉，精选实验保留', async () => {
    const store = runs.store;
    const r = json(await app.inject({ method: 'POST', url: '/api/runs', payload: { seed: 9, provider: 'rule' } }));
    await app.inject({ method: 'POST', url: `/api/runs/${r.id}/control`, payload: { op: 'step', step: '10min' } });
    const fork = json(await app.inject({ method: 'POST', url: `/api/runs/${r.id}/fork`, payload: {} }));
    expect(store.getRun(fork.id)).toBeTruthy();
    const e = json(await app.inject({ method: 'POST', url: '/api/experiments', payload: { seeds: [5] } }));
    await waitExperiment(e.id);
    const expRuns = store.listRuns().filter((x) => x.experiment_id === e.id);
    expect(expRuns.length).toBeGreaterThan(0);
    store.insertExperiment('exp_gallery_keep', { id: 'gallery:x@v1', scenario: 'town30', seeds: [], branches: {} });
    config.publicMode = true;
    config.publicLimits.keepHours = -1;
    runs.housekeep();
    config.publicMode = false;
    expect(store.experiment(e.id)).toBeUndefined();
    for (const x of expRuns) expect(store.getRun(x.id)).toBeUndefined();
    expect(store.getRun(r.id)).toBeUndefined();
    expect(store.getRun(fork.id)).toBeUndefined();
    expect(store.events(r.id)).toHaveLength(0);
    expect(store.experiment('exp_gallery_keep')).toBeTruthy();
  });
});

describe('实验广场', () => {
  it('卡片带场景与状态；一键用规则模式跑，跑过就复用；预测随之判定', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-gallery-'));
    const spec = sim.generatedDefaults();
    spec.name = '测试镇';
    const entry = {
      id: 'demo',
      version: 1,
      title: '推送快不快',
      classic: '测试',
      question: '加推送能不能让人更早知道？',
      guess: { prompt: '半数人相信的时间会…', options: ['更早', '差不多', '更晚'], answer: 0, explain: '推送一发出去就有人看到。' },
      findings: [{ text: '加推送更快', rule: '支持', jev: '支持' }],
      spec,
      branches: { A: sim.DEFAULT_BRANCHES.A, C: sim.DEFAULT_BRANCHES.C },
      predictions: [{ id: 'P1', text: '加推送后半数人更早相信', metric: 'E1.t50', a: 'C', b: 'A', expect: 'lower' }],
      seeds: [1, 2],
    };
    const file = join(dir, 'gallery.json');
    writeFileSync(file, JSON.stringify({ entries: [entry] }));
    const g = new Gallery(runs, new ExperimentRunner(runs), file);
    const [card] = g.list();
    expect(card!.scenario).toMatch(/^sc_/);
    expect(card!.town).toEqual({ name: '测试镇', population: 30 });
    expect(card!.experiment).toBeNull();
    expect('spec' in card!).toBe(false);
    const started = g.run('demo')!;
    expect(g.run('demo')!.id).toBe(started.id);
    const x = await waitExperiment(started.id);
    expect(x.status).toBe('done');
    expect(x.manifest.id).toBe('gallery:demo@v1');
    expect(x.result.predictions[0].verdict).toBe('支持');
    expect(g.list()[0]!.experiment).toEqual({ id: started.id, status: 'done' });
    expect(g.run('nope')).toBeUndefined();
  });
});

describe('生产模式：服务端提供构建好的前端', () => {
  it('首页与深层路由回落到 index.html；带哈希的资源长缓存；接口仍是 404；路径穿越回到首页，畸形编码是 400', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-static-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>index</title>');
    writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
    const saved = config.staticDir;
    config.staticDir = dir;
    const web = await buildApi(runs, makeServices(runs));
    try {
      const home = await web.inject({ method: 'GET', url: '/' });
      expect(home.statusCode).toBe(200);
      expect(home.headers['content-type']).toContain('text/html');
      expect(home.headers['cache-control']).toBe('no-cache');
      expect(home.body).toContain('<title>index</title>');
      expect((await web.inject({ method: 'GET', url: '/review?ws=review' })).body).toContain('<title>index</title>');
      const js = await web.inject({ method: 'GET', url: '/assets/app-abc123.js' });
      expect(js.headers['content-type']).toContain('javascript');
      expect(js.headers['cache-control']).toContain('immutable');
      const api = await web.inject({ method: 'GET', url: '/api/nope' });
      expect(api.statusCode).toBe(404);
      expect(json(api)).toEqual({ error: 'not found' });
      expect((await web.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
      for (const url of ['/../package.json', '/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json']) {
        const r = await web.inject({ method: 'GET', url });
        expect(r.statusCode, url).toBe(200);
        expect(r.body, url).toContain('<title>index</title>');
      }
      // 畸形的百分号编码由路由直接拒绝（400），不会抛成 500
      expect((await web.inject({ method: 'GET', url: '/%E0%A4%A' })).statusCode).toBe(400);
      expect((await web.inject({ method: 'POST', url: '/somewhere' })).statusCode).toBe(404);
    } finally {
      config.staticDir = saved;
      await web.close();
    }
  });
});
