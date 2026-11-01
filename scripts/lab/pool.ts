// 规则模式批量运行：按（场景, seed）分组，同组共用分叉快照；多线程并行
// 用法见 sens.ts / social.ts。结果逐行写 JSONL（data/lab/，不入库）。
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { mkdirSync, createWriteStream } from 'node:fs';
import { dirname } from 'node:path';
import {
  Engine,
  applyTownPatch,
  beliefCensus,
  branchParams,
  branchScript,
  classicSpec,
  contentHash,
  dayStart,
  forkTimeFor,
  normalizeSpec,
  parseTime,
  scenarioFromSpec,
  town30,
  trustSummary,
  untilFor,
  type BeliefCensus,
  type BranchSpec,
  type ParamPatch,
  type ScenarioDef,
  type TownSpec,
  type TrustSummary,
} from '@microcity/sim';
import { BranchTally, branchMetrics, type BranchMetrics } from '../../apps/server/src/experiments.ts';
import { makeProbe, type ProbeName } from './probes.ts';

/** 一组要跑的东西：底座规格 × seed × 若干（参数, 分支） */
export interface Job {
  base: 'town30' | TownSpec;
  seed: number;
  /** 分叉点与终点由全部分支共同决定（同一个实验的所有任务应相同） */
  branches: Record<string, BranchSpec>;
  variants: Array<{ id: string; params?: ParamPatch }>;
  tags?: Record<string, string | number>;
  /** 要挂的探针（结果进 Row.extra） */
  probes?: ProbeName[];
}

export interface Row {
  tags: Record<string, string | number>;
  seed: number;
  variant: string;
  branch: string;
  metrics: Pick<BranchMetrics, 'outages' | 'trust'>;
  /** 每轮停电开始那一刻的信任汇总（看上一轮留下了什么） */
  trustAt: Record<string, TrustSummary>;
  decisions: number;
  extra?: Record<string, unknown>;
  hash: string;
}

const scCache = new Map<string, ScenarioDef>();
function scenarioOf(base: Job['base'], town?: BranchSpec['town']): ScenarioDef {
  const spec: TownSpec = base === 'town30' ? normalizeSpec(classicSpec()).spec : base;
  const full = town ? normalizeSpec(applyTownPatch(spec, town)).spec : spec;
  const key = contentHash(full);
  let sc = scCache.get(key);
  if (!sc) {
    sc = base === 'town30' && !town ? town30() : scenarioFromSpec(full);
    scCache.set(key, sc);
  }
  return sc;
}

/** 跑一个任务：返回每个（参数, 分支）的指标 */
export function runJob(job: Job): Row[] {
  const sc = scenarioOf(job.base);
  const forkAt = forkTimeFor(sc, job.branches);
  const until = untilFor(sc);
  const base = Engine.create(sc, { seed: job.seed, decisionMode: 'rule' });
  base.advance(forkAt);
  const snap = base.snapshot();
  const rows: Row[] = [];
  for (const v of job.variants) {
    for (const [name, spec] of Object.entries(job.branches)) {
      const bsc = spec.town ? scenarioOf(job.base, spec.town) : sc;
      const params = branchParams({ ...(v.params ? { params: v.params } : {}) }, spec);
      const hasParams = !!params;
      const engine = spec.town
        ? Engine.create(bsc, { seed: job.seed, decisionMode: 'rule', script: branchScript(bsc, spec), ...(hasParams ? { params: params! } : {}) })
        : Engine.restore(snap, sc, { decisionMode: 'rule', script: branchScript(sc, spec), ...(hasParams ? { params: params! } : {}) });
      const tally = new BranchTally(bsc.outages);
      const probe = job.probes?.length ? makeProbe(job.probes, bsc) : undefined;
      let decisions = 0;
      engine.onEvent((e) => (tally.event(e), probe?.event?.(e)));
      engine.onRecord((r) => (decisions++, tally.record(r), probe?.record?.(r)));
      const atStart: Record<string, BeliefCensus> = {};
      const trustAt: Record<string, TrustSummary> = {};
      const cps = bsc.outages.map((o) => ({ id: o.id, family: o.family, t: dayStart(o.day) + o.from })).filter((c) => c.t > engine.now && c.t <= until);
      for (const cp of cps) {
        engine.advance(cp.t);
        atStart[cp.id] = beliefCensus(engine.state, cp.family);
        trustAt[cp.id] = trustSummary(engine.state);
        probe?.checkpoint?.(cp.id, engine.state);
      }
      engine.advance(until);
      rows.push({ tags: job.tags ?? {}, seed: job.seed, variant: v.id, branch: name, metrics: branchMetrics(engine.state, bsc, atStart, tally), trustAt, decisions, ...(probe ? { extra: probe.finish(engine.state) } : {}), hash: contentHash(engine.state).slice(0, 12) });
    }
  }
  return rows;
}

/** 并行跑一批任务，逐行写 JSONL；返回全部行 */
export async function runPool(jobs: Job[], out: string, opts: { threads?: number; label?: string } = {}): Promise<Row[]> {
  mkdirSync(dirname(out), { recursive: true });
  const ws = createWriteStream(out);
  const threads = Math.max(1, Math.min(opts.threads ?? availableParallelism() - 1, jobs.length));
  const rows: Row[] = [];
  let next = 0;
  let done = 0;
  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: threads }, async () => {
      const w = new Worker(new URL(import.meta.url), { execArgv: ['--import', 'tsx', '--no-warnings'] });
      try {
        for (;;) {
          const i = next++;
          if (i >= jobs.length) break;
          const res = await new Promise<Row[]>((resolve, reject) => {
            w.once('message', resolve);
            w.once('error', reject);
            w.postMessage(jobs[i]);
          });
          for (const r of res) {
            rows.push(r);
            ws.write(`${JSON.stringify(r)}\n`);
          }
          done++;
          if (done % 5 === 0 || done === jobs.length) process.stderr.write(`\r${opts.label ?? ''} ${done}/${jobs.length} jobs · ${Math.round((Date.now() - t0) / 1000)}s   `);
        }
      } finally {
        await w.terminate();
      }
    }),
  );
  process.stderr.write('\n');
  await new Promise((r) => ws.end(r));
  return rows;
}

if (!isMainThread && parentPort) {
  void workerData;
  parentPort.on('message', (job: Job) => parentPort!.postMessage(runJob(job)));
}

export { parseTime };
