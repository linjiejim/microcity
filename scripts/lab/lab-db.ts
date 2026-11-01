// 实验脚本共用：打开主库（dev 服务要先停），跑一个实验清单并等它结束
import { resolve } from 'node:path';
import type { ExperimentManifest } from '@microcity/sim';
import { Store } from '../../apps/server/src/db.ts';
import { RunManager } from '../../apps/server/src/runs.ts';
import { ExperimentRunner, type ExperimentResult } from '../../apps/server/src/experiments.ts';
import { config } from '../../apps/server/src/config.ts';

export function openLab(file = resolve(config.dataDir, 'microcity.sqlite')): { store: Store; runs: RunManager; exps: ExperimentRunner } {
  const store = new Store(file);
  const runs = new RunManager(store);
  return { store, runs, exps: new ExperimentRunner(runs) };
}

export async function runManifest(exps: ExperimentRunner, store: Store, m: ExperimentManifest): Promise<{ id: string; result: ExperimentResult }> {
  const t0 = Date.now();
  const id = exps.start(m);
  const tick = setInterval(() => {
    const x = exps.live.get(id);
    if (x) process.stderr.write(`${m.name} · ${Math.round((Date.now() - t0) / 1000)}s · seed ${x.seedIndex + 1}/${x.seeds} ${Object.entries(x.progress).map(([k, v]) => `${k}:${Math.round(v * 100)}%`).join(' ')}\n`);
  }, 60000);
  await exps.wait(id);
  clearInterval(tick);
  process.stderr.write('\n');
  const e = store.experiment(id)!;
  if (e.status !== 'done') throw new Error(`${m.name} 失败：${e.error}`);
  return { id, result: e.result as ExperimentResult };
}
