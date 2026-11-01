import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.MICROCITY_OFFLINE = '1';
const { Store } = await import('../src/db.ts');
const { RunManager } = await import('../src/runs.ts');
const { buildApi } = await import('../src/api.ts');
const sim = await import('@microcity/sim');

let app: FastifyInstance;
let runs: InstanceType<typeof RunManager>;

beforeAll(async () => {
  runs = new RunManager(new Store(':memory:'));
  app = await buildApi(runs);
});
afterAll(async () => {
  await app.close();
});

const json = <T = any>(r: { body: string }) => JSON.parse(r.body) as T;

describe('运行生命周期', () => {
  let id = '';
  it('健康检查：离线模式下模型访问关闭', async () => {
    const r = json(await app.inject({ method: 'GET', url: '/api/health' }));
    expect(r.ok).toBe(true);
    expect(r.models.access).toBe(false);
  });
  it('新建运行：暂停在 D01 06:00；同一幂等键不重复创建', async () => {
    const payload = { seed: 42, provider: 'rule', idempotencyKey: 'k-create-1' };
    const a = await app.inject({ method: 'POST', url: '/api/runs', payload });
    const b = await app.inject({ method: 'POST', url: '/api/runs', payload });
    expect(a.statusCode).toBe(201);
    expect(json(a).id).toBe(json(b).id);
    id = json(a).id;
    expect(json(a).paused).toBe(true);
    expect(sim.formatTime(json(a).t)).toBe('D01 06:00');
  });
  it('单步 10 分钟：时间推进，事件落库', async () => {
    const r = json(await app.inject({ method: 'POST', url: `/api/runs/${id}/control`, payload: { op: 'step', step: '10min' } }));
    expect(sim.formatTime(r.t)).toBe('D01 06:10');
    const evs = json<any[]>(await app.inject({ method: 'GET', url: `/api/runs/${id}/events?limit=50` }));
    expect(evs[0].type).toBe('run_started');
    expect(evs.length).toBeGreaterThan(30);
  });
  it('全速跑到 D04 20:00：指标、检查器、决策详情、血缘、重放校验都可用', async () => {
    const run = runs.get(id)!;
    await run.runHeadless(sim.parseTime('D04 20:00'));
    const m = json(await app.inject({ method: 'GET', url: `/api/runs/${id}/metrics` }));
    expect(m.funnel.stages.believed).toBeGreaterThan(10);
    expect(m.outcome.inconvenienceItems).toBeGreaterThan(0);
    const insp = json(await app.inject({ method: 'GET', url: `/api/runs/${id}/agents/a02` }));
    expect(insp.agent.name).toBe('林澄');
    expect(insp.timeline.length).toBeGreaterThan(20);
    expect(insp.relations.length).toBeGreaterThan(2);
    const all = json<any[]>(await app.inject({ method: 'GET', url: `/api/runs/${id}/decisions` }));
    expect(all.length).toBeGreaterThan(5);
    const d = json(await app.inject({ method: 'GET', url: `/api/runs/${id}/decisions/${all[0].id}` }));
    expect(d.record.candidates.length).toBeGreaterThan(0);
    const lin = json(await app.inject({ method: 'GET', url: `/api/runs/${id}/families/${sim.OUTAGE_FAMILY}/lineage` }));
    expect(lin.versions.length).toBeGreaterThan(2);
    expect(lin.transmissions.length).toBeGreaterThan(5);
    const rc = json(await app.inject({ method: 'GET', url: `/api/runs/${id}/replay-check` }));
    expect(rc.ok).toBe(true);
    expect(rc.checkpoints.every((c: { ok: boolean }) => c.ok)).toBe(true);
  });
  it('历史状态：取分叉前某一刻的状态（只读回放）', async () => {
    const evs = json<any[]>(await app.inject({ method: 'GET', url: `/api/runs/${id}/events?types=news_published` }));
    const seq = evs[0].seq - 1;
    const h = json(await app.inject({ method: 'GET', url: `/api/runs/${id}/state?seq=${seq}` }));
    expect(h.historical).toBe(true);
    expect(h.state.meta.seq).toBe(seq);
    expect(Object.keys(h.state.news)).toHaveLength(0);
  });
  it('管理员发布新闻：校验、标记为干预、立即推送', async () => {
    const badReq = await app.inject({ method: 'POST', url: `/api/runs/${id}/news`, payload: { headline: '', body: 'x', slots: { event: 'x' }, channels: ['push'] } });
    expect(badReq.statusCode).toBe(400);
    const noChan = await app.inject({ method: 'POST', url: `/api/runs/${id}/news`, payload: { headline: '南街周六封路', body: '南街周六全天封路施工', slots: { event: '封路', area: 'south', day: 6 }, channels: [] } });
    expect(noChan.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: `/api/runs/${id}/news`, payload: { headline: '南街周六封路', body: '南街周六全天封路施工', slots: { event: '封路', area: 'south', day: 6, window: { kind: 'all_day' } }, channels: ['push', 'website'], idempotencyKey: 'n1' } });
    expect(ok.statusCode).toBe(201);
    const again = await app.inject({ method: 'POST', url: `/api/runs/${id}/news`, payload: { headline: '南街周六封路', body: '南街周六全天封路施工', slots: { event: '封路', area: 'south', day: 6 }, channels: ['push'], idempotencyKey: 'n1' } });
    expect(json(again).id).toBe(json(ok).id);
    const news = json<any[]>(await app.inject({ method: 'GET', url: `/api/runs/${id}/news` }));
    const mine = news.find((n) => n.id === json(ok).id);
    expect(mine.intervention).toBe(true);
    const ev = json<any[]>(await app.inject({ method: 'GET', url: `/api/runs/${id}/events?types=intervention` }));
    expect(ev.some((e) => e.by === 'admin')).toBe(true);
  });
  it('对话台词：离线时回退到模板，且不超出交换的事实', async () => {
    const convs = json<any[]>(await app.inject({ method: 'GET', url: `/api/runs/${id}/events?types=conversation&limit=20000` }));
    const c = convs.find((x) => x.topic === 'news');
    const d = json(await app.inject({ method: 'GET', url: `/api/runs/${id}/dialogues/${c.id}` }));
    expect(d.lines.length).toBeGreaterThanOrEqual(2);
    expect(d.model).toBe('template');
  });
  it('分叉：从 D03 08:00 之前的快照复制，历史沿父链拼接', async () => {
    const f = await app.inject({ method: 'POST', url: `/api/runs/${id}/fork`, payload: { at: 'D03 08:00', branch: sim.DEFAULT_BRANCHES.A } });
    expect(f.statusCode).toBe(201);
    const fid = json(f).id;
    expect(json(f).t).toBeLessThanOrEqual(sim.parseTime('D03 08:00'));
    const hist = json<any[]>(await app.inject({ method: 'GET', url: `/api/runs/${fid}/events?limit=20000` }));
    expect(hist[0].type).toBe('run_started');
    await runs.get(fid)!.runHeadless(sim.parseTime('D04 20:00'));
    const pub = json<any[]>(await app.inject({ method: 'GET', url: `/api/runs/${fid}/events?types=news_published` }));
    expect(pub.at(-1).news.channels).toEqual(['website']);
    const rc = json(await app.inject({ method: 'GET', url: `/api/runs/${fid}/replay-check` }));
    expect(rc.ok).toBe(true);
  });
});

describe('台词校验', () => {
  it('生成的台词不得超出交换的事实：多出的时刻、凭空的“全天”、陌生说话人都判无效', async () => {
    const { validateLines } = await import('../src/providers/dialogue.ts');
    const facts = ['北区周四下午停电（政务中心说的）'];
    const ps = ['a01', 'a30'];
    expect(validateLines([{ speaker: 'a30', text: '爸，北区周四下午要停电。' }, { speaker: 'a01', text: '好，知道了。' }], facts, ps)).toBe(true);
    expect(validateLines([{ speaker: 'a30', text: '爸，周四 14:00 要停电。' }], facts, ps)).toBe(false);
    expect(validateLines([{ speaker: 'a30', text: '听说要停一整天！' }], facts, ps)).toBe(false);
    expect(validateLines([{ speaker: 'a99', text: '你好' }], facts, ps)).toBe(false);
    expect(validateLines([{ speaker: 'a30', text: '周四 14:00–16:00 停电。' }], ['北区周四 14:00–16:00 停电'], ps)).toBe(true);
    expect(validateLines([{ speaker: 'a30', text: '听说下午两点到四点停电。' }], facts, ps)).toBe(false);
    expect(validateLines([{ speaker: 'a30', text: '下午两点到四点停电。' }], ['北区周四 14:00–16:00 停电'], ps)).toBe(true);
  });
});

describe('实验：多 seed 对照', () => {
  it('默认 A/B/C/D：同一分叉点、单 seed 给出每个分支的指标', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/experiments', payload: { seed: 7, provider: 'rule' } });
    expect(r.statusCode).toBe(202);
    const id = json(r).id;
    let x: any;
    for (let i = 0; i < 400; i++) {
      x = json(await app.inject({ method: 'GET', url: `/api/experiments/${id}` }));
      if (x.status !== 'running') break;
      await new Promise((res) => setTimeout(res, 50));
    }
    expect(x.status).toBe('done');
    expect(Object.keys(x.result.branches)).toEqual(['A', 'B', 'C', 'D']);
    for (const b of Object.values<any>(x.result.branches)) {
      expect(b.runId).toMatch(/^run_/);
      expect(b.perSeed).toHaveLength(1);
      expect(b.perSeed[0].outages.E1.aware).toBeGreaterThan(0);
    }
    expect(x.result.stats.A['E1.t50'].median ?? Infinity).toBeGreaterThan(x.result.stats.C['E1.t50'].median);
  });

  it('3 个 seed：分布统计与相对参照分支的逐 seed 配对', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/experiments', payload: { seeds: [42, 7, 2026], provider: 'rule' } });
    const id = json(r).id;
    let x: any;
    for (let i = 0; i < 600; i++) {
      x = json(await app.inject({ method: 'GET', url: `/api/experiments/${id}` }));
      if (x.status !== 'running') break;
      await new Promise((res) => setTimeout(res, 50));
    }
    expect(x.status).toBe('done');
    expect(x.result.seeds).toEqual([42, 7, 2026]);
    const s = x.result.stats.C['E1.surprisedPeople'];
    expect(s.n).toBe(3);
    expect(s.values).toHaveLength(3);
    const p = x.result.paired.C['E1.t50'];
    expect(p.better + p.worse + p.same).toBe(3);
    expect(x.result.paired.A).toEqual({});
  });

  it('参数分支共用分叉点、换镇分支从头跑；结果写明每个分支改了什么', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/experiments',
      payload: {
        seeds: [3, 4],
        provider: 'rule',
        params: { trust: { scale: 2 } },
        branches: {
          A: { label: '原样' },
          B: { label: '少提起', params: { mention: { intercept: -5 } } },
          C: { label: '低信任镇', town: { culture: { trustGov: 0.3 } } },
        },
      },
    });
    expect(r.statusCode).toBe(202);
    const id = json(r).id;
    let x: any;
    for (let i = 0; i < 800; i++) {
      x = json(await app.inject({ method: 'GET', url: `/api/experiments/${id}` }));
      if (x.status !== 'running') break;
      await new Promise((res) => setTimeout(res, 50));
    }
    expect(x.status).toBe('done');
    expect(x.manifest.params).toEqual({ trust: { scale: 2 } });
    const b = x.result.branches;
    expect(b.A.scenario).toBe('town30');
    expect(b.B.changes).toEqual(['mention.intercept = -5']);
    expect(b.C.scenario).toMatch(/^sc_/);
    expect(b.C.changes).toEqual(['对官方的信任 0.3']);
    expect(x.result.stats.B['E1.versions'].median).toBeLessThan(x.result.stats.A['E1.versions'].median);
    for (const k of ['A', 'B', 'C']) expect(b[k].perSeed[0].outages.E1).toHaveProperty('allDayEver');
    const run = json(await app.inject({ method: 'GET', url: `/api/runs/${b.C.runId}` }));
    expect(run.scenario).toBe(b.C.scenario);
    expect(run.parent_run_id ?? null).toBeNull();
  });

  it('参数与换镇补丁校验', async () => {
    const bad1 = await app.inject({ method: 'POST', url: '/api/experiments', payload: { provider: 'rule', branches: { A: { label: '甲' }, B: { label: '乙', params: { mention: { nope: 1 } } } } } });
    expect(bad1.statusCode).toBe(400);
    expect(json(bad1).error).toContain('mention.nope');
    const bad2 = await app.inject({ method: 'POST', url: '/api/experiments', payload: { provider: 'rule', branches: { A: { label: '甲' }, B: { label: '乙', town: { network: { crossDistrict: 0.5 } } } } } });
    expect(bad2.statusCode).toBe(400);
    expect(json(bad2).error).toContain('经典小镇');
  });

  it('分支校验：补丁指向不存在的事件时拒绝', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/experiments', payload: { provider: 'rule', branches: { A: { label: '甲', patches: [{ event: 'E9', channels: ['website'] }] }, B: { label: '乙' } } } });
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toContain('E9');
  });
});

describe('设计：模板与建镇会话（离线）', () => {
  it('模板带预览；会话可换模板、表单直改，越界被规范化', async () => {
    const ps = json<any[]>(await app.inject({ method: 'GET', url: '/api/presets' }));
    expect(ps.map((p) => p.id)).toEqual(['classic', 'oldtown', 'newtown', 'bigtwo']);
    expect(ps[1].preview.stats.population).toBe(40);
    const s = json(await app.inject({ method: 'POST', url: '/api/builder/sessions', payload: { preset: 'newtown' } }));
    expect(s.spec.population.size).toBe(24);
    expect(s.modelAccess).toBe(false);
    const chat = json(await app.inject({ method: 'POST', url: `/api/builder/sessions/${s.id}/messages`, payload: { text: '多一点老人' } }));
    expect(chat.reply.source).toBe('offline');
    expect(chat.spec).toEqual(s.spec);
    const put = json(await app.inject({ method: 'PUT', url: `/api/builder/sessions/${s.id}/spec`, payload: { spec: { ...s.spec, population: { ...s.spec.population, size: 99 } } } }));
    expect(put.spec.population.size).toBe(60);
    expect(put.warnings.join('')).toContain('人口');
    expect(put.preview.stats.population).toBe(60);
  });

  it('从会话开始观察：登记场景，运行用生成的地图与剧本', async () => {
    const s = json(await app.inject({ method: 'POST', url: '/api/builder/sessions', payload: { preset: 'oldtown' } }));
    const r = await app.inject({ method: 'POST', url: `/api/builder/sessions/${s.id}/launch`, payload: { seed: 5, provider: 'rule' } });
    expect(r.statusCode).toBe(201);
    const run = json(r);
    expect(run.scenario).toMatch(/^sc_/);
    const sc = json(await app.inject({ method: 'GET', url: `/api/runs/${run.id}/scenario` }));
    expect(sc.stats.population).toBe(40);
    expect(sc.map.places.length).toBeGreaterThan(10);
    expect(sc.events[0].id).toBe('E1');
    await runs.get(run.id)!.runHeadless(sim.parseTime('D04 20:00'));
    const m = json(await app.inject({ method: 'GET', url: `/api/runs/${run.id}/metrics` }));
    expect(m.family).toBe('F_E1');
    expect(m.funnel.population).toBe(40);
    // 同一规格再登记一次得到同一个场景
    const again = json(await app.inject({ method: 'POST', url: `/api/builder/sessions/${s.id}/launch`, payload: { seed: 6, provider: 'rule' } }));
    expect(again.scenario).toBe(run.scenario);
  });
});

describe('复盘：章节、曲线、轨迹、独白、报告（离线）', () => {
  let id = '';
  beforeAll(async () => {
    id = json(await app.inject({ method: 'POST', url: '/api/runs', payload: { seed: 42, provider: 'rule' } })).id;
    await runs.get(id)!.runHeadless(sim.parseTime('D04 20:00'));
  });
  it('章节：关键节拍与逐人叙事', async () => {
    const key = json<any[]>(await app.inject({ method: 'GET', url: `/api/runs/${id}/chronicle` }));
    expect(key.some((b) => b.kind === 'publish')).toBe(true);
    expect(key.some((b) => b.kind === 'trust')).toBe(true);
    const feed = json<any[]>(await app.inject({ method: 'GET', url: `/api/runs/${id}/chronicle?level=feed` }));
    expect(feed.length).toBeGreaterThan(key.length);
  });
  it('曲线：每个点人数守恒；轨迹：多个时刻的画像与信任变化', async () => {
    const s = json(await app.inject({ method: 'GET', url: `/api/runs/${id}/series?step=3600` }));
    expect(s.points.length).toBeGreaterThan(50);
    const t = json(await app.inject({ method: 'GET', url: `/api/runs/${id}/agents/a01/trajectory` }));
    expect(t.samples.length).toBeGreaterThan(2);
    expect(t.samples.at(-1).card.name).toBe('周旻');
  });
  it('独白：离线时返回模板想法', async () => {
    const m = json(await app.inject({ method: 'POST', url: `/api/runs/${id}/agents/a07/monologue`, payload: {} }));
    expect(m.source).toBe('template');
    expect(m.text).toBe(m.card.thought.text);
  });
  it('报告：离线时由事实表生成模板报告，每条发现都引用事实；同一事实表命中缓存', async () => {
    const r = json(await app.inject({ method: 'POST', url: `/api/runs/${id}/report`, payload: {} }));
    expect(r.source).toBe('template');
    expect(r.facts.groups.length).toBeGreaterThanOrEqual(5);
    const ids = new Set(r.facts.groups.flatMap((g: any) => g.facts.map((f: any) => f.id)));
    for (const f of r.report.findings) for (const c of f.cites) expect(ids.has(c)).toBe(true);
    const again = json(await app.inject({ method: 'POST', url: `/api/runs/${id}/report`, payload: {} }));
    expect(again.id).toBe(r.id);
    const got = json(await app.inject({ method: 'GET', url: `/api/runs/${id}/report` }));
    expect(got.id).toBe(r.id);
  });
});

describe('实时流', () => {
  it('WebSocket：先收到 hello（完整状态），推进后收到增量事件与时钟', async () => {
    const created = json(await app.inject({ method: 'POST', url: '/api/runs', payload: { seed: 3, provider: 'rule' } }));
    const msgs: any[] = [];
    const ws = await app.injectWS(`/api/runs/${created.id}/stream`, {}, { onInit: (sock) => sock.on('message', (d: Buffer) => msgs.push(JSON.parse(d.toString()))) });
    await new Promise((r) => setTimeout(r, 50));
    await app.inject({ method: 'POST', url: `/api/runs/${created.id}/control`, payload: { op: 'step', step: '10min' } });
    runs.get(created.id)!.tick();
    await new Promise((r) => setTimeout(r, 50));
    ws.terminate();
    expect(msgs[0].type).toBe('hello');
    expect(Object.keys(msgs[0].state.agents)).toHaveLength(30);
    expect(msgs.some((m) => m.type === 'events' && m.events.length > 0)).toBe(true);
    expect(msgs.some((m) => m.type === 'clock')).toBe(true);
  });
});
