import type { CommunitySpec } from '@microcity/society';
import type { DayPack, FromWorker, ToWorker } from './protocol.ts';

export interface Progress {
  computed: number;
  target: number;
  ms: number;
  events: number;
}

/** 主线程这一侧：启动计算、按天取数据（留最近用过的几天） */
export class SimClient {
  private worker: Worker;
  private req = 0;
  private waiting = new Map<number, (p: DayPack | null) => void>();
  private cache = new Map<number, DayPack>();
  private loading = new Map<number, Promise<DayPack | null>>();

  constructor(
    private onProgress: (p: Progress) => void,
    private onError: (message: string) => void,
  ) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.type === 'progress') this.onProgress(m);
      else if (m.type === 'error') this.onError(m.message);
      else {
        this.waiting.get(m.req)?.(m.pack);
        this.waiting.delete(m.req);
      }
    };
    this.worker.onerror = (e) => this.onError(e.message);
  }

  private send(m: ToWorker): void {
    this.worker.postMessage(m);
  }

  start(spec: CommunitySpec, seed: number, days: number): void {
    this.cache.clear();
    this.loading.clear();
    this.send({ type: 'start', spec, seed, days });
  }

  extend(days: number): void {
    this.send({ type: 'extend', days });
  }

  cached(day: number): DayPack | undefined {
    return this.cache.get(day);
  }

  /** 取某一天；还没算到返回 null */
  load(day: number): Promise<DayPack | null> {
    const hit = this.cache.get(day);
    if (hit) return Promise.resolve(hit);
    const pending = this.loading.get(day);
    if (pending) return pending;
    const req = ++this.req;
    const p = new Promise<DayPack | null>((resolve) => this.waiting.set(req, resolve)).then((pack) => {
      this.loading.delete(day);
      if (pack) {
        this.cache.set(day, pack);
        // 只留最近取的 4 天
        while (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value!);
      }
      return pack;
    });
    this.loading.set(day, p);
    this.send({ type: 'load', day, req });
    return p;
  }

  dispose(): void {
    this.worker.terminate();
  }
}
