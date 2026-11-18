import type { DayAgg, Experiment } from '@microcity/society';
import type { DayPack, WorldConfig } from '../sim/protocol.ts';
import type { LabIn, LabOut } from './protocol.ts';

type Job = { resolve: (v: never) => void; reject: (e: Error) => void; onDay?: (day: number) => void };

/**
 * 实验的调度：开几个 Worker，把“种子 × 两条世界线”分下去。
 * 另留一个 Worker 专门重算微观镜头要看的那一天。
 */
export class Lab {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Array<{ msg: LabIn; job: Job }> = [];
  private jobs = new Map<number, { job: Job; worker: Worker }>();
  private seq = 0;
  private replayWorker: Worker | undefined;

  private spawn(): Worker {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<LabOut>) => this.onMessage(w, ev.data);
    w.onerror = (e) => {
      for (const [id, j] of this.jobs)
        if (j.worker === w) {
          j.job.reject(new Error(e.message));
          this.jobs.delete(id);
        }
    };
    return w;
  }

  private onMessage(w: Worker, m: LabOut): void {
    const entry = this.jobs.get(m.job);
    if (!entry) return;
    if (m.type === 'day') return entry.job.onDay?.(m.day);
    this.jobs.delete(m.job);
    if (m.type === 'error') entry.job.reject(new Error(m.message));
    else entry.job.resolve((m.type === 'line' ? m.aggs : m.pack) as never);
    if (w !== this.replayWorker) {
      this.idle.push(w);
      this.pump();
    }
  }

  private pump(): void {
    while (this.queue.length && this.idle.length) {
      const next = this.queue.shift()!;
      const w = this.idle.pop()!;
      this.jobs.set(next.msg.job, { job: next.job, worker: w });
      w.postMessage(next.msg);
    }
  }

  private line(config: WorldConfig, days: number, onDay: (day: number) => void): Promise<DayAgg[]> {
    return new Promise((resolve, reject) => {
      this.queue.push({ msg: { type: 'line', job: ++this.seq, config, days }, job: { resolve: resolve as never, reject, onDay } });
      this.pump();
    });
  }

  /** 跑完一个实验：每个种子各一条基线、一条干预线 */
  async run(x: Experiment, onProgress: (done: number, total: number) => void): Promise<{ base: DayAgg[][]; treat: DayAgg[][] }> {
    const want = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1, x.seeds.length * 2));
    while (this.workers.length < want) {
      const w = this.spawn();
      this.workers.push(w);
      this.idle.push(w);
    }
    const total = x.seeds.length * 2 * x.days;
    let done = 0;
    const tick = () => onProgress(++done, total);
    const base = x.seeds.map((seed) => this.line({ spec: x.spec, seed, interventions: [] }, x.days, tick));
    const treat = x.seeds.map((seed) => this.line({ spec: x.spec, seed, interventions: x.interventions }, x.days, tick));
    return { base: await Promise.all(base), treat: await Promise.all(treat) };
  }

  /** 某条世界线某一天的快照与事件 */
  pack(config: WorldConfig, day: number): Promise<DayPack> {
    this.replayWorker ??= this.spawn();
    const w = this.replayWorker;
    return new Promise((resolve, reject) => {
      const job = ++this.seq;
      this.jobs.set(job, { job: { resolve: resolve as never, reject }, worker: w });
      w.postMessage({ type: 'pack', job, config, day } satisfies LabIn);
    });
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.replayWorker?.terminate();
    this.workers = [];
    this.idle = [];
    this.replayWorker = undefined;
  }
}

export const lab = new Lab();
