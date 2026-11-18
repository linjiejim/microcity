/// <reference lib="webworker" />
import { DayRunner, generateCommunity } from '@microcity/society';
import type { DayPack, FromWorker, ToWorker } from './protocol.ts';

/**
 * 内核跑在这个 Worker 里（D69）：逐天计算并保存，主线程按天来取。
 * 每算完一天让出一次事件循环，好及时回应“取某一天”的请求。
 */
let runner: DayRunner | undefined;
let packs = new Map<number, DayPack>();
let target = 0;
let generation = 0;

const post = (m: FromWorker) => (self as DedicatedWorkerGlobalScope).postMessage(m);
const pause = () => new Promise<void>((r) => setTimeout(r, 0));

async function pump(gen: number): Promise<void> {
  while (runner && gen === generation && runner.computed < target) {
    const t0 = performance.now();
    const r = runner.next();
    packs.set(r.day, { day: r.day, snapshot: r.snapshot!, events: r.events! });
    post({ type: 'progress', computed: runner.computed, target, ms: Math.round(performance.now() - t0), agg: r.agg });
    await pause();
  }
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  try {
    if (m.type === 'start') {
      generation++;
      packs = new Map();
      runner = new DayRunner(generateCommunity(m.config.spec), { seed: m.config.seed, interventions: m.config.interventions }, true);
      target = m.days;
      void pump(generation);
    } else if (m.type === 'extend') {
      const idle = !runner || runner.computed >= target;
      target = Math.max(target, m.days);
      if (idle) void pump(generation);
    } else if (m.type === 'load') {
      post({ type: 'pack', req: m.req, pack: packs.get(m.day) ?? null });
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
