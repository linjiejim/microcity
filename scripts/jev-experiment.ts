// 用法：node --no-warnings=ExperimentalWarning --import tsx scripts/jev-experiment.ts 42,43,44 [scenario]
// 真实调用 Jev 跑一次多 seed 对照实验（A/B/C/D），打印分布与花费
import { resolve } from 'node:path';
import { Store } from '../apps/server/src/db.ts';
import { RunManager } from '../apps/server/src/runs.ts';
import { ExperimentRunner, type ExperimentResult } from '../apps/server/src/experiments.ts';
import { config, hasModelAccess } from '../apps/server/src/config.ts';
import { defaultManifest } from '@microcity/sim';

const seeds = (process.argv[2] ?? '42').split(',').map(Number);
const scenario = process.argv[3] ?? 'town30';
console.log('model access', hasModelAccess(), config.jevModel);
const store = new Store(resolve(config.dataDir, 'dev-jev.sqlite'));
const runs = new RunManager(store);
const exps = new ExperimentRunner(runs);
const t0 = Date.now();
const id = exps.start(defaultManifest(seeds, 'jev', runs.scenarios.require(scenario)));
for (;;) {
  await new Promise((r) => setTimeout(r, 2000));
  const x = exps.live.get(id)!;
  process.stdout.write(`\r${Math.round((Date.now() - t0) / 1000)}s seed ${x.seedIndex + 1}/${x.seeds} ${Object.entries(x.progress).map(([k, v]) => `${k}:${Math.round(v * 100)}%`).join(' ')} ${x.status}   `);
  if (x.status !== 'running') break;
}
const e = store.experiment(id)!;
console.log('\n', e.status, e.error ?? '');
const r = e.result as ExperimentResult;
for (const [k, b] of Object.entries(r.branches)) {
  const s = r.stats[k]!;
  const med = (key: string) => s[key]?.median;
  const calls = b.perSeed.reduce((n, m) => n + m.calls.calls, 0);
  const cost = b.perSeed.reduce((n, m) => n + m.calls.cost, 0);
  const fb = b.perSeed.reduce((n, m) => n + m.decisions.fallbacks, 0);
  console.log(k, b.label.padEnd(20), `t50=${med('E1.t50')}s aware=${med('E1.aware')} allDay=${med('E1.allDay')} surprised=${med('E1.surprisedPeople')} over=${med('E1.overreactMin')}min govΔ=${med('trust.govDelta')} | calls=${calls} fallbacks=${fb} $${cost.toFixed(4)}`);
}
console.log('total spend in this db $', store.spend().toFixed(5));
