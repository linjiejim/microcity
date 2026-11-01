import websocket from '@fastify/websocket';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  applyPatches,
  beliefCensus,
  buildMap,
  defaultManifest,
  forkTimeFor,
  formatTime,
  funnelMetrics,
  normalizeSpec,
  outcomeMetrics,
  parseTime,
  patchesOf,
  personCard,
  placeUse,
  relationBetween,
  timeToShare,
  townStats,
  trustSummary,
  describeEvent,
  PUBLISH_CHANNELS,
  isDefaultPatch,
  resolveParams,
  type BranchSpec,
  type ExperimentManifest,
  type ParamPatch,
  type Prediction,
  type NewsDraft,
  type PublishChannel,
  type Slots,
  type TownMap,
} from '@microcity/sim';
import { config, hasModelAccess } from './config.ts';
import { Analysis } from './analysis.ts';
import { Builder } from './builder.ts';
import { ExperimentRunner, isMetricKey, type ExperimentResult } from './experiments.ts';
import { Gallery } from './gallery.ts';
import { ChatClient } from './providers/chat.ts';
import { monologue } from './providers/monologue.ts';
import { Reporter, experimentFacts, runFacts } from './report.ts';
import { RunManager, SPEEDS } from './runs.ts';

type Req<P = Record<string, string>, B = unknown, Q = Record<string, string>> = FastifyRequest<{ Params: P; Body: B; Querystring: Q }>;

export interface Services {
  runs: RunManager;
  experiments: ExperimentRunner;
  analysis: Analysis;
  builder: Builder;
  reporter: Reporter;
  chat: ChatClient;
  gallery: Gallery;
}

export function makeServices(runs: RunManager): Services {
  const chat = new ChatClient(runs.store);
  const experiments = new ExperimentRunner(runs);
  return { runs, experiments, analysis: new Analysis(runs), builder: new Builder(runs.store, chat), reporter: new Reporter(runs.store, chat), chat, gallery: new Gallery(runs, experiments) };
}

/** 演示站的限速：每个 IP、每类操作，最近一小时的次数 */
class RateLimiter {
  private hits = new Map<string, number[]>();
  allow(ip: string, bucket: string, perHour: number): boolean {
    const k = `${bucket}|${ip}`;
    const now = Date.now();
    const xs = (this.hits.get(k) ?? []).filter((t) => now - t < 3_600_000);
    if (xs.length >= perHour) {
      this.hits.set(k, xs);
      return false;
    }
    xs.push(now);
    this.hits.set(k, xs);
    if (this.hits.size > 10_000) for (const [key, v] of this.hits) if (!v.some((t) => now - t < 3_600_000)) this.hits.delete(key);
    return true;
  }
}

const PREDICT_EXPECT = ['higher', 'lower', 'same'];

/** 校验“先猜再跑”的预测；返回错误信息或规范化后的预测 */
function validPredictions(ps: unknown, branches: readonly string[], outageIds: readonly string[]): Prediction[] | string {
  if (!Array.isArray(ps)) return '预测应为数组';
  if (ps.length > 8) return '最多 8 条预测';
  const out: Prediction[] = [];
  for (const [i, raw] of ps.entries()) {
    const p = raw as Partial<Prediction>;
    const text = typeof p.text === 'string' ? p.text.trim() : '';
    if (!text || text.length > 80) return `第 ${i + 1} 条预测需要 1–80 字的说明`;
    if (typeof p.metric !== 'string' || !isMetricKey(p.metric, outageIds)) return `第 ${i + 1} 条预测的指标 ${String(p.metric)} 不认识`;
    if (typeof p.a !== 'string' || !branches.includes(p.a) || typeof p.b !== 'string' || !branches.includes(p.b) || p.a === p.b) return `第 ${i + 1} 条预测要比较两个不同的分支`;
    if (!PREDICT_EXPECT.includes(String(p.expect))) return `第 ${i + 1} 条预测的方向应为 higher / lower / same`;
    if (p.tolerance !== undefined && !(typeof p.tolerance === 'number' && p.tolerance >= 0)) return `第 ${i + 1} 条预测的容差应为非负数`;
    out.push({ id: typeof p.id === 'string' && p.id ? p.id.slice(0, 16) : `P${i + 1}`, text, metric: p.metric, a: p.a, b: p.b, expect: p.expect as Prediction['expect'], ...(p.tolerance !== undefined ? { tolerance: p.tolerance } : {}) });
  }
  return out;
}

const idem = new Map<string, unknown>();
async function idempotent<T>(key: string | undefined, fn: () => T | Promise<T>): Promise<T> {
  if (!key) return fn();
  if (idem.has(key)) return idem.get(key) as T;
  const r = await fn();
  idem.set(key, r);
  if (idem.size > 2000) idem.delete(idem.keys().next().value!);
  return r;
}

const bad = (reply: FastifyReply, msg: string, code = 400) => reply.code(code).send({ error: msg });

function validSlots(s: unknown): s is Slots {
  if (!s || typeof s !== 'object') return false;
  const x = s as Slots;
  if (x.area && !['north', 'south', 'town'].includes(x.area)) return false;
  if (x.day !== undefined && (!Number.isInteger(x.day) || x.day < 1 || x.day > 30)) return false;
  if (x.window) {
    if (x.window.kind === 'exact' && !(x.window.from >= 0 && x.window.to <= 86400 && x.window.from < x.window.to)) return false;
    if (!['exact', 'coarse', 'all_day'].includes(x.window.kind)) return false;
  }
  if (x.certainty && !['confirmed', 'likely', 'rumor'].includes(x.certainty)) return false;
  return true;
}

/** 分支规格校验：标签、补丁指向的事件、渠道 */
function validBranches(b: unknown, eventIds: string[]): Record<string, BranchSpec> | string {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return '分支格式不对';
  const entries = Object.entries(b as Record<string, unknown>);
  if (entries.length < 2 || entries.length > 6) return '对照实验需要 2–6 个分支';
  const out: Record<string, BranchSpec> = {};
  for (const [k, v] of entries) {
    if (!/^[A-Z][A-Z0-9]?$/.test(k)) return `分支名 ${k} 应为大写字母`;
    const x = v as BranchSpec;
    if (typeof x?.label !== 'string' || !x.label.trim() || x.label.length > 24) return `分支 ${k} 需要 1–24 字的标签`;
    for (const p of x.patches ?? []) {
      if (p.event !== '$first' && !eventIds.includes(p.event)) return `分支 ${k} 的补丁指向不存在的事件 ${p.event}`;
      if (p.mode !== undefined && !['outage', 'false_alarm', 'absent'].includes(p.mode)) return `分支 ${k} 的事件模式应为 outage / false_alarm / absent`;
      if (p.channels && (!Array.isArray(p.channels) || p.channels.some((c) => !(PUBLISH_CHANNELS as readonly string[]).includes(c)))) return `分支 ${k} 的渠道不合法`;
      if (p.clarify) {
        try {
          if (!p.clarify.at.startsWith('$')) parseTime(p.clarify.at);
        } catch {
          return `分支 ${k} 的澄清时间格式应为 D03 16:00`;
        }
      }
    }
    if (x.params !== undefined) {
      try {
        resolveParams(x.params);
      } catch (e) {
        return `分支 ${k}：${(e as Error).message}`;
      }
    }
    if (x.town !== undefined) {
      if (!x.town || typeof x.town !== 'object' || Object.keys(x.town).some((g) => !['culture', 'media', 'network', 'population'].includes(g))) return `分支 ${k} 的换镇补丁只能改 culture / media / network / population`;
    }
    out[k] = {
      label: x.label.trim(),
      ...(x.patches ? { patches: structuredClone(x.patches) } : {}),
      ...(x.channels ? { channels: x.channels } : {}),
      ...(x.clarification ? { clarification: x.clarification } : {}),
      ...(x.params ? { params: structuredClone(x.params) } : {}),
      ...(x.town ? { town: structuredClone(x.town) } : {}),
    };
  }
  return out;
}

export async function buildApi(runs: RunManager, services?: Services): Promise<FastifyInstance> {
  const svc = services ?? makeServices(runs);
  const { experiments, analysis, builder, reporter, chat, gallery } = svc;
  // 演示站在反向代理后面：按 X-Forwarded-For 认客户端
  const app = Fastify({ logger: false, bodyLimit: 1_000_000, trustProxy: config.publicMode });
  const limiter = new RateLimiter();
  const L = config.publicLimits;
  /** 演示站：超过每小时次数就拒绝（本机使用不限） */
  const throttled = (req: FastifyRequest, reply: FastifyReply, bucket: 'experiments' | 'runs' | 'model'): boolean => {
    if (!config.publicMode) return false;
    const per = bucket === 'experiments' ? L.experimentsPerHour : bucket === 'runs' ? L.runsPerHour : L.modelCallsPerHour;
    if (limiter.allow(req.ip, bucket, per)) return false;
    void reply.code(429).send({ error: `演示站限流：每小时最多 ${per} 次，请稍后再试（或在本机运行，不受限制）` });
    return true;
  };
  const jevBlocked = (reply: FastifyReply, provider?: string): boolean => {
    if (!config.publicMode || provider !== 'jev') return false;
    void reply.code(403).send({ error: '演示站只开放规则模式；Jev 的结果是预先跑好的。想用 Jev，请在本机运行并配置自己的密钥。' });
    return true;
  };
  await app.register(websocket);
  const store = runs.store;
  const maps = new Map<string, TownMap>();
  const mapOf = (runId: string): TownMap => {
    const sc = runs.scenarioOf(runId);
    let m = maps.get(sc.id);
    if (!m) maps.set(sc.id, (m = buildMap(sc)));
    return m;
  };

  app.get('/api/health', async () => ({
    ok: true,
    public: config.publicMode ? { limits: L } : null,
    models: { access: hasModelAccess(), jevAllowed: hasModelAccess() && !config.publicMode, jev: config.jevModel, generative: config.genModel },
    budget: { spentUsd: Number(store.spend().toFixed(6)), globalCapUsd: config.globalBudgetUsd, runCapUsd: config.runBudgetUsd },
    speeds: SPEEDS,
  }));

  // ---------- 设计：模板、建镇会话、场景 ----------
  app.get('/api/presets', async () => builder.presets());

  app.get('/api/scenarios', async () => [{ id: 'town30', name: runs.scenarios.require('town30').name, source: 'builtin' }, ...store.listScenarios()]);

  app.post('/api/builder/sessions', async (req: Req<Record<string, string>, { preset?: string }>, reply) => reply.code(201).send(builder.create(req.body?.preset)));

  app.get('/api/builder/sessions/:id', async (req: Req<{ id: string }>, reply) => builder.get(req.params.id) ?? bad(reply, 'session not found', 404));

  app.post('/api/builder/sessions/:id/messages', async (req: Req<{ id: string }, { text?: string }>, reply) => {
    const text = (req.body?.text ?? '').trim();
    if (!text) return bad(reply, '说点什么吧');
    if (!builder.get(req.params.id)) return bad(reply, 'session not found', 404);
    if (throttled(req, reply, 'model')) return reply;
    return builder.message(req.params.id, text);
  });

  app.put('/api/builder/sessions/:id/spec', async (req: Req<{ id: string }, { spec?: unknown; source?: 'form' | 'preset' }>, reply) => {
    if (!builder.get(req.params.id)) return bad(reply, 'session not found', 404);
    return builder.setSpec(req.params.id, req.body?.spec ?? {}, req.body?.source === 'preset' ? 'preset' : 'form');
  });

  app.post('/api/builder/sessions/:id/launch', async (req: Req<{ id: string }, { seed?: number; provider?: 'rule' | 'jev'; script?: 'outage' | 'quiet'; name?: string; idempotencyKey?: string }>, reply) => {
    const s = builder.get(req.params.id);
    if (!s) return bad(reply, 'session not found', 404);
    const b = req.body ?? {};
    if (b.provider === 'jev' && !hasModelAccess()) return bad(reply, '没有配置模型密钥，只能用规则决策');
    if (jevBlocked(reply, b.provider) || throttled(req, reply, 'runs')) return reply;
    const out = await idempotent(b.idempotencyKey, () => {
      const { id } = runs.scenarios.register(s.spec, 'builder');
      return runs.create({ scenario: id, seed: Number.isInteger(b.seed) ? Number(b.seed) : 42, provider: b.provider === 'jev' ? 'jev' : 'rule', ...(b.script ? { script: b.script } : {}), ...(b.name ? { name: b.name } : {}) }).status();
    });
    return reply.code(201).send(out);
  });

  // ---------- 运行 ----------
  app.get('/api/runs', async () => runs.list());

  app.post('/api/runs', async (req: Req<Record<string, string>, { name?: string; seed?: number; provider?: 'rule' | 'jev'; script?: 'outage' | 'quiet'; scenario?: string; idempotencyKey?: string }>, reply) => {
    const b = req.body ?? {};
    const provider = b.provider === 'jev' ? 'jev' : 'rule';
    const seed = Number.isInteger(b.seed) ? Number(b.seed) : 42;
    if (b.scenario && !runs.scenarios.get(b.scenario)) return bad(reply, `未知场景 ${b.scenario}`);
    if (jevBlocked(reply, provider) || throttled(req, reply, 'runs')) return reply;
    const out = await idempotent(b.idempotencyKey, () => runs.create({ seed, provider, ...(b.name ? { name: b.name } : {}), ...(b.script ? { script: b.script } : {}), ...(b.scenario ? { scenario: b.scenario } : {}) }).status());
    return reply.code(201).send(out);
  });

  app.get('/api/runs/:id', async (req: Req<{ id: string }>, reply) => {
    const r = runs.get(req.params.id);
    return r ? r.status() : bad(reply, 'run not found', 404);
  });

  /** 本运行的地图、地点与剧本（前端不再写死小镇） */
  app.get('/api/runs/:id/scenario', async (req: Req<{ id: string }>, reply) => {
    const r = runs.get(req.params.id);
    if (!r) return bad(reply, 'run not found', 404);
    const sc = r.engine.scenario;
    const events = r.engine.scriptEvents;
    const effective = (() => {
      try {
        const m = r.row.manifest ? (JSON.parse(r.row.manifest) as { branch?: BranchSpec | null; script?: string; label?: string }) : {};
        if (m.script === 'quiet') return sc.events.map((e) => ({ ...e, notice: null, clarify: null }));
        const spec = m.branch ?? (m.label ? (m as BranchSpec) : undefined);
        return spec ? applyPatches(sc.events, patchesOf(spec, sc.events)) : sc.events;
      } catch {
        return sc.events;
      }
    })();
    return {
      id: sc.id,
      name: sc.name,
      version: sc.version,
      start: sc.start,
      map: sc.map,
      items: sc.items,
      outages: sc.outages,
      events: effective,
      eventText: effective.map(describeEvent),
      script: events.map((x) => ({ at: x.at, kind: x.kind, note: x.note, ...(x.kind === 'publish' ? { news: x.news.id, family: x.news.familyId, headline: x.news.headline.text, channels: x.channels } : {}), ...(x.kind === 'power' ? { area: x.area, on: x.on, outage: x.outage } : {}) })),
      stats: townStats(sc),
    };
  });

  app.post('/api/runs/:id/control', async (req: Req<{ id: string }, { op: 'play' | 'pause' | 'speed' | 'step' | 'jump'; speed?: number; step?: 'event' | '10min'; to?: string }>, reply) => {
    const r = runs.get(req.params.id);
    if (!r) return bad(reply, 'run not found', 404);
    const b = req.body ?? ({} as never);
    switch (b.op) {
      case 'play':
        r.play();
        break;
      case 'pause':
        r.pause();
        break;
      case 'speed':
        if (!Number.isFinite(b.speed)) return bad(reply, 'speed required');
        r.setSpeed(Number(b.speed));
        break;
      case 'step':
        await r.step(b.step === '10min' ? '10min' : 'event');
        break;
      case 'jump': {
        // 快进：全速推进到目标时刻后暂停（外部决策照常等待答案）
        let to: number;
        try {
          to = parseTime(String(b.to ?? ''));
        } catch {
          return bad(reply, '时间格式应为 D03 08:00');
        }
        if (to <= r.engine.now) return bad(reply, '只能往后跳');
        if (to - r.engine.now > 7 * 86400) return bad(reply, '一次最多快进 7 天');
        await r.runHeadless(to);
        r.pause();
        break;
      }
      default:
        return bad(reply, 'unknown op');
    }
    return r.status();
  });

  app.get('/api/runs/:id/state', async (req: Req<{ id: string }, unknown, { seq?: string; t?: string }>, reply) => {
    const r = runs.get(req.params.id);
    if (!r) return bad(reply, 'run not found', 404);
    if (req.query.t !== undefined && req.query.seq === undefined) {
      r.flush();
      const seq = runs.seqAtTime(r.id, Number(req.query.t));
      const s = runs.stateAt(r.id, seq);
      return s ? { seq: s.meta.seq, historical: true, state: s, t: Number(req.query.t) } : bad(reply, 'state unavailable', 404);
    }
    if (req.query.seq === undefined) {
      r.flush();
      return { seq: r.engine.state.meta.seq, historical: false, state: r.engine.state };
    }
    const seq = Number(req.query.seq);
    const s = runs.stateAt(r.id, seq);
    return s ? { seq: s.meta.seq, historical: true, state: s } : bad(reply, 'state unavailable', 404);
  });

  app.get('/api/runs/:id/agents/:aid', async (req: Req<{ id: string; aid: string }, unknown, { limit?: string }>, reply) => {
    const r = runs.get(req.params.id);
    if (!r) return bad(reply, 'run not found', 404);
    r.flush();
    const a = r.engine.state.agents[req.params.aid];
    if (!a) return bad(reply, 'agent not found', 404);
    const relations = r.engine.state.relations
      .filter((x) => x.a === a.id || x.b === a.id)
      .map((x) => {
        const other = x.a === a.id ? x.b : x.a;
        const rel = relationBetween(r.engine.state, a.id, other)!;
        return { other, name: r.engine.state.agents[other]?.name ?? other, kind: rel.kind, strength: rel.strength, trust: a.trustIn[other] ?? rel.trust, baseTrust: rel.trust, note: rel.note ?? null };
      })
      .filter((x, i, arr) => arr.findIndex((y) => y.other === x.other) === i)
      .sort((x, y) => y.strength - x.strength);
    const decisions = runs.decisions(r.id, a.id).map((d) => ({ id: d.id, t: d.t, commitAt: d.commitAt, kind: d.kind, family: d.family, provider: d.provider, model: d.model, chosen: d.chosen, chosenLabels: d.chosen.map((c) => d.candidates.find((x) => x.id === c)?.label ?? c), outcome: d.commit.outcome, fallback: d.fallback ?? null, summary: d.summary }));
    const timeline = runs.agentHistory(r.id, a.id, Number(req.query.limit ?? 600));
    return { agent: a, relations, decisions, timeline };
  });

  app.get('/api/runs/:id/decisions', async (req: Req<{ id: string }, unknown, { agent?: string }>) => runs.decisions(req.params.id, req.query.agent));

  app.get('/api/runs/:id/decisions/:did', async (req: Req<{ id: string; did: string }>, reply) => {
    const d = runs.decision(req.params.id, req.params.did);
    if (!d) return bad(reply, 'decision not found', 404);
    const calls = d.modelCallIds.map((cid) => store.modelCall(cid)).filter(Boolean).map((c) => ({ id: c!.id, provider: c!.provider, model: c!.model, cached: !!c!.cached, costUsd: c!.cost_usd, latencyMs: c!.latency_ms, error: c!.error, request: JSON.parse(c!.request), response: c!.response ? JSON.parse(c!.response) : null }));
    return { record: d, calls };
  });

  // ---------- 新闻（管理员干预） ----------
  app.get('/api/runs/:id/news', async (req: Req<{ id: string }>, reply) => {
    const r = runs.get(req.params.id);
    if (!r) return bad(reply, 'run not found', 404);
    return Object.values(r.engine.state.news).map((n) => ({ ...n, headlineSlots: r.engine.state.versions[n.headline.versionId]?.slots, bodySlots: r.engine.state.versions[n.body.versionId]?.slots }));
  });

  app.post(
    '/api/runs/:id/news',
    async (req: Req<{ id: string }, { headline?: string; body?: string; slots?: Slots; headlineSlots?: Slots; channels?: PublishChannel[]; familyId?: string; correctionOf?: string; idempotencyKey?: string }>, reply) => {
      const r = runs.get(req.params.id);
      if (!r) return bad(reply, 'run not found', 404);
      const b = req.body ?? {};
      const headline = (b.headline ?? '').trim();
      const body = (b.body ?? '').trim();
      if (!headline || headline.length > 60) return bad(reply, '标题必填，且不超过 60 字');
      if (!body || body.length > 600) return bad(reply, '正文必填，且不超过 600 字');
      if (!validSlots(b.slots) || !b.slots.event) return bad(reply, '槽位不合法（至少要有“事件”）');
      if (b.headlineSlots && !validSlots(b.headlineSlots)) return bad(reply, '标题槽位不合法');
      const channels = (b.channels ?? []).filter((c): c is PublishChannel => (PUBLISH_CHANNELS as readonly string[]).includes(c));
      if (channels.length === 0) return bad(reply, '至少选择一个渠道');
      const out = await idempotent(b.idempotencyKey, () => {
        const n = Object.keys(r.engine.state.news).length + 1;
        const id = `A${String(n).padStart(3, '0')}`;
        const familyId = b.familyId && /^F_[A-Z0-9_]+$/.test(b.familyId) ? b.familyId : b.correctionOf ? (r.engine.state.news[b.correctionOf]?.familyId ?? `F_${id}`) : `F_${id}`;
        const draft: NewsDraft = {
          id,
          familyId,
          headline: { text: headline, slots: { ...(b.headlineSlots ?? { event: b.slots!.event, area: b.slots!.area, day: b.slots!.day }), source: b.slots!.source ?? 'gov', certainty: b.slots!.certainty ?? 'confirmed' } },
          body: { text: body, slots: { source: 'gov', certainty: 'confirmed', ...b.slots! } },
          publisher: { kind: 'admin', id: 'admin', name: '管理员（实验干预）' },
          ...(b.correctionOf ? { correctionOf: b.correctionOf } : {}),
        };
        r.publish(draft, channels);
        return { id, familyId, channels };
      });
      return reply.code(201).send(out);
    },
  );

  app.get('/api/runs/:id/families/:fid/lineage', async (req: Req<{ id: string; fid: string }>, reply) => {
    const r = runs.get(req.params.id);
    if (!r) return bad(reply, 'run not found', 404);
    r.flush();
    const fid = req.params.fid;
    const versions = Object.values(r.engine.state.versions).filter((v) => v.familyId === fid);
    const tx = runs.history(r.id, { types: ['transmission'] }).flatMap((e) => (e.type === 'transmission' && e.tr.familyId === fid ? [e.tr] : []));
    const news = Object.values(r.engine.state.news).filter((n) => n.familyId === fid);
    const holders: Record<string, string[]> = {};
    for (const a of Object.values(r.engine.state.agents)) {
      const b = a.beliefs[fid];
      if (b) (holders[b.versionId] ??= []).push(a.id);
    }
    return { family: fid, versions, transmissions: tx, news, holders };
  });

  app.get('/api/runs/:id/metrics', async (req: Req<{ id: string }, unknown, { family?: string }>, reply) => {
    const r = runs.get(req.params.id);
    if (!r) return bad(reply, 'run not found', 404);
    r.flush();
    const s = r.engine.state;
    const fam = req.query.family ?? r.engine.scenario.outages[0]?.family ?? 'F_OUTAGE';
    const outage = r.engine.scenario.outages.find((o) => o.family === fam);
    const f = funnelMetrics(s, fam);
    const firstPub = Object.values(s.news).filter((n) => n.familyId === fam).reduce((m, n) => Math.min(m, n.publishedAt), Infinity);
    return {
      family: fam,
      funnel: f,
      t50: Number.isFinite(firstPub) ? timeToShare(f, 0.5, firstPub) : null,
      t80: Number.isFinite(firstPub) ? timeToShare(f, 0.8, firstPub) : null,
      census: beliefCensus(s, fam),
      outcome: outcomeMetrics(s, outage?.id),
      trust: trustSummary(s),
      places: placeUse(s),
      health: { decisions: store.decisionStats(r.id), calls: store.callStats(r.id), pending: Object.keys(s.pending).length, blocked: r.blocked },
    };
  });

  app.get('/api/runs/:id/events', async (req: Req<{ id: string }, unknown, { after?: string; limit?: string; types?: string }>, reply) => {
    const r = runs.get(req.params.id);
    if (!r) return bad(reply, 'run not found', 404);
    r.flush();
    return runs.history(r.id, { after: Number(req.query.after ?? 0), limit: Math.min(20000, Number(req.query.limit ?? 5000)), ...(req.query.types ? { types: req.query.types.split(',') } : {}) });
  });

  app.get('/api/runs/:id/replay-check', async (req: Req<{ id: string }>, reply) => {
    const r = runs.get(req.params.id);
    if (!r) return bad(reply, 'run not found', 404);
    return runs.replayCheck(r.id);
  });

  app.get('/api/runs/:id/dialogues/:cid', async (req: Req<{ id: string; cid: string }>, reply) => {
    const r = runs.get(req.params.id);
    if (!r) return bad(reply, 'run not found', 404);
    const conv = runs.history(r.id, { types: ['conversation'] }).find((e) => e.type === 'conversation' && e.id === req.params.cid);
    if (!conv || conv.type !== 'conversation') return bad(reply, 'conversation not found', 404);
    const p = r.engine.map.places[conv.place];
    return runs.dialogues.render(r.id, conv, r.engine.state, p?.kind ?? 'default', p?.name ?? conv.place, `D${String(Math.floor(conv.t / 86400) + 1).padStart(2, '0')}`);
  });

  app.post('/api/runs/:id/fork', async (req: Req<{ id: string }, { at?: string; name?: string; branch?: BranchSpec; idempotencyKey?: string }>, reply) => {
    const b = req.body ?? {};
    if (throttled(req, reply, 'runs')) return reply;
    try {
      const out = await idempotent(b.idempotencyKey, () => runs.fork(req.params.id, { ...(b.at ? { at: b.at } : {}), ...(b.name ? { name: b.name } : {}), ...(b.branch ? { branch: b.branch } : {}) }).status());
      return reply.code(201).send(out);
    } catch (e) {
      return bad(reply, (e as Error).message);
    }
  });

  // ---------- 复盘 ----------
  app.get('/api/runs/:id/chronicle', async (req: Req<{ id: string }, unknown, { level?: string }>, reply) => {
    if (!runs.get(req.params.id)) return bad(reply, 'run not found', 404);
    return analysis.chronicle(req.params.id, req.query.level === 'feed' ? 'feed' : 'key');
  });

  app.get('/api/runs/:id/series', async (req: Req<{ id: string }, unknown, { step?: string; family?: string }>, reply) => {
    const r = runs.get(req.params.id);
    if (!r) return bad(reply, 'run not found', 404);
    const step = Math.max(600, Math.min(6 * 3600, Number(req.query.step ?? 1800)));
    const fam = req.query.family ?? r.engine.scenario.outages[0]?.family ?? 'F_OUTAGE';
    return { family: fam, step, points: analysis.series(r.id, step, fam) };
  });

  app.get('/api/runs/:id/agents/:aid/trajectory', async (req: Req<{ id: string; aid: string }, unknown, { family?: string }>, reply) => {
    const r = runs.get(req.params.id);
    if (!r) return bad(reply, 'run not found', 404);
    if (!r.engine.state.agents[req.params.aid]) return bad(reply, 'agent not found', 404);
    return analysis.trajectory(r.id, req.params.aid, req.query.family ?? r.engine.scenario.outages[0]?.family ?? 'F_OUTAGE');
  });

  app.post('/api/runs/:id/agents/:aid/monologue', async (req: Req<{ id: string; aid: string }, { t?: number; family?: string }>, reply) => {
    const r = runs.get(req.params.id);
    if (!r) return bad(reply, 'run not found', 404);
    if (throttled(req, reply, 'model')) return reply;
    r.flush();
    const t = Number.isFinite(req.body?.t) ? Number(req.body!.t) : r.engine.now;
    const s = t < r.engine.now ? runs.stateAt(r.id, runs.seqAtTime(r.id, t)) : r.engine.state;
    const a = s?.agents[req.params.aid];
    if (!s || !a) return bad(reply, 'agent not found', 404);
    const fam = req.body?.family ?? r.engine.scenario.outages[0]?.family ?? 'F_OUTAGE';
    const card = personCard(s, mapOf(r.id), a.id, fam, t, r.engine.scenario.outages.find((o) => o.family === fam));
    return { card, ...(await monologue(chat, r.id, a, card, formatTime(t))) };
  });

  // 还没有报告时返回 null（不是错误）
  app.get('/api/runs/:id/report', async (req: Req<{ id: string }>) => reporter.latest(`run:${req.params.id}`) ?? null);

  app.post('/api/runs/:id/report', async (req: Req<{ id: string }, { force?: boolean }>, reply) => {
    const r = runs.get(req.params.id);
    if (!r) return bad(reply, 'run not found', 404);
    if (throttled(req, reply, 'model')) return reply;
    const facts = runFacts(runs, analysis, r.id);
    return reporter.generate(`run:${r.id}`, facts, r.id, { force: !!req.body?.force });
  });

  // ---------- 实验 ----------
  app.get('/api/experiments', async () =>
    store.listExperiments().map((x) => {
      const scId = (x.manifest as ExperimentManifest).scenario;
      return { ...x, scenarioName: runs.scenarios.get(scId)?.name ?? scId, live: experiments.live.get(x.id) ?? null };
    }),
  );

  app.post(
    '/api/experiments',
    async (req: Req<Record<string, string>, { scenario?: string; seed?: number; seeds?: number[]; seedCount?: number; provider?: 'rule' | 'jev'; branches?: Record<string, BranchSpec>; params?: ParamPatch; name?: string; manifest?: ExperimentManifest; builderSession?: string; idempotencyKey?: string }>, reply) => {
      const b = req.body ?? {};
      const provider = (b.provider ?? b.manifest?.provider) === 'jev' ? 'jev' : 'rule';
      if (provider === 'jev' && !hasModelAccess()) return bad(reply, '没有配置模型密钥，只能用规则决策');
      if (jevBlocked(reply, provider)) return reply;
      let scenarioId = b.scenario ?? b.manifest?.scenario ?? 'town30';
      if (b.builderSession) {
        const s = builder.get(b.builderSession);
        if (!s) return bad(reply, 'session not found', 404);
        scenarioId = runs.scenarios.register(s.spec, 'builder').id;
      }
      const sc = runs.scenarios.get(scenarioId);
      if (!sc) return bad(reply, `未知场景 ${scenarioId}`);
      let seeds = b.seeds ?? b.manifest?.seeds;
      if (!seeds) {
        const base = Number.isInteger(b.seed) ? Number(b.seed) : 42;
        const n = Math.max(1, Math.min(20, Number(b.seedCount ?? 1)));
        seeds = Array.from({ length: n }, (_, i) => base + i);
      }
      if (!Array.isArray(seeds) || seeds.length < 1 || seeds.length > 20 || seeds.some((x) => !Number.isInteger(x)) || new Set(seeds).size !== seeds.length) return bad(reply, '随机种子应为 1–20 个互不相同的整数');
      if (config.publicMode && seeds.length > L.maxSeeds) return bad(reply, `演示站每个实验最多 ${L.maxSeeds} 个随机种子`);
      if (config.publicMode && [...experiments.live.values()].filter((x) => x.status === 'running').length >= L.maxRunningExperiments) return reply.code(429).send({ error: '演示站同时在跑的实验太多，请过一两分钟再试' });
      const m = defaultManifest(seeds, provider, sc);
      const name = b.name ?? b.manifest?.name;
      if (name) m.name = String(name).slice(0, 40);
      const question = b.manifest?.question;
      if (typeof question === 'string' && question.trim()) m.question = question.trim().slice(0, 120);
      const branches = b.branches ?? b.manifest?.branches;
      if (branches) {
        const v = validBranches(branches, sc.events.map((e) => e.id));
        if (typeof v === 'string') return bad(reply, v);
        m.branches = v;
        m.forkAt = formatTime(forkTimeFor(sc, v));
        // 换镇分支要能从底座规格生成，且剧本一致
        try {
          for (const spec of Object.values(v)) experiments.townScenario(sc, spec);
        } catch (e) {
          return bad(reply, (e as Error).message);
        }
      }
      const params = b.params ?? b.manifest?.params;
      if (params !== undefined) {
        try {
          resolveParams(params);
        } catch (e) {
          return bad(reply, (e as Error).message);
        }
        if (!isDefaultPatch(params)) m.params = structuredClone(params);
      }
      const predictions = b.manifest?.predictions;
      if (predictions !== undefined) {
        const v = validPredictions(predictions, Object.keys(m.branches), sc.outages.map((o) => o.id));
        if (typeof v === 'string') return bad(reply, v);
        if (v.length) m.predictions = v;
      }
      if (throttled(req, reply, 'experiments')) return reply;
      if (provider === 'jev') {
        const estimate = seeds.length * Object.keys(m.branches).length * 0.003;
        const left = config.globalBudgetUsd - store.spend();
        if (estimate > left) return bad(reply, `预计花费约 $${estimate.toFixed(3)}，超过剩余全局预算 $${left.toFixed(3)}`);
      }
      const out = await idempotent(b.idempotencyKey, () => ({ id: experiments.start(m), manifest: m }));
      return reply.code(202).send(out);
    },
  );

  app.get('/api/experiments/:id', async (req: Req<{ id: string }>, reply) => {
    const x = store.experiment(req.params.id);
    if (!x) return bad(reply, 'experiment not found', 404);
    return { ...x, live: experiments.live.get(x.id) ?? null };
  });

  app.get('/api/experiments/:id/report', async (req: Req<{ id: string }>) => reporter.latest(`exp:${req.params.id}`) ?? null);

  // ---------- 实验广场 ----------
  app.get('/api/gallery', async () => gallery.list());

  app.post('/api/gallery/:id/run', async (req: Req<{ id: string }>, reply) => {
    const running = [...experiments.live.values()].filter((x) => x.status === 'running').length;
    if (config.publicMode && running >= L.maxRunningExperiments) return reply.code(429).send({ error: '演示站同时在跑的实验太多，请过一两分钟再试' });
    const out = gallery.run(req.params.id);
    return out ? reply.code(202).send(out) : bad(reply, 'gallery entry not found', 404);
  });

  app.post('/api/experiments/:id/report', async (req: Req<{ id: string }, { force?: boolean }>, reply) => {
    const x = store.experiment(req.params.id);
    if (!x) return bad(reply, 'experiment not found', 404);
    if (x.status !== 'done' || !x.result) return bad(reply, '实验还没跑完');
    if (throttled(req, reply, 'model')) return reply;
    const facts = experimentFacts(runs, analysis, { id: x.id, manifest: x.manifest as ExperimentManifest, result: x.result as ExperimentResult });
    return reporter.generate(`exp:${x.id}`, facts, null, { force: !!req.body?.force });
  });

  // ---------- 规格工具 ----------
  app.post('/api/specs/normalize', async (req: Req<Record<string, string>, { spec?: unknown }>) => normalizeSpec(req.body?.spec ?? {}));

  // ---------- 实时流 ----------
  app.get('/api/runs/:id/stream', { websocket: true }, (socket, req) => {
    const r = runs.get((req.params as { id: string }).id);
    if (!r) {
      socket.close(4404, 'run not found');
      return;
    }
    r.addClient(socket);
  });

  // 生产环境：前端静态文件 + 单页应用回落（/api 之外的 GET 都交给 index.html）
  if (config.staticDir && existsSync(join(config.staticDir, 'index.html'))) {
    const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.ico': 'image/x-icon' };
    const root = config.staticDir;
    const index = join(root, 'index.html');
    const assets = join(root, 'assets') + sep;
    app.setNotFoundHandler((req, reply) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      let path = '/';
      try {
        path = decodeURIComponent(req.url.split('?')[0]!);
      } catch {
        // 路由已把畸形的百分号编码拒成 400；这里再兜一层，当作首页
      }
      let file = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''));
      if (!file.startsWith(root + sep) || !existsSync(file) || statSync(file).isDirectory()) file = index;
      return reply
        .header('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
        .header('Cache-Control', file.startsWith(assets) ? 'public, max-age=31536000, immutable' : 'no-cache')
        .send(readFileSync(file));
    });
  }

  return app;
}
