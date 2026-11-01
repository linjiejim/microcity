import { randomUUID } from 'node:crypto';
import type { WebSocket } from '@fastify/websocket';
import {
  ChronicleBuilder,
  Engine,
  applyAll,
  branchScript,
  buildInitialState,
  contentHash,
  formatTime,
  parseTime,
  type Beat,
  type BranchSpec,
  type DecisionRecord,
  type DomainEvent,
  type NewsDraft,
  type PublishChannel,
  type ScenarioDef,
  type ScriptEvent,
  type SemanticAnswer,
  type SimTime,
  type WorldState,
} from '@microcity/sim';
import { config } from './config.ts';
import type { RunRow, Store } from './db.ts';
import { DialogueRenderer } from './providers/dialogue.ts';
import { JevProvider } from './providers/jev.ts';
import { ScenarioRegistry } from './scenarios.ts';

export const SPEEDS = [1, 10, 60, 300] as const;
const SNAPSHOT_EVERY = 3600;

export interface RunStatus {
  id: string;
  name: string;
  scenario: string;
  provider: 'rule' | 'jev';
  seed: number;
  t: SimTime;
  seq: number;
  speed: number;
  paused: boolean;
  blocked: boolean;
  pending: number;
  spend: number;
  parent: string | null;
  forkT: number | null;
  branch: string | null;
  experimentId: string | null;
  dialogue: boolean;
}

export type ServerMessage =
  | { type: 'hello'; run: RunStatus; state: WorldState; beats: Beat[] }
  | { type: 'beats'; beats: Beat[] }
  | { type: 'events'; events: DomainEvent[] }
  | { type: 'clock'; run: RunStatus }
  | { type: 'dialogue'; convId: string; lines: Array<{ speaker: string; text: string }>; model: string }
  | { type: 'decision'; record: Pick<DecisionRecord, 'id' | 'agent' | 'agentName' | 'kind' | 'chosen' | 'provider' | 'summary' | 'fallback'> };

/** 静默剧本：每一轮都不发通知、不澄清，只有真实停电（和单位工单） */
export function quietScript(sc: ScenarioDef): ScriptEvent[] {
  return branchScript(sc, { label: '不发通知', patches: sc.events.map((e) => ({ event: e.id, silent: true, clarify: null })) });
}

/** 为运行回答外部决策请求（Jev），并发受限；失败/超时/超预算都回退到规则并打标 */
export class DecisionService {
  private inflight = new Set<string>();
  constructor(
    private jev: JevProvider,
    private runId: string,
  ) {}

  pump(engine: Engine): void {
    for (const req of engine.pendingRequests()) {
      if (this.inflight.has(req.id)) continue;
      if (this.inflight.size >= config.jevConcurrency) break;
      this.inflight.add(req.id);
      this.jev
        .answer(req, this.runId)
        .catch((e): SemanticAnswer => ({ ...req.semanticRule, provider: 'jev', model: 'rule-fallback', callIds: [], fallback: `exception:${(e as Error).message}` }))
        .then((ans) => engine.resolve(req.id, ans))
        .finally(() => this.inflight.delete(req.id));
    }
  }

  get busy(): number {
    return this.inflight.size;
  }

  async drain(engine: Engine): Promise<void> {
    while (engine.pendingRequests().length > 0 || this.inflight.size > 0) {
      this.pump(engine);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}

export class LiveRun {
  readonly id: string;
  row: RunRow;
  engine: Engine;
  speed = 60;
  paused = true;
  blocked = false;
  dialogue = true;
  private carry = 0;
  private lastWall = performance.now();
  private buffer: DomainEvent[] = [];
  private clients = new Set<WebSocket>();
  /** 有人在看（有连接）就不从内存卸下 */
  get watched(): boolean {
    return this.clients.size > 0;
  }
  private lastSnapT: SimTime;
  private decisions: DecisionService;
  private placeKind: Record<string, string>;
  /** 现场叙事：服务端逐事件合成节拍，推给前端（spec v1 §2.1） */
  private chronicle?: ChronicleBuilder;
  private beats: Beat[] = [];
  /** 取完整历史（分支沿父链），用于首次合成节拍 */
  historyOf?: () => DomainEvent[];
  lastTouched = Date.now();

  constructor(
    private store: Store,
    row: RunRow,
    engine: Engine,
    private jev: JevProvider,
    private dialogues: DialogueRenderer,
  ) {
    this.id = row.id;
    this.row = row;
    this.engine = engine;
    this.lastSnapT = engine.now;
    this.decisions = new DecisionService(jev, row.id);
    this.placeKind = Object.fromEntries(Object.values(engine.map.places).map((p) => [p.id, p.kind]));
    engine.onEvent((e) => this.buffer.push(e));
    engine.onRecord((r) => {
      store.saveDecision(this.id, r);
      this.broadcast({ type: 'decision', record: { id: r.id, agent: r.agent, agentName: r.agentName, kind: r.kind, chosen: r.chosen, provider: r.provider, summary: r.summary, ...(r.fallback ? { fallback: r.fallback } : {}) } });
    });
  }

  status(): RunStatus {
    return {
      id: this.id,
      name: this.row.name,
      scenario: this.row.scenario,
      provider: this.row.provider,
      seed: this.row.seed,
      t: this.engine.now,
      seq: this.engine.state.meta.seq,
      speed: this.speed,
      paused: this.paused,
      blocked: this.blocked,
      pending: Object.keys(this.engine.state.pending).length,
      spend: this.store.spend(this.id),
      parent: this.row.parent_run_id,
      forkT: this.row.fork_t,
      branch: this.row.branch,
      experimentId: this.row.experiment_id,
      dialogue: this.dialogue,
    };
  }

  setSpeed(s: number): void {
    this.speed = Math.max(1, Math.min(600, s));
  }

  play(): void {
    if (!this.paused) return;
    this.paused = false;
    this.lastWall = performance.now();
    this.carry = 0;
  }

  pause(): void {
    this.paused = true;
    this.flush();
  }

  /** 单步：推进到下一个事件或 10 模拟分钟 */
  async step(kind: 'event' | '10min'): Promise<void> {
    this.paused = true;
    const target = kind === '10min' ? this.engine.now + 600 : (this.engine.nextTaskTime() ?? this.engine.now + 60);
    for (let guard = 0; guard < 200; guard++) {
      const r = this.engine.advance(target);
      if (!r.blockedOn) break;
      this.decisions.pump(this.engine);
      await new Promise((res) => setTimeout(res, 30));
    }
    this.flush();
  }

  tick(): void {
    if (!this.paused) {
      const now = performance.now();
      const dt = Math.min(1, (now - this.lastWall) / 1000);
      this.lastWall = now;
      this.carry += dt * this.speed;
      const step = Math.floor(this.carry);
      this.carry -= step;
      const r = this.engine.advance(this.engine.now + step);
      this.blocked = !!r.blockedOn;
      if (this.blocked) this.carry = 0;
    }
    if (this.row.provider === 'jev') this.decisions.pump(this.engine);
    this.flush();
    this.broadcast({ type: 'clock', run: this.status() });
  }

  /** 节拍合成器：第一次需要时用完整历史预热 */
  private ensureChronicle(): ChronicleBuilder {
    if (this.chronicle) return this.chronicle;
    const names = new Map(Object.values(this.engine.map.places).map((p) => [p.id, p.name]));
    const b = new ChronicleBuilder({ placeName: (id) => names.get(id) ?? id });
    const byId = new Map<string, Beat>();
    const pendingIds = new Set(this.buffer.map((e) => e.seq));
    for (const e of this.historyOf?.() ?? []) {
      if (pendingIds.has(e.seq)) continue;
      for (const x of b.push(e, this.engine.state)) if (x.level === 'feed' || x.level === 'key') byId.set(x.id, x);
    }
    this.beats = [...byId.values()].slice(-400);
    this.chronicle = b;
    return b;
  }

  flush(): void {
    // 先用历史预热节拍合成器（不含这一批），再逐条合成这一批
    if (this.buffer.length > 0 && (this.clients.size > 0 || this.chronicle)) this.ensureChronicle();
    if (this.buffer.length > 0) {
      const batch = this.buffer;
      this.buffer = [];
      this.store.appendEvents(this.id, batch);
      this.broadcast({ type: 'events', events: batch });
      if (this.chronicle) {
        const ch = this.chronicle;
        const fresh = new Map<string, Beat>();
        for (const e of batch) for (const x of ch.push(e, this.engine.state)) fresh.set(x.id, x);
        if (fresh.size) {
          for (const x of fresh.values()) {
            const i = this.beats.findIndex((y) => y.id === x.id);
            if (i >= 0) this.beats[i] = x;
            else this.beats.push(x);
          }
          if (this.beats.length > 400) this.beats = this.beats.slice(-400);
          this.broadcast({ type: 'beats', beats: [...fresh.values()] });
        }
      }
      if (this.dialogue) {
        for (const e of batch) {
          if (e.type !== 'conversation' || e.topic !== 'news') continue;
          const p = this.engine.map.places[e.place];
          void this.dialogues.render(this.id, e, this.engine.state, this.placeKind[e.place] ?? 'default', p?.name ?? e.place, formatTime(e.t)).then((d) => this.broadcast({ type: 'dialogue', convId: d.convId, lines: d.lines, model: d.model }));
        }
      }
    }
    if (this.engine.now - this.lastSnapT >= SNAPSHOT_EVERY) this.saveSnapshot();
  }

  saveSnapshot(): void {
    const snap = this.engine.snapshot();
    this.store.saveSnapshot(this.id, snap, contentHash(snap.state));
    this.lastSnapT = this.engine.now;
  }

  addClient(ws: WebSocket): void {
    // 先把缓冲区落库并发给已有客户端，再给新客户端完整状态，避免它收到重复/早于 hello 的事件
    this.flush();
    this.ensureChronicle();
    ws.send(JSON.stringify({ type: 'hello', run: this.status(), state: this.engine.state, beats: this.beats } satisfies ServerMessage));
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
  }

  get clientCount(): number {
    return this.clients.size;
  }

  broadcast(msg: ServerMessage): void {
    if (this.clients.size === 0) return;
    const s = JSON.stringify(msg);
    for (const c of this.clients) if (c.readyState === 1) c.send(s);
  }

  publish(draft: NewsDraft, channels: PublishChannel[]): void {
    this.engine.intervenePublish(draft, channels);
    this.flush();
  }

  /** 全速推进到 until（分支批跑用），外部决策等答案 */
  async runHeadless(until: SimTime, onProgress?: (t: SimTime) => void): Promise<void> {
    this.paused = true;
    for (;;) {
      const r = this.engine.advance(until);
      this.flush();
      onProgress?.(this.engine.now);
      if (!r.blockedOn) break;
      this.decisions.pump(this.engine);
      await new Promise((res) => setTimeout(res, 20));
    }
    await this.decisions.drain(this.engine);
    this.flush();
  }
}

export class RunManager {
  readonly live = new Map<string, LiveRun>();
  readonly jev: JevProvider;
  readonly dialogues: DialogueRenderer;
  readonly scenarios: ScenarioRegistry;
  private timer?: NodeJS.Timeout;

  constructor(readonly store: Store) {
    this.jev = new JevProvider(store);
    this.dialogues = new DialogueRenderer(store);
    this.scenarios = new ScenarioRegistry(store);
  }

  start(): void {
    this.timer = setInterval(() => {
      for (const r of this.live.values()) {
        try {
          r.tick();
        } catch (e) {
          r.paused = true;
          console.error(`[run ${r.id}] tick failed`, e);
        }
      }
    }, 100);
    if (config.publicMode) {
      // 演示站：闲置的运行存快照后从内存卸下（下次访问从快照恢复）；过期的访客数据清理掉
      this.housekeeping = setInterval(() => this.housekeep(), 60_000);
      this.housekeep();
    }
  }

  private housekeeping?: NodeJS.Timeout;
  private lastCleanup = 0;

  housekeep(): void {
    const idle = config.publicLimits.idleMinutes * 60_000;
    for (const [id, r] of this.live) {
      if (r.paused && !r.watched && Date.now() - r.lastTouched > idle) {
        r.saveSnapshot();
        this.live.delete(id);
      }
    }
    if (Date.now() - this.lastCleanup < 3_600_000) return;
    this.lastCleanup = Date.now();
    const before = new Date(Date.now() - config.publicLimits.keepHours * 3_600_000).toISOString();
    for (const id of this.store.staleExperiments(before)) this.store.deleteExperiment(id);
    for (const id of this.store.staleRuns(before)) {
      if (this.live.get(id)?.watched) continue;
      this.live.delete(id);
      this.store.deleteRun(id);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.housekeeping) clearInterval(this.housekeeping);
    for (const r of this.live.values()) {
      r.pause();
      r.saveSnapshot();
    }
  }

  scenarioOf(runId: string): ScenarioDef {
    const row = this.store.getRun(runId);
    if (!row) throw new Error('run not found');
    return this.scenarios.require(row.scenario);
  }

  create(p: { name?: string; seed: number; provider: 'rule' | 'jev'; script?: 'outage' | 'quiet'; scenario?: string }): LiveRun {
    const sc = this.scenarios.require(p.scenario ?? 'town30');
    const id = `run_${randomUUID().slice(0, 8)}`;
    const script = p.script === 'quiet' ? quietScript(sc) : sc.script;
    const row: Omit<RunRow, 'created_at'> = {
      id,
      name: p.name ?? `${sc.name} · seed ${p.seed} · ${p.provider === 'jev' ? 'Jev' : '规则'}${p.script === 'quiet' ? ' · 不发通知' : ''}`,
      scenario: sc.id,
      seed: p.seed,
      provider: p.provider,
      parent_run_id: null,
      fork_seq: null,
      fork_t: null,
      manifest: JSON.stringify({ script: p.script ?? 'outage' }),
      status: 'live',
      experiment_id: null,
      branch: null,
    };
    this.store.insertRun(row);
    const engine = Engine.create(sc, { seed: p.seed, decisionMode: p.provider === 'jev' ? 'external' : 'rule', script });
    const run = new LiveRun(this.store, this.store.getRun(id)!, engine, this.jev, this.dialogues);
    run.historyOf = () => this.history(id);
    if (config.publicMode) run.dialogue = false;
    run.flush();
    run.saveSnapshot();
    this.live.set(id, run);
    return run;
  }

  /** 载入：内存里有就直接用；否则从最近快照恢复（之后的事件丢弃，由确定性内核重新生成） */
  get(id: string): LiveRun | undefined {
    const hit = this.live.get(id);
    if (hit) {
      hit.lastTouched = Date.now();
      return hit;
    }
    const row = this.store.getRun(id);
    if (!row) return undefined;
    const snap = this.store.loadSnapshot(id);
    if (!snap) return undefined;
    const sc = this.scenarios.get(row.scenario);
    if (!sc) return undefined;
    this.store.deleteEventsAfter(id, snap.seq);
    const engine = Engine.restore(snap.snap, sc, { decisionMode: row.provider === 'jev' ? 'external' : 'rule' });
    const run = new LiveRun(this.store, row, engine, this.jev, this.dialogues);
    run.historyOf = () => this.history(id);
    run.dialogue = !row.experiment_id && !config.publicMode;
    this.live.set(id, run);
    return run;
  }

  list(): Array<RunRow & { live: boolean; scenarioName: string }> {
    return this.store.listRuns().map((r) => ({ ...r, live: this.live.has(r.id), scenarioName: this.scenarios.get(r.scenario)?.name ?? r.scenario }));
  }

  /** 一条运行的完整历史事件（分支沿父链拼接） */
  history(id: string, opts: { after?: number; upto?: number; limit?: number; types?: string[] } = {}): DomainEvent[] {
    const row = this.store.getRun(id);
    if (!row) return [];
    const own = this.store.events(id, opts);
    if (!row.parent_run_id || row.fork_seq === null) return own;
    if ((opts.after ?? 0) >= row.fork_seq) return own;
    const parent = this.history(row.parent_run_id, { ...opts, upto: Math.min(opts.upto ?? Number.MAX_SAFE_INTEGER, row.fork_seq) });
    return [...parent, ...own].slice(0, opts.limit ?? Number.MAX_SAFE_INTEGER);
  }

  /** 这条运行的初始状态（重放、曲线、报告都从这里开始） */
  initialState(id: string): WorldState {
    const row = this.store.getRun(id);
    if (!row) throw new Error('run not found');
    return buildInitialState(this.scenarios.require(row.scenario), row.seed);
  }

  agentHistory(id: string, agent: string, limit = 500): DomainEvent[] {
    const row = this.store.getRun(id);
    if (!row) return [];
    const own = this.store.eventsForAgent(id, agent, { limit });
    if (own.length >= limit || !row.parent_run_id || row.fork_seq === null) return own;
    const parent = this.store.eventsForAgent(row.parent_run_id, agent, { limit: limit - own.length, before: row.fork_seq + 1 });
    return [...parent, ...own];
  }

  decisions(id: string, agent?: string): DecisionRecord[] {
    const row = this.store.getRun(id);
    if (!row) return [];
    const own = this.store.decisionsFor(id, agent);
    if (!row.parent_run_id || row.fork_t === null) return own;
    return [...this.decisions(row.parent_run_id, agent).filter((d) => d.commitAt <= row.fork_t!), ...own];
  }

  decision(id: string, did: string): DecisionRecord | undefined {
    const row = this.store.getRun(id);
    if (!row) return undefined;
    return this.store.decision(id, did) ?? (row.parent_run_id ? this.decision(row.parent_run_id, did) : undefined);
  }

  /** 某个模拟时刻对应的最后一个事件序号（沿父链） */
  seqAtTime(id: string, t: number): number {
    const row = this.store.getRun(id);
    if (!row) return 0;
    if (row.parent_run_id && row.fork_t !== null && t <= row.fork_t) return this.seqAtTime(row.parent_run_id, t);
    const r = this.store.db.prepare('SELECT MAX(seq) AS s FROM events WHERE run_id = ? AND t <= ?').get(id, t) as { s: number | null };
    if (r.s !== null) return r.s;
    return row.fork_seq ?? 0;
  }

  /** 历史时刻的状态：最近快照 + 之后的事件（只读回放，不重新请求模型） */
  stateAt(id: string, seq: number): WorldState | undefined {
    const row = this.store.getRun(id);
    if (!row) return undefined;
    if (row.parent_run_id && row.fork_seq !== null && seq <= row.fork_seq) return this.stateAt(row.parent_run_id, seq);
    const snap = this.store.loadSnapshot(id, seq);
    if (!snap) {
      if (row.parent_run_id && row.fork_seq !== null) return this.stateAt(row.parent_run_id, Math.min(seq, row.fork_seq));
      return undefined;
    }
    const s = snap.snap.state;
    applyAll(s, this.store.events(id, { after: snap.seq, upto: seq }));
    return s;
  }

  /** 重放校验：初始状态 + 全部事件 重建出的哈希 == 当前状态哈希 */
  replayCheck(id: string): { ok: boolean; events: number; rebuilt: string; live: string; checkpoints: Array<{ seq: number; ok: boolean }> } {
    const run = this.get(id)!;
    run.flush();
    const all = this.history(id);
    const rebuilt = this.initialState(id);
    const checkpoints: Array<{ seq: number; ok: boolean }> = [];
    const snaps = this.store.db.prepare('SELECT seq, hash FROM snapshots WHERE run_id = ? ORDER BY seq').all(id) as Array<{ seq: number; hash: string }>;
    let i = 0;
    for (const e of all) {
      applyAll(rebuilt, [e]);
      while (i < snaps.length && snaps[i]!.seq <= e.seq) {
        if (snaps[i]!.seq === e.seq) checkpoints.push({ seq: e.seq, ok: contentHash(rebuilt) === snaps[i]!.hash });
        i++;
      }
    }
    const h1 = contentHash(rebuilt);
    const h2 = contentHash(run.engine.state);
    return { ok: h1 === h2 && checkpoints.every((c) => c.ok), events: all.length, rebuilt: h1.slice(0, 12), live: h2.slice(0, 12), checkpoints: checkpoints.slice(-20) };
  }

  /** 手动分叉：从 at 时刻之前的快照复制出一条新运行 */
  fork(id: string, p: { at?: string; name?: string; branch?: BranchSpec }): LiveRun {
    const src = this.get(id);
    if (!src) throw new Error('run not found');
    src.flush();
    src.saveSnapshot();
    const t = p.at ? parseTime(p.at) : src.engine.now;
    const snap = this.store.snapshotBeforeTime(id, t) ?? this.store.loadSnapshot(id);
    if (!snap) throw new Error('no snapshot');
    const sc = this.scenarios.require(src.row.scenario);
    const script = p.branch ? branchScript(sc, p.branch) : snap.snap.script;
    const nid = `run_${randomUUID().slice(0, 8)}`;
    this.store.insertRun({ id: nid, name: p.name ?? `${src.row.name} · 分叉@${formatTime(snap.snap.now)}`, scenario: sc.id, seed: src.row.seed, provider: src.row.provider, parent_run_id: id, fork_seq: snap.seq, fork_t: snap.snap.now, manifest: JSON.stringify({ branch: p.branch ?? null }), status: 'live', experiment_id: null, branch: p.branch?.label ?? null });
    const engine = Engine.restore(snap.snap, sc, { decisionMode: src.row.provider === 'jev' ? 'external' : 'rule', script });
    const run = new LiveRun(this.store, this.store.getRun(nid)!, engine, this.jev, this.dialogues);
    run.historyOf = () => this.history(nid);
    run.saveSnapshot();
    this.live.set(nid, run);
    return run;
  }

  /** 实验分支：落库的运行（第一个 seed 用） */
  attach(row: Omit<RunRow, 'created_at'>, engine: Engine): LiveRun {
    this.store.insertRun(row);
    const run = new LiveRun(this.store, this.store.getRun(row.id)!, engine, this.jev, this.dialogues);
    run.dialogue = false;
    return run;
  }
}

/** 不落库的全速推进（多 seed 实验的其余 seed）：外部决策照常问 Jev，调用记在合成运行 id 名下 */
export async function driveHeadless(engine: Engine, until: SimTime, decisions: DecisionService | null): Promise<void> {
  for (;;) {
    const r = engine.advance(until);
    if (!r.blockedOn) return;
    if (!decisions) throw new Error('外部决策需要 DecisionService');
    decisions.pump(engine);
    await new Promise((res) => setTimeout(res, 15));
  }
}

export type { PublishChannel, NewsDraft };
