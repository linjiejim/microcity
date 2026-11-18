/// <reference lib="webworker" />
import { DayRunner, generateCommunity, runLine, type CommunityDef } from '@microcity/society';
import type { DayPack } from '../sim/protocol.ts';
import { lineKey, type LabIn, type LabOut } from './protocol.ts';

/** 实验用的 Worker：一次跑一条世界线（只留统计），或者重算某一天的快照与事件 */
const post = (m: LabOut) => (self as DedicatedWorkerGlobalScope).postMessage(m);
const defs = new Map<string, CommunityDef>();
const defOf = (spec: Parameters<typeof generateCommunity>[0]): CommunityDef => {
  const key = JSON.stringify(spec);
  let def = defs.get(key);
  if (!def) {
    def = generateCommunity(spec);
    defs.set(key, def);
  }
  return def;
};

/** 最近重算过的两条线（基线与干预线）：连着取相邻的几天时不用从头再来 */
interface Replay {
  runner: DayRunner;
  packs: Map<number, DayPack>;
}
const replays = new Map<string, Replay>();

function packOf(def: CommunityDef, config: Extract<LabIn, { type: 'pack' }>['config'], day: number): DayPack {
  const key = lineKey(config);
  let r = replays.get(key);
  // 要的是已经丢掉的更早的一天：从头重算
  if (!r || (r.runner.computed >= day && !r.packs.has(day))) {
    r = { runner: new DayRunner(def, { seed: config.seed, interventions: config.interventions }, true), packs: new Map() };
    replays.delete(key);
    replays.set(key, r);
    while (replays.size > 2) replays.delete(replays.keys().next().value!);
  }
  while (r.runner.computed < day) {
    const d = r.runner.next();
    r.packs.set(d.day, { day: d.day, snapshot: d.snapshot!, events: d.events! });
    for (const k of r.packs.keys()) if (k < d.day - 1) r.packs.delete(k);
  }
  return r.packs.get(day)!;
}

self.onmessage = (ev: MessageEvent<LabIn>) => {
  const m = ev.data;
  try {
    const def = defOf(m.config.spec);
    if (m.type === 'line') {
      const aggs = runLine(def, m.config.seed, m.config.interventions, m.days, (day) => post({ type: 'day', job: m.job, day }));
      post({ type: 'line', job: m.job, aggs });
    } else post({ type: 'pack', job: m.job, pack: packOf(def, m.config, m.day) });
  } catch (e) {
    post({ type: 'error', job: m.job, message: e instanceof Error ? e.message : String(e) });
  }
};
