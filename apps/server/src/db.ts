import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { gunzipSync, gzipSync } from 'node:zlib';
import { eventAgents, type DecisionRecord, type DomainEvent, type EngineSnapshot } from '@microcity/sim';

/** 单调递增：旧库不兼容时直接拒绝（预发布阶段不做迁移） */
export const SCHEMA_VERSION = 2;

export interface RunRow {
  id: string;
  name: string;
  scenario: string;
  seed: number;
  provider: 'rule' | 'jev';
  parent_run_id: string | null;
  fork_seq: number | null;
  fork_t: number | null;
  manifest: string | null;
  status: string;
  created_at: string;
  experiment_id: string | null;
  branch: string | null;
}

export interface ModelCallRow {
  id: string;
  run_id: string | null;
  provider: string;
  model: string;
  purpose: string;
  cache_key: string;
  request: string;
  response: string | null;
  cost_usd: number;
  latency_ms: number;
  cached: number;
  error: string | null;
  created_at: string;
}

export class Store {
  readonly db: DatabaseSync;
  private st: Record<string, StatementSync> = {};

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(resolve(file, '..'), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
    if (row && Number(row.value) !== SCHEMA_VERSION) throw new Error(`数据库 schema ${row.value} 与代码 ${SCHEMA_VERSION} 不一致：删除 data/ 后重启`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, scenario TEXT NOT NULL, seed INTEGER NOT NULL, provider TEXT NOT NULL,
        parent_run_id TEXT, fork_seq INTEGER, fork_t INTEGER, manifest TEXT, status TEXT NOT NULL,
        created_at TEXT NOT NULL, experiment_id TEXT, branch TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        run_id TEXT NOT NULL, seq INTEGER NOT NULL, t INTEGER NOT NULL, type TEXT NOT NULL, agents TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY (run_id, seq)
      );
      CREATE INDEX IF NOT EXISTS events_type ON events (run_id, type, seq);
      CREATE TABLE IF NOT EXISTS event_agents (run_id TEXT NOT NULL, agent TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (run_id, agent, seq));
      CREATE TABLE IF NOT EXISTS snapshots (run_id TEXT NOT NULL, seq INTEGER NOT NULL, t INTEGER NOT NULL, hash TEXT NOT NULL, blob BLOB NOT NULL, PRIMARY KEY (run_id, seq));
      CREATE TABLE IF NOT EXISTS decisions (run_id TEXT NOT NULL, id TEXT NOT NULL, agent TEXT NOT NULL, t INTEGER NOT NULL, kind TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY (run_id, id));
      CREATE INDEX IF NOT EXISTS decisions_agent ON decisions (run_id, agent, t);
      CREATE TABLE IF NOT EXISTS model_calls (
        id TEXT PRIMARY KEY, run_id TEXT, provider TEXT NOT NULL, model TEXT NOT NULL, purpose TEXT NOT NULL, cache_key TEXT NOT NULL,
        request TEXT NOT NULL, response TEXT, cost_usd REAL NOT NULL, latency_ms INTEGER NOT NULL, cached INTEGER NOT NULL, error TEXT, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS model_calls_run ON model_calls (run_id);
      CREATE TABLE IF NOT EXISTS answer_cache (key TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dialogues (run_id TEXT NOT NULL, conv_id TEXT NOT NULL, lines TEXT NOT NULL, model TEXT NOT NULL, cost_usd REAL NOT NULL, validated INTEGER NOT NULL, PRIMARY KEY (run_id, conv_id));
      CREATE TABLE IF NOT EXISTS experiments (id TEXT PRIMARY KEY, manifest TEXT NOT NULL, status TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL, error TEXT);
      CREATE TABLE IF NOT EXISTS scenarios (id TEXT PRIMARY KEY, name TEXT NOT NULL, spec TEXT NOT NULL, hash TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS builder_sessions (id TEXT PRIMARY KEY, spec TEXT NOT NULL, messages TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, subject TEXT NOT NULL, fact_hash TEXT NOT NULL, model TEXT NOT NULL, source TEXT NOT NULL, content TEXT NOT NULL, facts TEXT NOT NULL, validation TEXT, cost_usd REAL NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS reports_subject ON reports (subject, created_at);
    `);
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
  }

  private q(sql: string): StatementSync {
    return (this.st[sql] ??= this.db.prepare(sql));
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---- runs ----
  insertRun(r: Omit<RunRow, 'created_at'>): void {
    this.q('INSERT INTO runs (id, name, scenario, seed, provider, parent_run_id, fork_seq, fork_t, manifest, status, created_at, experiment_id, branch) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      r.id, r.name, r.scenario, r.seed, r.provider, r.parent_run_id, r.fork_seq, r.fork_t, r.manifest, r.status, new Date().toISOString(), r.experiment_id, r.branch,
    );
  }
  setRunStatus(id: string, status: string): void {
    this.q('UPDATE runs SET status = ? WHERE id = ?').run(status, id);
  }
  renameRun(id: string, name: string): void {
    this.q('UPDATE runs SET name = ? WHERE id = ?').run(name, id);
  }
  getRun(id: string): RunRow | undefined {
    return this.q('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
  }
  listRuns(): RunRow[] {
    return this.q('SELECT * FROM runs ORDER BY created_at DESC').all() as unknown as RunRow[];
  }

  // ---- events ----
  appendEvents(runId: string, events: DomainEvent[]): void {
    if (events.length === 0) return;
    const ins = this.q('INSERT INTO events (run_id, seq, t, type, agents, payload) VALUES (?,?,?,?,?,?)');
    const insA = this.q('INSERT OR IGNORE INTO event_agents (run_id, agent, seq) VALUES (?,?,?)');
    this.tx(() => {
      for (const e of events) {
        const agents = eventAgents(e);
        ins.run(runId, e.seq, e.t, e.type, JSON.stringify(agents), JSON.stringify(e));
        for (const a of agents) insA.run(runId, a, e.seq);
      }
    });
  }
  events(runId: string, opts: { after?: number; upto?: number; limit?: number; types?: string[] } = {}): DomainEvent[] {
    const after = opts.after ?? 0;
    const upto = opts.upto ?? Number.MAX_SAFE_INTEGER;
    const limit = opts.limit ?? 1_000_000;
    let rows: Array<{ payload: string }>;
    if (opts.types?.length) {
      const ph = opts.types.map(() => '?').join(',');
      rows = this.db.prepare(`SELECT payload FROM events WHERE run_id = ? AND seq > ? AND seq <= ? AND type IN (${ph}) ORDER BY seq LIMIT ?`).all(runId, after, upto, ...opts.types, limit) as Array<{ payload: string }>;
    } else rows = this.q('SELECT payload FROM events WHERE run_id = ? AND seq > ? AND seq <= ? ORDER BY seq LIMIT ?').all(runId, after, upto, limit) as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as DomainEvent);
  }
  eventsForAgent(runId: string, agent: string, opts: { limit?: number; before?: number } = {}): DomainEvent[] {
    const rows = this.q(
      'SELECT e.payload FROM event_agents a JOIN events e ON e.run_id = a.run_id AND e.seq = a.seq WHERE a.run_id = ? AND a.agent = ? AND a.seq < ? ORDER BY a.seq DESC LIMIT ?',
    ).all(runId, agent, opts.before ?? Number.MAX_SAFE_INTEGER, opts.limit ?? 400) as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as DomainEvent).reverse();
  }
  lastSeq(runId: string): number {
    const r = this.q('SELECT MAX(seq) AS m FROM events WHERE run_id = ?').get(runId) as { m: number | null };
    return r.m ?? 0;
  }
  deleteEventsAfter(runId: string, seq: number): void {
    this.q('DELETE FROM events WHERE run_id = ? AND seq > ?').run(runId, seq);
    this.q('DELETE FROM event_agents WHERE run_id = ? AND seq > ?').run(runId, seq);
    this.q('DELETE FROM snapshots WHERE run_id = ? AND seq > ?').run(runId, seq);
  }

  // ---- snapshots ----
  saveSnapshot(runId: string, snap: EngineSnapshot, hash: string): void {
    const blob = gzipSync(Buffer.from(JSON.stringify(snap)));
    this.q('INSERT OR REPLACE INTO snapshots (run_id, seq, t, hash, blob) VALUES (?,?,?,?,?)').run(runId, snap.state.meta.seq, snap.now, hash, blob);
  }
  loadSnapshot(runId: string, atOrBeforeSeq = Number.MAX_SAFE_INTEGER): { seq: number; t: number; hash: string; snap: EngineSnapshot } | undefined {
    const r = this.q('SELECT seq, t, hash, blob FROM snapshots WHERE run_id = ? AND seq <= ? ORDER BY seq DESC LIMIT 1').get(runId, atOrBeforeSeq) as
      | { seq: number; t: number; hash: string; blob: Uint8Array }
      | undefined;
    if (!r) return undefined;
    return { seq: r.seq, t: r.t, hash: r.hash, snap: JSON.parse(gunzipSync(Buffer.from(r.blob)).toString()) as EngineSnapshot };
  }
  snapshotBeforeTime(runId: string, t: number): { seq: number; t: number; snap: EngineSnapshot } | undefined {
    const r = this.q('SELECT seq, t, blob FROM snapshots WHERE run_id = ? AND t <= ? ORDER BY seq DESC LIMIT 1').get(runId, t) as { seq: number; t: number; blob: Uint8Array } | undefined;
    if (!r) return undefined;
    return { seq: r.seq, t: r.t, snap: JSON.parse(gunzipSync(Buffer.from(r.blob)).toString()) as EngineSnapshot };
  }

  // ---- decisions ----
  saveDecision(runId: string, r: DecisionRecord): void {
    this.q('INSERT OR REPLACE INTO decisions (run_id, id, agent, t, kind, record) VALUES (?,?,?,?,?,?)').run(runId, r.id, r.agent, r.t, r.kind, JSON.stringify(r));
  }
  decision(runId: string, id: string): DecisionRecord | undefined {
    const r = this.q('SELECT record FROM decisions WHERE run_id = ? AND id = ?').get(runId, id) as { record: string } | undefined;
    return r ? (JSON.parse(r.record) as DecisionRecord) : undefined;
  }
  decisionsFor(runId: string, agent?: string): DecisionRecord[] {
    const rows = (agent ? this.q('SELECT record FROM decisions WHERE run_id = ? AND agent = ? ORDER BY t').all(runId, agent) : this.q('SELECT record FROM decisions WHERE run_id = ? ORDER BY t').all(runId)) as Array<{ record: string }>;
    return rows.map((x) => JSON.parse(x.record) as DecisionRecord);
  }
  decisionStats(runId: string): { total: number; byProvider: Record<string, number>; fallbacks: number } {
    const rows = this.decisionsFor(runId);
    const byProvider: Record<string, number> = {};
    let fallbacks = 0;
    for (const r of rows) {
      byProvider[r.provider] = (byProvider[r.provider] ?? 0) + 1;
      if (r.fallback) fallbacks++;
    }
    return { total: rows.length, byProvider, fallbacks };
  }

  // ---- model calls / cache / spend ----
  logModelCall(c: Omit<ModelCallRow, 'created_at'>): void {
    this.q('INSERT OR REPLACE INTO model_calls (id, run_id, provider, model, purpose, cache_key, request, response, cost_usd, latency_ms, cached, error, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      c.id, c.run_id, c.provider, c.model, c.purpose, c.cache_key, c.request, c.response, c.cost_usd, c.latency_ms, c.cached, c.error, new Date().toISOString(),
    );
  }
  modelCall(id: string): ModelCallRow | undefined {
    return this.q('SELECT * FROM model_calls WHERE id = ?').get(id) as ModelCallRow | undefined;
  }
  spend(runId?: string): number {
    const r = (runId ? this.q('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM model_calls WHERE run_id = ?').get(runId) : this.q('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM model_calls').get()) as { s: number };
    return r.s;
  }
  callStats(runId: string): { calls: number; cached: number; errors: number; cost: number; avgLatency: number } {
    const r = this.q('SELECT COUNT(*) AS n, SUM(cached) AS c, SUM(CASE WHEN error IS NULL THEN 0 ELSE 1 END) AS e, COALESCE(SUM(cost_usd),0) AS s, COALESCE(AVG(CASE WHEN cached = 0 THEN latency_ms END), 0) AS l FROM model_calls WHERE run_id = ?').get(runId) as {
      n: number;
      c: number | null;
      e: number | null;
      s: number;
      l: number;
    };
    return { calls: r.n, cached: r.c ?? 0, errors: r.e ?? 0, cost: r.s, avgLatency: Math.round(r.l) };
  }
  cacheGet(key: string): string | undefined {
    const r = this.q('SELECT response FROM answer_cache WHERE key = ?').get(key) as { response: string } | undefined;
    return r?.response;
  }
  cachePut(key: string, provider: string, model: string, response: string): void {
    this.q('INSERT OR REPLACE INTO answer_cache (key, provider, model, response, created_at) VALUES (?,?,?,?,?)').run(key, provider, model, response, new Date().toISOString());
  }

  // ---- dialogues ----
  dialogue(runId: string, convId: string): { lines: unknown[]; model: string; validated: boolean } | undefined {
    const r = this.q('SELECT lines, model, validated FROM dialogues WHERE run_id = ? AND conv_id = ?').get(runId, convId) as { lines: string; model: string; validated: number } | undefined;
    return r ? { lines: JSON.parse(r.lines) as unknown[], model: r.model, validated: !!r.validated } : undefined;
  }
  saveDialogue(runId: string, convId: string, lines: unknown[], model: string, cost: number, validated: boolean): void {
    this.q('INSERT OR REPLACE INTO dialogues (run_id, conv_id, lines, model, cost_usd, validated) VALUES (?,?,?,?,?,?)').run(runId, convId, JSON.stringify(lines), model, cost, validated ? 1 : 0);
  }

  // ---- experiments ----
  /** 删掉一条运行及其全部数据；从它分叉出去的运行一并删除（模型调用记录保留，花费要对得上） */
  deleteRun(id: string): void {
    for (const c of this.q('SELECT id FROM runs WHERE parent_run_id = ?').all(id) as Array<{ id: string }>) this.deleteRun(c.id);
    for (const t of ['events', 'event_agents', 'snapshots', 'decisions', 'dialogues']) this.q(`DELETE FROM ${t} WHERE run_id = ?`).run(id);
    this.q('DELETE FROM reports WHERE subject = ?').run(`run:${id}`);
    this.q('DELETE FROM runs WHERE id = ?').run(id);
  }

  /** 删掉一个实验、它落库的运行与报告 */
  deleteExperiment(id: string): void {
    for (const r of this.q("SELECT id FROM runs WHERE experiment_id = ? ORDER BY CASE WHEN branch = 'base' THEN 1 ELSE 0 END").all(id) as Array<{ id: string }>) this.deleteRun(r.id);
    this.q('DELETE FROM reports WHERE subject = ?').run(`exp:${id}`);
    this.q('DELETE FROM experiments WHERE id = ?').run(id);
  }

  /** 演示站清理用：某时刻之前创建的实验（精选实验除外）与独立运行 */
  staleExperiments(before: string): string[] {
    return (this.q('SELECT id, manifest FROM experiments WHERE created_at < ?').all(before) as Array<{ id: string; manifest: string }>).filter((r) => !String((JSON.parse(r.manifest) as { id?: string }).id ?? '').startsWith('gallery:')).map((r) => r.id);
  }
  staleRuns(before: string): string[] {
    return (this.q('SELECT id FROM runs WHERE experiment_id IS NULL AND parent_run_id IS NULL AND created_at < ?').all(before) as Array<{ id: string }>).map((r) => r.id);
  }

  insertExperiment(id: string, manifest: unknown): void {
    this.q('INSERT INTO experiments (id, manifest, status, result, created_at, error) VALUES (?,?,?,?,?,?)').run(id, JSON.stringify(manifest), 'running', null, new Date().toISOString(), null);
  }
  updateExperiment(id: string, status: string, result: unknown, error?: string): void {
    this.q('UPDATE experiments SET status = ?, result = ?, error = ? WHERE id = ?').run(status, JSON.stringify(result), error ?? null, id);
  }
  experiment(id: string): { id: string; manifest: unknown; status: string; result: unknown; created_at: string; error: string | null } | undefined {
    const r = this.q('SELECT * FROM experiments WHERE id = ?').get(id) as { id: string; manifest: string; status: string; result: string | null; created_at: string; error: string | null } | undefined;
    return r ? { ...r, manifest: JSON.parse(r.manifest), result: r.result ? JSON.parse(r.result) : null } : undefined;
  }
  listExperiments(): Array<{ id: string; status: string; created_at: string; manifest: unknown }> {
    return (this.q('SELECT id, status, created_at, manifest FROM experiments ORDER BY created_at DESC').all() as Array<{ id: string; status: string; created_at: string; manifest: string }>).map((r) => ({ ...r, manifest: JSON.parse(r.manifest) }));
  }

  // ---- scenarios（登记的生成场景：规格按内容哈希去重） ----
  putScenario(r: { id: string; name: string; spec: unknown; hash: string; source: string }): void {
    this.q('INSERT OR IGNORE INTO scenarios (id, name, spec, hash, source, created_at) VALUES (?,?,?,?,?,?)').run(r.id, r.name, JSON.stringify(r.spec), r.hash, r.source, new Date().toISOString());
  }
  scenario(id: string): { id: string; name: string; spec: unknown; hash: string; source: string; created_at: string } | undefined {
    const r = this.q('SELECT * FROM scenarios WHERE id = ?').get(id) as { id: string; name: string; spec: string; hash: string; source: string; created_at: string } | undefined;
    return r ? { ...r, spec: JSON.parse(r.spec) } : undefined;
  }
  listScenarios(): Array<{ id: string; name: string; hash: string; source: string; created_at: string }> {
    return this.q('SELECT id, name, hash, source, created_at FROM scenarios ORDER BY created_at DESC').all() as Array<{ id: string; name: string; hash: string; source: string; created_at: string }>;
  }

  // ---- builder sessions ----
  saveSession(id: string, spec: unknown, messages: unknown[]): void {
    const now = new Date().toISOString();
    this.q('INSERT INTO builder_sessions (id, spec, messages, created_at, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET spec = excluded.spec, messages = excluded.messages, updated_at = excluded.updated_at').run(id, JSON.stringify(spec), JSON.stringify(messages), now, now);
  }
  session(id: string): { id: string; spec: unknown; messages: unknown[]; created_at: string; updated_at: string } | undefined {
    const r = this.q('SELECT * FROM builder_sessions WHERE id = ?').get(id) as { id: string; spec: string; messages: string; created_at: string; updated_at: string } | undefined;
    return r ? { ...r, spec: JSON.parse(r.spec), messages: JSON.parse(r.messages) as unknown[] } : undefined;
  }

  // ---- reports ----
  saveReport(r: { id: string; subject: string; factHash: string; model: string; source: string; content: unknown; facts: unknown; validation: unknown; cost: number }): void {
    this.q('INSERT OR REPLACE INTO reports (id, subject, fact_hash, model, source, content, facts, validation, cost_usd, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
      r.id, r.subject, r.factHash, r.model, r.source, JSON.stringify(r.content), JSON.stringify(r.facts), JSON.stringify(r.validation ?? null), r.cost, new Date().toISOString(),
    );
  }
  latestReport(subject: string): { id: string; subject: string; fact_hash: string; model: string; source: string; content: unknown; facts: unknown; validation: unknown; cost_usd: number; created_at: string } | undefined {
    const r = this.q('SELECT * FROM reports WHERE subject = ? ORDER BY created_at DESC LIMIT 1').get(subject) as
      | { id: string; subject: string; fact_hash: string; model: string; source: string; content: string; facts: string; validation: string | null; cost_usd: number; created_at: string }
      | undefined;
    return r ? { ...r, content: JSON.parse(r.content), facts: JSON.parse(r.facts), validation: r.validation ? JSON.parse(r.validation) : null } : undefined;
  }
  reportByHash(subject: string, factHash: string, model: string): ReturnType<Store['latestReport']> {
    const r = this.q('SELECT * FROM reports WHERE subject = ? AND fact_hash = ? AND model = ? ORDER BY created_at DESC LIMIT 1').get(subject, factHash, model) as
      | { id: string; subject: string; fact_hash: string; model: string; source: string; content: string; facts: string; validation: string | null; cost_usd: number; created_at: string }
      | undefined;
    return r ? { ...r, content: JSON.parse(r.content), facts: JSON.parse(r.facts), validation: r.validation ? JSON.parse(r.validation) : null } : undefined;
  }
}
