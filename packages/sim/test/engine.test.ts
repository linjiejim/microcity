import { describe, expect, it } from 'vitest';
import {
  Engine,
  town30,
  at,
  parseTime,
  formatTime,
  contentHash,
  checkInvariants,
  checkProvenance,
  totalMoney,
  buildInitialState,
  applyAll,
  branchScript,
  defaultManifest,
  funnelMetrics,
  OUTAGE_FAMILY,
  type DomainEvent,
  type DecisionRecord,
  type ScriptEvent,
} from '@microcity/sim';

const HALF_HOUR = 1800;

function run(seed: number, until: string, opts: { collect?: boolean; script?: ScriptEvent[] } = {}) {
  const sc = town30();
  const e = Engine.create(sc, { seed, decisionMode: 'rule', ...(opts.script ? { script: opts.script } : {}) });
  const events: DomainEvent[] = [];
  const records: DecisionRecord[] = [];
  if (opts.collect) {
    e.onEvent((x) => events.push(x));
    e.onRecord((r) => records.push(r));
  }
  const end = parseTime(until);
  const money0 = totalMoney(e.state);
  const violations: string[] = [];
  for (let t = e.now; t < end; t = Math.min(end, t + HALF_HOUR)) {
    const r = e.advance(Math.min(end, t + HALF_HOUR));
    expect(r.blockedOn).toBeUndefined();
    for (const v of checkInvariants(e.state, e.map, money0)) violations.push(`${formatTime(e.now)} ${v.rule}: ${v.detail}`);
  }
  return { e, events, records, violations };
}

describe('浸泡：30 人 × 7 个模拟日（规则 provider）', () => {
  const { e, events, records, violations } = run(42, 'D08 06:00', { collect: true });
  it('每半小时检查一次，不变量零违例', () => {
    expect(violations).toEqual([]);
  });
  it('事件级溯源：每条信念都来自本人此前的曝光；转述版本都有父版本', () => {
    expect(checkProvenance(events)).toEqual([]);
  });
  it('每个人每天都醒来、吃饭、按计划活动', () => {
    for (const a of Object.values(e.state.agents)) {
      const woke = events.filter((x) => x.type === 'woke' && x.agent === a.id).length;
      const meals = events.filter((x) => x.type === 'meal' && x.agent === a.id).length;
      expect(woke, a.name).toBeGreaterThanOrEqual(7);
      expect(meals, a.name).toBeGreaterThanOrEqual(14);
    }
  });
  it('停电真实发生，并产生可计算的不便', () => {
    const power = events.filter((x) => x.type === 'power');
    expect(power.map((x) => formatTime(x.t))).toEqual(['D04 14:00', 'D04 16:00']);
    expect(events.some((x) => x.type === 'inconvenience')).toBe(true);
  });
  it('决策审计记录完整：候选、因子来源、概率、随机数、结果', () => {
    expect(records.length).toBeGreaterThan(10);
    for (const r of records) {
      expect(r.candidates.length).toBeGreaterThan(0);
      for (const c of r.chosen) expect([...r.candidates.map((x) => x.id), 'skip']).toContain(c);
      if (r.kind === 'reaction') {
        const sum = Object.values(r.probabilities).reduce((x, y) => x + y, 0);
        expect(sum).toBeGreaterThan(0.98);
        expect(sum).toBeLessThan(1.02);
        expect(r.rng.value).toBeGreaterThanOrEqual(0);
        expect(r.rng.value).toBeLessThan(1);
      }
      for (const f of Object.values(r.factors)) for (const v of Object.values(f)) expect(v.source).toMatch(/^(rule|model|fallback):/);
      expect(r.summary).toContain('非内部推理');
    }
  });
  it('“聊到消息”的对话写明了说出口的版本，且与转述记录一一对应', () => {
    const convs = events.filter((e) => e.type === 'conversation' && e.topic === 'news');
    expect(convs.length).toBeGreaterThan(5);
    for (const c of convs) {
      if (c.type !== 'conversation') continue;
      for (const x of c.exchanges.filter((y) => y.mentioned)) {
        expect(x.versionId, `${c.id} ${x.from}→${x.to}`).toBeTruthy();
        const tr = events.find((e) => e.type === 'transmission' && e.conv === c.id && e.tr.from === x.from && e.tr.to === x.to && e.tr.familyId === x.family);
        expect(tr && tr.type === 'transmission' && tr.tr.versionId).toBe(x.versionId);
      }
    }
  });
  it('漏斗七个阶段都有人到达，负面状态也有记录', () => {
    const f = funnelMetrics(e.state, OUTAGE_FAMILY);
    for (const st of ['reached', 'exposed', 'attended', 'comprehended', 'believed', 'intended', 'acted', 'relayed'] as const) expect(f.stages[st], st).toBeGreaterThan(0);
    expect(Object.values(f.stops).reduce((x, y) => x + y, 0)).toBeGreaterThan(0);
  });
  it('漏斗逐层嵌套：可达 ≥ 曝光 ≥ 注意 ≥ 理解 ≥ 相信 ≥ 改了安排 ≥ 付诸行动', () => {
    const order = ['reached', 'exposed', 'attended', 'comprehended', 'believed', 'intended', 'acted'] as const;
    for (const a of Object.values(e.state.agents)) {
      const f = a.funnel[OUTAGE_FAMILY] ?? {};
      for (let i = 1; i < order.length; i++) {
        if (f[order[i]!] !== undefined) expect(f[order[i - 1]!], `${a.name} 有 ${order[i]} 却没有 ${order[i - 1]}`).toBeDefined();
      }
    }
  });
});

describe('确定性与重放', () => {
  it('同一 seed 跑两次，终态哈希一致；换 seed 则不同', () => {
    const a = run(7, 'D04 20:00').e;
    const b = run(7, 'D04 20:00').e;
    const c = run(8, 'D04 20:00').e;
    expect(contentHash(a.state)).toBe(contentHash(b.state));
    expect(contentHash(a.state)).not.toBe(contentHash(c.state));
  });
  it('“初始状态 + 事件日志”重建出的状态与引擎一致（前端同构 reducer 的前提）', () => {
    const { e, events } = run(3, 'D04 20:00', { collect: true });
    const rebuilt = buildInitialState(town30(), 3);
    applyAll(rebuilt, events);
    expect(contentHash(rebuilt)).toBe(contentHash(e.state));
  });
  it('快照 → 恢复 → 继续，与一口气跑完一致', () => {
    const sc = town30();
    const whole = Engine.create(sc, { seed: 11, decisionMode: 'rule' });
    whole.advance(parseTime('D04 18:00'));
    const part = Engine.create(sc, { seed: 11, decisionMode: 'rule' });
    part.advance(parseTime('D03 10:17'));
    const restored = Engine.restore(JSON.parse(JSON.stringify(part.snapshot())), sc);
    restored.advance(parseTime('D04 18:00'));
    expect(contentHash(restored.state)).toBe(contentHash(whole.state));
  });
});

describe('分叉', () => {
  const sc = town30();
  const m = defaultManifest(42);
  const base = Engine.create(sc, { seed: 42, decisionMode: 'rule' });
  base.advance(parseTime(m.forkAt));
  const snap = base.snapshot();
  const forkHash = contentHash(snap.state);

  it('分叉前状态哈希一致；同一分支跑两次结果相同', () => {
    const a1 = Engine.restore(snap, sc, { script: branchScript(sc, m.branches.A!) });
    const a2 = Engine.restore(snap, sc, { script: branchScript(sc, m.branches.A!) });
    expect(contentHash(a1.state)).toBe(forkHash);
    a1.advance(at(4, 20));
    a2.advance(at(4, 20));
    expect(contentHash(a1.state)).toBe(contentHash(a2.state));
  });
  it('分支差异只从干预之后开始：发布前的事件完全相同', () => {
    const logs: Record<string, DomainEvent[]> = {};
    for (const k of ['A', 'C']) {
      const e = Engine.restore(snap, sc, { script: branchScript(sc, m.branches[k]!) });
      logs[k] = [];
      e.onEvent((x) => logs[k]!.push(x));
      e.advance(at(4, 20));
    }
    const publish = parseTime('D03 08:05');
    const before = (xs: DomainEvent[]) => xs.filter((x) => x.t < publish).map((x) => contentHash(x));
    expect(before(logs.A!)).toEqual(before(logs.C!));
    const pubA = logs.A!.find((x) => x.type === 'news_published');
    const pubC = logs.C!.find((x) => x.type === 'news_published');
    expect(pubA?.type === 'news_published' && pubA.news.channels).toEqual(['website']);
    expect(pubC?.type === 'news_published' && pubC.news.channels).toEqual(['website', 'push']);
    expect(contentHash(logs.A)).not.toBe(contentHash(logs.C));
  });
});

describe('知识隔离', () => {
  it('只告诉一个人的秘密：其他人知道它必须经由记录在案的转述链', () => {
    const secret: ScriptEvent = {
      at: parseTime('D02 09:30'),
      kind: 'org_notice',
      org: 'press',
      note: '只发给编辑部的内部消息',
      news: {
        id: 'S1',
        familyId: 'F_SECRET',
        headline: { text: '内部：南街周六封路', slots: { event: '封路', area: 'south', day: 6, certainty: 'likely', source: 'org' } },
        body: { text: '内部：南街周六封路', slots: { event: '封路', area: 'south', day: 6, certainty: 'likely', source: 'org' } },
        publisher: { kind: 'org', id: 'press', name: '社区报' },
      },
    };
    const { e, events } = run(5, 'D04 00:00', { collect: true, script: [secret] });
    const insider = 'a13';
    const knowers = Object.values(e.state.agents).filter((a) => a.beliefs.F_SECRET);
    expect(knowers.map((a) => a.id)).toContain(insider);
    const informed = new Set([insider]);
    for (const x of events) {
      if (x.type === 'transmission' && x.tr.familyId === 'F_SECRET') {
        expect(informed.has(x.tr.from), `${x.tr.from} 在被告知之前就转述了`).toBe(true);
        informed.add(x.tr.to);
      }
    }
    for (const a of knowers) expect(informed.has(a.id), `${a.name} 没有转述链却知道秘密`).toBe(true);
  });
});
