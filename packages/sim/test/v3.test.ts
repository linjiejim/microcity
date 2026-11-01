import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS,
  Engine,
  PARAM_PRESETS,
  applyAll,
  applyPatches,
  branchScript,
  buildInitialState,
  contentHash,
  describeEventInput,
  generatedDefaults,
  memoryEffect,
  normalizeSpec,
  outcomeMetrics,
  parseTime,
  resolveParams,
  ruleSemantics,
  scenarioFromSpec,
  type Agent,
  type BranchSpec,
  type DomainEvent,
  type ScenarioDef,
} from '../src/index.ts';

/** 北区三轮：D03、D05、D07 14:00–16:00，前一天 08:05 三渠道精确通知 */
function wolfTown(): ScenarioDef {
  const s = generatedDefaults();
  const ev = (id: string, day: number) => ({ id, area: 'north' as const, day, from: '14:00', to: '16:00', notice: { at: `D0${day - 1} 08:05`, channels: ['website' as const, 'push' as const, 'board' as const], headline: 'exact' as const, advice: ['charge_devices' as const] }, clarify: null, workOrder: true });
  Object.assign(s, { seed: 42, population: { size: 40, seniors: 0.25, youth: 0.25, northShare: 0.5 } });
  s.events = [ev('E1', 3), ev('E2', 5), ev('E3', 7)];
  return scenarioFromSpec(normalizeSpec(s).spec);
}

function run(sc: ScenarioDef, seed: number, spec: BranchSpec, until: string) {
  const e = Engine.create(sc, { seed, decisionMode: 'rule', script: branchScript(sc, spec) });
  const events: DomainEvent[] = [];
  e.onEvent((x) => events.push(x));
  e.advance(parseTime(until));
  return { e, events };
}

describe('虚惊（social_v3）', () => {
  const sc = wolfTown();
  const wolf: BranchSpec = { label: '两次虚惊', patches: [{ event: 'E1', mode: 'false_alarm' }, { event: 'E2', mode: 'false_alarm' }] };

  it('剧本：虚惊照常通知与派工单，但没有断电，到原定恢复时刻“真相可见”；不存在的一轮整个消失', () => {
    const s1 = branchScript(sc, wolf);
    expect(s1.filter((x) => x.kind === 'power' && x.outage === 'E1')).toHaveLength(0);
    expect(s1.filter((x) => x.kind === 'reveal').map((x) => (x as { outage: string }).outage)).toEqual(['E1', 'E2']);
    expect(s1.some((x) => x.kind === 'publish' && x.news.familyId === sc.outages[0]!.family)).toBe(true);
    const s2 = branchScript(sc, { label: '没有前情', patches: [{ event: 'E1', mode: 'absent' }, { event: 'E2', mode: 'absent' }] });
    expect(s2.every((x) => (x.kind === 'publish' || x.kind === 'org_notice' ? x.news.familyId === sc.outages[2]!.family : x.kind !== 'reveal' && (x as { outage?: string }).outage === 'E3'))).toBe(true);
    expect(applyPatches(sc.events, [{ event: 'E2', mode: 'absent' }]).map((e) => e.id)).toEqual(['E1', 'E3']);
  });

  it('后果：没有人措手不及；为虚惊挪的安排整段计为过度调整；信了通知的见证者记下虚惊经历、对官方的信任下降', () => {
    const { e, events } = run(sc, 5, wolf, 'D05 20:00');
    expect(events.filter((x) => x.type === 'power')).toHaveLength(0);
    expect(events.filter((x) => x.type === 'false_alarm').map((x) => (x as { outage: string }).outage)).toEqual(['E1', 'E2']);
    const m1 = outcomeMetrics(e.state, 'E1');
    expect(m1.surprisedPeople).toBe(0);
    const exp = events.filter((x): x is Extract<DomainEvent, { type: 'experience' }> => x.type === 'experience');
    expect(exp.length).toBeGreaterThan(0);
    expect(new Set(exp.map((x) => x.kind))).toEqual(new Set(exp.map((x) => x.kind).filter((k) => k === 'false_alarm' || k === 'false_alarm_costly')));
    for (const x of exp.filter((y) => y.kind === 'false_alarm_costly')) expect(e.state.agents[x.agent]!.stats.byOutage[x.outage]!.overreactSec).toBeGreaterThan(0);
    const down = events.filter((x) => x.type === 'trust_changed' && x.target === 'gov');
    expect(down.length).toBeGreaterThan(0);
    for (const x of down) expect((x as { to: number; from: number }).to).toBeLessThan((x as { from: number }).from);
    const replay = buildInitialState(sc, 5);
    applyAll(replay, events);
    expect(contentHash(replay)).toBe(contentHash(e.state));
  });

  it('经历按次数叠加；规则心智里虚惊让“照常”更有吸引力，Jev 的答案不受这一项影响', () => {
    const { e } = run(sc, 5, wolf, 'D05 20:00');
    const twice = Object.values(e.state.agents).find((a) => (a.memory ?? []).filter((m) => m.kind.startsWith('false_alarm')).length === 2)!;
    expect(twice).toBeTruthy();
    const once = { ...twice, memory: twice.memory!.slice(0, 1) } as Agent;
    expect(memoryEffect(twice, DEFAULT_PARAMS.memory.keep)).toBeGreaterThan(memoryEffect(once, DEFAULT_PARAMS.memory.keep));
    const b = { familyId: 'F', slots: { event: 'power_outage' as const, area: 'north' as const, day: 7, window: { kind: 'exact' as const, from: 14 * 3600, to: 16 * 3600 }, source: 'gov' as const, certainty: 'confirmed' as const }, slotFrom: {}, slotCred: {}, versionId: 'v', confidence: 0.9, status: 'believe' as const, sources: [], firstAt: 0, updatedAt: 0 };
    const cands = [{ id: 'keep', kind: 'keep' as const, label: '照常', params: {} }];
    expect(ruleSemantics(twice, b, cands).keepBias).toBeGreaterThan(0);
    expect(ruleSemantics(twice, b, cands, resolveParams(PARAM_PRESETS.v1)).keepBias).toBeUndefined();
    expect(ruleSemantics({ ...twice, memory: undefined } as Agent, b, cands).keepBias).toBeUndefined();
  });

  it('规格：虚惊标记经过规范化保留下来，描述里写明；默认没有', () => {
    const s = generatedDefaults();
    s.events = [{ ...s.events[0]!, falseAlarm: true }];
    const n = normalizeSpec(s).spec;
    expect(n.events[0]!.falseAlarm).toBe(true);
    expect(describeEventInput(n.events[0]!)).toContain('虚惊');
    const sc2 = scenarioFromSpec(n);
    expect(sc2.outages[0]!.falseAlarm).toBe(true);
    expect(sc2.script.some((x) => x.kind === 'reveal')).toBe(true);
    expect(normalizeSpec(generatedDefaults()).spec.events[0]!.falseAlarm).toBeUndefined();
  });
});
