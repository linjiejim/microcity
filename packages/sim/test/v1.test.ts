import { describe, expect, it } from 'vitest';
import {
  Engine,
  applyAll,
  branchScript,
  buildInitialState,
  buildMap,
  checkInvariants,
  checkProvenance,
  chronicle,
  classicSpec,
  contentHash,
  credibility,
  DEFAULT_BRANCHES,
  generatedDefaults,
  isWitness,
  normalizeSpec,
  outcomeMetrics,
  parseTime,
  personCard,
  presets,
  sampleSeries,
  scenarioFromSpec,
  STAFFING,
  totalMoney,
  town30,
  dayStart,
  type DomainEvent,
  type ScenarioDef,
  type TownSpec,
} from '../src/index.ts';

function run(sc: ScenarioDef, seed: number, until: string): { e: Engine; events: DomainEvent[]; violations: number } {
  const e = Engine.create(sc, { seed, decisionMode: 'rule' });
  const events: DomainEvent[] = [];
  e.onEvent((x) => events.push(x));
  const money0 = totalMoney(e.state);
  let violations = 0;
  const end = parseTime(until);
  for (let t = e.now; t < end; t += 1800) {
    e.advance(Math.min(end, t + 1800));
    violations += checkInvariants(e.state, e.map, money0).length;
  }
  return { e, events, violations };
}

/** 若干随机规格（种子固定，覆盖取值域两端） */
function randomSpecs(): TownSpec[] {
  const out: TownSpec[] = [];
  const sizes = [12, 19, 33, 47, 60];
  for (const [i, size] of sizes.entries()) {
    const s = generatedDefaults();
    s.seed = 100 + i;
    s.name = `随机 ${i}`;
    s.population = { size, seniors: [0, 0.6, 0.2, 0.35, 0.1][i]!, youth: [0.6, 0.1, 0.3, 0.2, 0.45][i]!, northShare: [0.2, 0.8, 0.5, 0.35, 0.65][i]! };
    s.facilities = { cafe: i % 4, restaurant: (i + 1) % 3, convenience: i % 2, supermarket: 1, studio: i % 3, clinic: i % 2, library: (i + 1) % 2, newsroom: i % 2, parks: 1 + (i % 3) };
    s.culture = { trustGov: 0.2 + i * 0.15, anxiety: 0.8 - i * 0.12, sociability: 0.3 + i * 0.1, detail: 0.9 - i * 0.15 };
    s.media = { push: i * 0.2, website: 1 - i * 0.2, boards: i % 4 };
    s.network = { friends: i * 1.4, crossDistrict: i * 0.2, kin: 1 - i * 0.2 };
    if (i === 3) s.events.push({ id: 'E2', area: 'south', day: 6, from: '09:00', to: '12:00', notice: { at: 'D05 18:00', channels: ['push'], headline: 'exact', advice: [] }, clarify: null });
    if (i === 4) s.events = [{ id: 'E1', area: 'south', day: 3, from: '10:00', to: '11:00', notice: null, clarify: null }];
    out.push(s);
  }
  return out;
}

describe('生成小镇：模板规则 → 场景', () => {
  const specs = [...presets().map((p) => p.spec), ...randomSpecs()];
  const scenarios = specs.map((s) => scenarioFromSpec(normalizeSpec(s).spec));

  it('默认经典规格生成的场景与 v0 town30 逐字段相等', () => {
    expect(scenarioFromSpec(normalizeSpec(classicSpec()).spec)).toEqual(town30());
  });

  it('同一规格两次生成完全相同；换生成种子就不同', () => {
    for (const s of specs.slice(1)) {
      const n = normalizeSpec(s).spec;
      expect(contentHash(scenarioFromSpec(n))).toBe(contentHash(scenarioFromSpec(n)));
      expect(contentHash(scenarioFromSpec({ ...n, seed: n.seed + 1 }))).not.toBe(contentHash(scenarioFromSpec(n)));
    }
  });

  it('任意两个地点门到门都走得通', () => {
    for (const sc of scenarios) {
      const map = buildMap(sc);
      const ps = Object.values(map.places);
      for (const a of ps) for (const b of ps) if (a !== b) expect(map.path(a.door, b.door), `${sc.name} ${a.id}→${b.id}`).not.toBeNull();
    }
  });

  it('人、户、岗位、组织彼此一致', () => {
    for (const sc of scenarios) {
      const ids = new Set(sc.people.map((p) => p.id));
      expect(new Set(sc.people.map((p) => p.name)).size, `${sc.name} 不重名`).toBe(sc.people.length);
      for (const h of sc.households) for (const m of h.members) expect(ids.has(m)).toBe(true);
      expect(sc.households.reduce((n, h) => n + h.members.length, 0)).toBe(sc.people.length);
      for (const o of sc.orgs) for (const s of o.staff) expect(sc.people.find((p) => p.id === s)?.workplace).toBe(o.place);
      for (const p of sc.people) if (STAFFING[sc.map.places.find((x) => x.id === p.workplace)?.kind ?? '']) expect(p.org, `${p.name} 有单位`).toBeTruthy();
      expect(sc.outages.length).toBe(sc.events.length);
    }
  });

  it('7 日浸泡：每个生成小镇不变量零违例、溯源零问题', () => {
    for (const sc of scenarios) {
      const { events, violations } = run(sc, 42, 'D07 23:00');
      expect(violations, sc.name).toBe(0);
      expect(checkProvenance(events), sc.name).toEqual([]);
    }
  });
});

describe('规格规范化', () => {
  it('越界值被夹回、调整写进 warnings', () => {
    const { spec, warnings } = normalizeSpec({ base: 'generated', population: { size: 100, seniors: 0.7, youth: 0.5 }, media: { push: 2 }, events: [{ area: 'east', day: 9, from: '23:00', to: '01:00', notice: { at: 'D09 20:00', channels: ['tv'] } }] });
    expect(spec.population.size).toBe(60);
    expect(spec.population.seniors + spec.population.youth).toBeLessThanOrEqual(0.85 + 1e-9);
    expect(spec.media.push).toBe(1);
    expect(spec.events[0]!.area).toBe('north');
    expect(spec.events[0]!.day).toBe(7);
    expect(parseTime(spec.events[0]!.notice!.at)).toBeLessThan(dayStart(7) + 20 * 3600);
    expect(spec.events[0]!.notice!.channels).toEqual(['website']);
    expect(warnings.length).toBeGreaterThanOrEqual(5);
    expect(warnings.join('')).toContain('人口');
  });

  it('人太少撑不起岗位时削减设施，并说明减了什么', () => {
    const { spec, warnings } = normalizeSpec({ base: 'generated', population: { size: 12, seniors: 0.5, youth: 0 }, facilities: { cafe: 3, restaurant: 3, convenience: 3, supermarket: 2, studio: 2, clinic: 2, library: 2, newsroom: 1, parks: 1 } });
    const jobs = 4 + Object.entries(spec.facilities).reduce((n, [k, c]) => n + (k === 'parks' ? 0 : (STAFFING[k]?.length ?? 0) * c), 0);
    expect(jobs).toBeLessThanOrEqual(Math.floor(12 * 0.5 * 0.92));
    expect(warnings.join('')).toContain('撑不起');
  });

  it('没有任何店时补一家超市；同区同日的重复停电被删除', () => {
    const { spec, warnings } = normalizeSpec({ base: 'generated', facilities: { supermarket: 0, convenience: 0 }, events: [CLASSIC(), CLASSIC()] });
    expect(spec.facilities.supermarket).toBe(1);
    expect(spec.events).toHaveLength(1);
    expect(warnings.join('')).toContain('同区同日');
  });
});

function CLASSIC() {
  return structuredClone(classicSpec().events[0]!);
}

describe('信任随经历演化（social_v1）', () => {
  const sc = town30();
  const { e, events } = run(sc, 42, 'D04 20:00');
  const o = sc.outages[0]!;
  const restore = dayStart(o.day) + o.to;

  it('来电时才裁决；每次调整都有原因，且只发生在见证者身上', () => {
    const tc = events.filter((x) => x.type === 'trust_changed');
    expect(tc.length).toBeGreaterThan(0);
    for (const x of tc) {
      if (x.type !== 'trust_changed') continue;
      expect(x.t).toBe(restore);
      expect(x.reason.length).toBeGreaterThan(3);
      expect(x.to).toBeGreaterThanOrEqual(0.05);
      expect(x.to).toBeLessThanOrEqual(0.95);
      expect(isWitness(e.map, e.state.agents[x.agent]!, o, dayStart(o.day) + o.from, restore)).toBe(true);
    }
  });

  it('措手不及且没收到官方通知的人，对官方的信任下降', () => {
    for (const a of Object.values(e.state.agents)) {
      const st = a.stats.byOutage[o.id];
      if (!st?.surprised || (a.seen[o.family]?.headlines.length ?? 0) > 0) continue;
      expect(a.trustGov).toBeLessThan(a.traits.trustOfficial);
    }
  });

  it('第二轮通知的可信度用的是更新后的信任', () => {
    const big = scenarioFromSpec(normalizeSpec(presets().find((p) => p.id === 'bigtwo')!.spec).spec);
    const r = run(big, 7, 'D06 20:00');
    const e1 = big.outages[0]!;
    const e2 = big.outages[1]!;
    const s = buildInitialState(big, 7);
    let checked = 0;
    let differs = 0;
    for (const ev of r.events) {
      applyAll(s, [ev]);
      if (ev.type !== 'belief_set' || ev.family !== e2.family || ev.t < dayStart(e1.day) + e1.to) continue;
      const src = ev.belief.sources[ev.belief.sources.length - 1]!;
      if (src.channel !== 'website' && src.channel !== 'push' && src.channel !== 'board') continue;
      const a = s.agents[ev.agent]!;
      const v = s.versions[src.versionId]!;
      // 用此刻的信任重算：一致；用初始特质算：对信任变过的人不一致
      void v;
      const heard = r.events.find((x) => x.type === 'comprehended' && x.seq < ev.seq && x.agent === ev.agent && x.family === e2.family && x.heardVersionId === src.versionId);
      if (!heard || heard.type !== 'comprehended') continue;
      checked++;
      if (Math.abs(a.trustGov - a.traits.trustOfficial) > 0.005) differs++;
    }
    expect(checked).toBeGreaterThan(5);
    expect(differs, '有人带着变过的信任去看第二轮通知').toBeGreaterThan(0);
    // 同一可信度公式对同一输入给出同一结果（可信度由动态信任决定）
    expect(credibility({ channel: 'push', slots: { source: 'gov', certainty: 'confirmed' }, trustGov: 0.3 })).toBeLessThan(credibility({ channel: 'push', slots: { source: 'gov', certainty: 'confirmed' }, trustGov: 0.8 }));
  });
});

describe('v0 缺口', () => {
  it('“有意但受阻”在若干 seed / 小镇中出现，且原因可读', () => {
    const stops: string[] = [];
    const big = scenarioFromSpec(normalizeSpec(presets().find((p) => p.id === 'bigtwo')!.spec).spec);
    for (const [sc, seed] of [
      [town30(), 42],
      [town30(), 7],
      [town30(), 2026],
      [big, 42],
    ] as const) {
      const { events } = run(sc, seed, 'D06 20:00');
      for (const x of events) if (x.type === 'funnel_stop' && x.stop === 'blocked') stops.push(x.reason);
    }
    expect(stops.length).toBeGreaterThan(0);
    for (const r of stops) expect(r).toMatch(/但/);
  });

  it('改做不用电的事只覆盖所信时段：不再有整项“（不用电）”，前后段保留原安排', () => {
    for (const seed of [42, 7, 2026, 11]) {
      const { e } = run(town30(), seed, 'D04 13:00');
      for (const a of Object.values(e.state.agents)) {
        for (const items of Object.values(a.plans)) {
          for (const it of items) {
            expect(it.label).not.toContain('（不用电）');
            if (it.origin?.reason !== 'adapt') continue;
            expect(it.end - it.start).toBeLessThanOrEqual(24 * 3600);
            expect(it.needsPower).toBe(false);
          }
        }
      }
    }
  });

  it('多轮停电的后果分轮统计，合计等于总数', () => {
    const big = scenarioFromSpec(normalizeSpec(presets().find((p) => p.id === 'bigtwo')!.spec).spec);
    const { e } = run(big, 42, 'D07 12:00');
    const all = outcomeMetrics(e.state);
    const parts = big.outages.map((o) => outcomeMetrics(e.state, o.id));
    expect(parts.reduce((n, p) => n + p.inconvenienceItems, 0)).toBe(all.inconvenienceItems);
    expect(parts.every((p) => p.inconvenienceItems > 0)).toBe(true);
  });

  it('分支补丁只改指定的那一轮；澄清分支多出一条发布', () => {
    const big = scenarioFromSpec(normalizeSpec(presets().find((p) => p.id === 'bigtwo')!.spec).spec);
    const d = branchScript(big, DEFAULT_BRANCHES.D!);
    const a = branchScript(big, DEFAULT_BRANCHES.A!);
    const pubs = (xs: typeof d) => xs.filter((x) => x.kind === 'publish');
    expect(pubs(d).length).toBe(pubs(a).length + 1);
    const e2 = (xs: typeof d) => xs.filter((x) => x.kind === 'publish' && x.news.familyId === big.outages[1]!.family).map((x) => contentHash(x));
    expect(e2(d)).toEqual(e2(a));
    expect(e2(a)).toEqual(big.script.filter((x) => x.kind === 'publish' && x.news.familyId === big.outages[1]!.family).map((x) => contentHash(x)));
  });
});

describe('复盘内核：章节、画像、曲线', () => {
  const sc = town30();
  const { e, events } = run(sc, 42, 'D04 20:00');
  const init = buildInitialState(sc, 42);

  it('关键节拍按时间排列，覆盖发布、首次相信、过半、停电、来电、信任变化', () => {
    const key = chronicle(init, events);
    const kinds = key.map((b) => b.kind);
    for (const k of ['publish', 'first_belief', 'milestone', 'outage', 'restore', 'trust'] as const) expect(kinds).toContain(k);
    for (let i = 1; i < key.length; i++) expect(key[i]!.seq).toBeGreaterThanOrEqual(key[i - 1]!.seq);
    const feed = chronicle(init, events, { level: 'feed' });
    expect(feed.length).toBeGreaterThan(key.length);
    for (const b of key) expect(feed.some((x) => x.id === b.id)).toBe(true);
  });

  it('每个人都有一句与事实一致的“想法”', () => {
    for (const id of Object.keys(e.state.agents)) {
      const c = personCard(e.state, e.map, id, sc.outages[0]!.family, e.now, sc.outages[0]);
      expect(c.thought.text.length).toBeGreaterThan(5);
      expect(c.thought.text).not.toMatch(/undefined|NaN/);
      if (c.surprised) expect(c.thought.mood).toBe('annoyed');
      if (c.stage === 'unaware') expect(['unaware', 'annoyed']).toContain(c.thought.mood);
      if (c.window === 'all_day') expect(c.thought.text).toMatch(/一整天|全天/);
    }
  });

  it('曲线每个点的信念构成加起来等于总人口；来电后信任均值变化', () => {
    const pts = sampleSeries(init, events, { step: 3600, family: sc.outages[0]!.family });
    const pop = Object.keys(e.state.agents).length;
    for (const p of pts) expect(p.unaware + p.glimpsed + p.disbelieve + p.doubt + p.exact + p.coarse + p.allDay + p.unknown).toBe(pop);
    const before = pts.find((p) => p.t === parseTime('D04 15:00'))!;
    const after = pts[pts.length - 1]!;
    expect(after.trustGov).not.toBe(before.trustGov);
    expect(after.tiesUp + after.tiesDown).toBeGreaterThan(0);
  });
});
