import {
  ChronicleBuilder,
  applyEvent,
  buildMap,
  personCard,
  sampleSeries,
  type Beat,
  type DomainEvent,
  type PersonCard,
  type ScenarioDef,
  type SeriesPoint,
  type SimTime,
  type TownMap,
  type WorldState,
} from '@microcity/sim';
import type { RunManager } from './runs.ts';

export interface Trajectory {
  agent: string;
  family: string;
  samples: Array<{ t: SimTime; label: string; card: PersonCard }>;
  beats: Beat[];
  trust: Array<{ t: SimTime; target: string; name: string; from: number; to: number; reason: string }>;
}

/**
 * 复盘计算（spec v1 §2.6，D25）：对一条运行的事件日志重放，得到章节、曲线、人物轨迹。
 * 结果按（运行, 最后事件序号, 参数）缓存；运行继续推进后自动失效。
 */
export class Analysis {
  private cache = new Map<string, unknown>();
  private maps = new Map<string, TownMap>();
  constructor(private runs: RunManager) {}

  private key(runId: string, ...parts: Array<string | number>): { k: string; events: DomainEvent[]; sc: ScenarioDef } {
    const run = this.runs.get(runId);
    run?.flush();
    const events = this.runs.history(runId);
    const last = events[events.length - 1]?.seq ?? 0;
    return { k: [runId, last, ...parts].join('|'), events, sc: this.runs.scenarioOf(runId) };
  }

  private memo<T>(k: string, fn: () => T): T {
    if (this.cache.has(k)) return this.cache.get(k) as T;
    const v = fn();
    this.cache.set(k, v);
    if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
    return v;
  }

  map(sc: ScenarioDef): TownMap {
    let m = this.maps.get(sc.id);
    if (!m) {
      m = buildMap(sc);
      this.maps.set(sc.id, m);
    }
    return m;
  }

  chronicle(runId: string, level: 'key' | 'feed'): Beat[] {
    const { k, events, sc } = this.key(runId, 'chronicle', level);
    return this.memo(k, () => {
      const s = this.runs.initialState(runId);
      const names = new Map(sc.map.places.map((p) => [p.id, p.name]));
      const b = new ChronicleBuilder({ placeName: (id) => names.get(id) ?? id });
      const all = new Map<string, Beat>();
      for (const e of events) {
        applyEvent(s, e);
        for (const x of b.push(e, s)) all.set(x.id, x);
      }
      return [...all.values()].filter((x) => level === 'feed' || x.level === 'key').sort((x, y) => x.seq - y.seq || x.id.localeCompare(y.id));
    });
  }

  series(runId: string, step: number, family: string): SeriesPoint[] {
    const { k, events } = this.key(runId, 'series', step, family);
    return this.memo(k, () => sampleSeries(this.runs.initialState(runId), events, { step, family }));
  }

  /** 一个人的轨迹：在他自己的关键时刻与全镇章节上各取一张画像 */
  trajectory(runId: string, agent: string, family: string): Trajectory {
    const { k, events, sc } = this.key(runId, 'traj', agent, family);
    return this.memo(k, () => {
      const map = this.map(sc);
      const outage = sc.outages.find((o) => o.family === family);
      const s = this.runs.initialState(runId);
      const names = new Map(sc.map.places.map((p) => [p.id, p.name]));
      const b = new ChronicleBuilder({ placeName: (id) => names.get(id) ?? id });
      const samples: Trajectory['samples'] = [];
      const beats: Beat[] = [];
      const trust: Trajectory['trust'] = [];
      const take = (st: WorldState, t: SimTime, label: string) => {
        const last = samples[samples.length - 1];
        const card = personCard(st, map, agent, family, t, outage);
        if (last && last.card.thought.text === card.thought.text && last.card.stage === card.stage && last.card.trustGov === card.trustGov) return;
        samples.push({ t, label, card: structuredClone(card) });
      };
      let pending: { t: SimTime; label: string } | undefined;
      for (const e of events) {
        if (pending && e.t > pending.t) {
          take(s, pending.t, pending.label);
          pending = undefined;
        }
        applyEvent(s, e);
        const mine = b.push(e, s);
        for (const x of mine) {
          if (x.level === 'key' && !pending) pending = { t: x.t, label: x.title };
          if (x.agents.includes(agent)) beats.push(x);
        }
        if (e.type === 'trust_changed' && e.agent === agent) trust.push({ t: e.t, target: e.target, name: e.target === 'gov' ? '官方通知' : (s.agents[e.target]?.name ?? e.target), from: e.from, to: e.to, reason: e.reason });
        const about = (e.type === 'belief_set' && e.agent === agent && e.family === family) || (e.type === 'plan_set' && e.agent === agent && e.reason !== 'daily') || (e.type === 'inconvenience' && e.agent === agent) || (e.type === 'funnel_stop' && e.agent === agent && e.family === family);
        if (about && !pending) pending = { t: e.t, label: e.type === 'belief_set' ? '信念变化' : e.type === 'plan_set' ? '改了安排' : e.type === 'inconvenience' ? '被停电影响' : '停在漏斗某一步' };
      }
      if (pending) take(s, pending.t, pending.label);
      take(s, s.meta.t, '此刻');
      const uniq = new Map(beats.map((x) => [x.id, x]));
      return { agent, family, samples, beats: [...uniq.values()], trust };
    });
  }
}
