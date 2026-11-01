import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS,
  Engine,
  PARAM_PRESETS,
  applyAll,
  branchScript,
  buildReaction,
  buildInitialState,
  concernOf,
  contentHash,
  forkTimeFor,
  generatedDefaults,
  normalizeSpec,
  parseTime,
  resolveParams,
  riskOverlap,
  scenarioFromSpec,
  untilFor,
  type Agent,
  type BranchSpec,
  type DecisionRecord,
  type DomainEvent,
  type ScenarioDef,
} from '../src/index.ts';

function labTown(): ScenarioDef {
  const s = generatedDefaults();
  Object.assign(s, { seed: 42, population: { size: 60, seniors: 0.25, youth: 0.25, northShare: 0.5 }, facilities: { cafe: 2, restaurant: 2, convenience: 2, supermarket: 1, studio: 1, clinic: 1, library: 1, newsroom: 1, parks: 2 } });
  s.events = [...s.events, { id: 'E2', area: 'north', day: 6, from: '14:00', to: '16:00', notice: { at: 'D05 08:05', channels: ['website', 'push', 'board'], headline: 'exact', advice: ['charge_devices'] }, clarify: null, workOrder: true }];
  return scenarioFromSpec(normalizeSpec(s).spec);
}

function runBranch(sc: ScenarioDef, seed: number, spec: BranchSpec, until = untilFor(sc)) {
  const e = Engine.create(sc, { seed, decisionMode: 'rule', script: branchScript(sc, spec) });
  const events: DomainEvent[] = [];
  const records: DecisionRecord[] = [];
  e.onEvent((x) => events.push(x));
  e.onRecord((r) => records.push(r));
  e.advance(until);
  return { e, events, records };
}

describe('经历记忆（social_v2）', () => {
  const sc = labTown();

  it('来电后每个见证者至多记下一类经历；不发通知的那一轮，措手不及的人记为“没收到通知”', () => {
    const { e, events } = runBranch(sc, 3, { label: 'silent', patches: [{ event: 'E1', silent: true }] }, parseTime('D05 06:00'));
    const exp = events.filter((x): x is Extract<DomainEvent, { type: 'experience' }> => x.type === 'experience');
    expect(exp.length).toBeGreaterThan(0);
    const per = new Map<string, number>();
    for (const x of exp) per.set(x.agent, (per.get(x.agent) ?? 0) + 1);
    expect(Math.max(...per.values())).toBe(1);
    for (const x of exp) {
      const a = e.state.agents[x.agent]!;
      expect(a.memory?.at(-1)?.kind).toBe(x.kind);
      if ((a.stats.byOutage.E1?.surprised ?? 0) > 0 && Object.keys(a.seen).length === 0) expect(x.kind).toBe('surprised_uninformed');
    }
    expect(exp.some((x) => x.kind === 'surprised_uninformed')).toBe(true);
    // 经历进入下一轮决策的观察，并按面板结果抬高规则心智的担心
    const burned = Object.values(e.state.agents).find((a) => a.memory?.at(-1)?.kind === 'surprised_uninformed')!;
    const fresh = { ...burned, memory: undefined } as Agent;
    expect(concernOf(burned)).toBeGreaterThan(concernOf(fresh));
    expect(concernOf(burned, resolveParams(PARAM_PRESETS.v1))).toBe(concernOf(fresh, resolveParams(PARAM_PRESETS.v1)));
  });

  it('第二轮的决策观察里带着上一轮的经历；事件重放得到同一哈希', () => {
    const { e, events, records } = runBranch(sc, 3, { label: 'silent', patches: [{ event: 'E1', silent: true }] }, parseTime('D06 12:00'));
    const e2 = records.filter((r) => r.t > parseTime('D05 08:00') && r.observation.pastExperience?.length);
    expect(e2.length).toBeGreaterThan(0);
    expect(e2[0]!.observation.pastExperience![0]).toMatch(/停电：/);
    const replay = buildInitialState(sc, 3);
    applyAll(replay, events);
    expect(contentHash(replay)).toBe(contentHash(e.state));
  });
});

describe('缩小挪动与安全的恢复（utility_v2）', () => {
  const sc = labTown();
  const clarify: BranchSpec = { label: '澄清', patches: [{ event: 'E1', clarify: { at: 'D03 12:00', channels: ['website', 'push', 'board'] } }] };

  it('挪多了：按精确时段提供“缩小”而不是“恢复”；原安排已不受威胁：提供“恢复”', () => {
    let checked = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const base = Engine.create(sc, { seed, decisionMode: 'rule' });
      base.advance(forkTimeFor(sc, { X: clarify }));
      const e = Engine.restore(base.snapshot(), sc, { decisionMode: 'rule', script: branchScript(sc, clarify) });
      e.advance(parseTime('D03 23:00'));
      const t = e.now;
      for (const a of Object.values(e.state.agents)) {
        const it = (a.plans[4] ?? []).find((x) => x.status === 'planned' && x.origin?.reason === 'move' && x.origin.orig && x.end - x.start > 3 * 3600 && x.start < parseTime('D04 14:00') && x.end > parseTime('D04 16:00'));
        if (!it) continue;
        const fam = it.origin!.family!;
        const b0 = a.beliefs[fam]!;
        const exact = { ...b0, slots: { ...b0.slots, event: 'power_outage' as const, area: 'north' as const, day: 4, window: { kind: 'exact' as const, from: 14 * 3600, to: 16 * 3600 } } };
        const r1 = buildReaction(e.state, e.map, a, exact, t, true);
        expect(r1.candidates.some((c) => c.id === `narrow:${it.id}`)).toBe(true);
        expect(r1.candidates.some((c) => c.id === `restore:${it.id}`)).toBe(false);
        const elsewhere = { ...exact, slots: { ...exact.slots, day: 5 } };
        const r2 = buildReaction(e.state, e.map, a, elsewhere, t, true);
        expect(r2.candidates.some((c) => c.id === `restore:${it.id}`)).toBe(true);
        expect(r2.candidates.some((c) => c.id === `narrow:${it.id}`)).toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('选了“缩小”：只在所信时段保留挪动，前后段回到原安排，过度调整随之减少', () => {
    let narrowed = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const { e, records } = runBranch(sc, seed, clarify, parseTime('D04 20:00'));
      for (const r of records) {
        const c = r.candidates.find((x) => x.id === r.chosen[0]);
        if (!c?.id.startsWith('narrow:') || r.commit.outcome !== 'applied') continue;
        narrowed++;
        const items = e.state.agents[r.agent]!.plans[Number(c.params.day)] ?? [];
        expect(items.some((it) => it.origin?.reason === 'restore' && it.origin.decisionId === r.id)).toBe(true);
        const kept = items.find((it) => (it.origin?.reason === 'move' || it.origin?.reason === 'adapt') && it.start >= Number(c.params.from) - 60 && it.end <= Number(c.params.to) + 60);
        expect(kept).toBeTruthy();
      }
    }
    expect(narrowed).toBeGreaterThan(0);
  });

  it('riskOverlap 与所信的区、日、时段一致', () => {
    const map = Engine.create(sc, { seed: 1, decisionMode: 'rule' }).map;
    const t = parseTime('D03 09:00');
    const north = sc.map.places.find((p) => p.district === 'north')!.id;
    const south = sc.map.places.find((p) => p.district === 'south')!.id;
    const it = { start: parseTime('D04 12:00'), end: parseTime('D04 18:00'), place: north, needsPower: true };
    const exact = { event: 'power_outage' as const, area: 'north' as const, day: 4, window: { kind: 'exact' as const, from: 14 * 3600, to: 16 * 3600 } };
    expect(riskOverlap(map, it, exact, t)).toBe(2 * 3600);
    expect(riskOverlap(map, { ...it, place: south }, exact, t)).toBe(0);
    expect(riskOverlap(map, it, { ...exact, day: 5 }, t)).toBe(0);
    expect(riskOverlap(map, { ...it, needsPower: false }, exact, t)).toBe(0);
    void DEFAULT_PARAMS;
  });
});
