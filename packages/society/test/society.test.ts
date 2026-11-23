import { beforeAll, describe, expect, it } from 'vitest';
import {
  checkInvariants,
  commitsFor,
  contentHash,
  DAY,
  DEFAULT_PARAMS,
  Engine,
  generateCommunity,
  initialState,
  interiorOf,
  normalizeSpec,
  OLDTOWN,
  rand,
  reduce,
  totalMoney,
  WorldMap,
  CELL,
  type CommunityDef,
  type DomainEvent,
} from '../src/index.ts';

let def: CommunityDef;
beforeAll(() => {
  def = generateCommunity(OLDTOWN);
});

function run(seed: number, days: number, each?: (e: Engine, day: number) => void): { e: Engine; events: DomainEvent[] } {
  const events: DomainEvent[] = [];
  const e = Engine.create(def, { seed, onEvent: (ev) => events.push(ev) });
  for (let d = 1; d <= days; d++) {
    e.advance(d * DAY - 1);
    each?.(e, d);
  }
  return { e, events };
}

describe('社区生成', () => {
  it('同一规格生成同一社区；换生成种子换一批人', () => {
    expect(contentHash(generateCommunity(OLDTOWN))).toBe(contentHash(def));
    expect(contentHash(generateCommunity({ ...OLDTOWN, seed: 8 }))).not.toBe(contentHash(def));
  });

  it('人口在规格附近，每户有房，每个人的家就是户的家', () => {
    expect(def.people.length).toBeGreaterThanOrEqual(OLDTOWN.population);
    expect(def.people.length).toBeLessThan(OLDTOWN.population + 6);
    const homes = new Set<string>();
    for (const h of def.households) {
      const key = `${h.home}#${h.unit}`;
      expect(homes.has(key)).toBe(false);
      homes.add(key);
      for (const m of h.members) {
        const p = def.people.find((x) => x.id === m)!;
        expect([p.home, p.unit]).toEqual([h.home, h.unit]);
      }
      expect(h.members).toContain(h.shopper);
      expect(h.members).toContain(h.cook);
    }
    expect(new Set(def.people.map((p) => p.name)).size).toBe(def.people.length);
  });

  it('所有地点的门都在可走的格上，并且互相走得到', () => {
    const map = new WorldMap(def.map);
    const bus = def.map.places.find((p) => p.kind === 'busstop')!;
    for (const p of def.map.places) {
      expect(map.walkable(p.door.x, p.door.y), p.id).toBe(true);
      expect(Number.isFinite(map.meters(p.id, bus.id)), p.id).toBe(true);
    }
  });

  it('室内：站位都在占地之内；每套住房有床、餐座、沙发、灶台', () => {
    for (const p of def.map.places) {
      const it = interiorOf(p);
      for (const a of it.anchors) {
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.x).toBeLessThanOrEqual(p.w * CELL);
        expect(a.y).toBeGreaterThanOrEqual(0);
        expect(a.y).toBeLessThanOrEqual(p.h * CELL);
      }
      if (p.units > 0) {
        expect(it.units.length).toBe(p.units);
        for (let u = 0; u < p.units; u++) {
          const mine = it.anchors.filter((a) => a.unit === u);
          expect(mine.filter((a) => a.kind === 'bed').length).toBe(5);
          expect(mine.filter((a) => a.kind === 'dine').length).toBe(5);
          expect(mine.filter((a) => a.kind === 'sofa').length).toBe(3);
          expect(mine.filter((a) => a.kind === 'stove').length).toBe(1);
        }
      }
    }
    for (const h of def.households) expect(h.members.length).toBeLessThanOrEqual(5);
  });

  it('服务业的店都有店主或店员；有人去城里上班', () => {
    for (const f of def.firms) expect(f.staff.length, f.name).toBeGreaterThan(0);
    expect(def.people.filter((p) => p.job?.firm === 'city').length).toBeGreaterThan(5);
  });

  it('规范化把越界的规格拉回范围并说明原因', () => {
    const { spec, adjustments } = normalizeSpec({ ...OLDTOWN, population: 999, wealth: 0.1 });
    expect(spec.population).toBe(220);
    expect(spec.wealth).toBe(0.6);
    expect(adjustments.map((a) => a.field).sort()).toEqual(['population', 'wealth']);
  });
});

describe('固定安排', () => {
  it('朝九晚六的人工作日有班、周末没有；一家人的晚饭大家同一时刻开', () => {
    const map = new WorldMap(def.map);
    const ctx = { seed: 1, params: DEFAULT_PARAMS, map, P: Object.fromEntries(def.people.map((p) => [p.id, p])), H: Object.fromEntries(def.households.map((h) => [h.id, h])) };
    const clerk = def.people.find((p) => p.job?.shift === 'office')!;
    expect(commitsFor(ctx, clerk, 3).filter((c) => c.kind === 'work').length).toBe(2);
    expect(commitsFor(ctx, clerk, 6).filter((c) => c.kind === 'work').length).toBe(0);
    const hh = def.households.find((h) => h.type === 'elder_couple')!;
    const dinners = hh.members.map((m) => commitsFor(ctx, ctx.P[m]!, 3).find((c) => c.id === '3:dinner'));
    expect(dinners.every((c) => c && c.start === dinners[0]!.start)).toBe(true);
    // 安排不重叠
    for (const p of def.people) {
      const cs = commitsFor(ctx, p, 2);
      for (let i = 1; i < cs.length; i++) expect(cs[i]!.start).toBeGreaterThanOrEqual(cs[i - 1]!.end);
    }
  });
});

describe('引擎', () => {
  it('同种子逐事件相同；换种子不同', () => {
    const a = run(1, 2);
    const b = run(1, 2);
    const c = run(2, 2);
    expect(contentHash(a.events)).toBe(contentHash(b.events));
    expect(a.e.stateHash()).toBe(b.e.stateHash());
    expect(contentHash(c.events)).not.toBe(contentHash(a.events));
  });

  it('不变量每天都成立：钱守恒、库存不为负、一人一处、一位一人', () => {
    let total0 = 0;
    const events: DomainEvent[] = [];
    const e = Engine.create(def, { seed: 3, onEvent: (ev) => events.push(ev) });
    total0 = totalMoney(e.state);
    for (let d = 1; d <= 9; d++) {
      // 一天里抽几个时刻查
      for (const frac of [0.3, 0.52, 0.8, 1]) {
        e.advance(Math.floor((d - 1 + frac) * DAY) - 1);
        expect(checkInvariants(def, e.state, total0), `D${d} ${frac}`).toEqual([]);
      }
    }
    expect(events.some((x) => x.type === 'transfer' && x.kind === 'wage')).toBe(true);
    expect(events.some((x) => x.type === 'transfer' && x.kind === 'pension')).toBe(true);
  });

  it('浸泡：30 天每天结束时不变量都成立，耗时在 10 秒以内（M0 的性能探针）', () => {
    const e = Engine.create(def, { seed: 2 });
    const total0 = totalMoney(e.state);
    const t0 = performance.now();
    for (let d = 1; d <= 30; d++) {
      e.advance(d * DAY - 1);
      expect(checkInvariants(def, e.state, total0), `D${d}`).toEqual([]);
    }
    expect(performance.now() - t0).toBeLessThan(10_000);
  });

  it('重放一致：事件流经 reducer 重建的状态与引擎内状态相同', () => {
    const { e, events } = run(4, 4);
    const st = initialState(def, DEFAULT_PARAMS, 4, rand);
    for (const ev of events) reduce(st, ev, { params: DEFAULT_PARAMS });
    expect(contentHash(st)).toBe(e.stateHash());
    // 事件序号连续、时间不倒流
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.seq).toBe(events[i - 1]!.seq + 1);
      expect(events[i]!.t).toBeGreaterThanOrEqual(events[i - 1]!.t);
    }
  });

  it('分叉：从快照恢复后继续跑，与不中断的那一条完全相同', () => {
    const straight: DomainEvent[] = [];
    const a = Engine.create(def, { seed: 5, onEvent: (ev) => straight.push(ev) });
    a.advance(2 * DAY + 36000);
    const snap = a.snapshot();
    const before = straight.length;
    a.advance(4 * DAY);
    const b = Engine.restore(def, snap);
    const forked: DomainEvent[] = [];
    b.onEvent((ev) => forked.push(ev));
    b.advance(4 * DAY);
    expect(b.stateHash()).toBe(a.stateHash());
    expect(contentHash(forked)).toBe(contentHash(straight.slice(before)));
  });

  it('参数可覆盖：换一组参数得到不同的世界，默认参数对象不被改动', () => {
    const base = contentHash(DEFAULT_PARAMS);
    const events: DomainEvent[] = [];
    const e = Engine.create(def, { seed: 1, params: { temperature: 0.2, rainOutdoor: 9 }, onEvent: (ev) => events.push(ev) });
    e.advance(2 * DAY - 1);
    expect(contentHash(events)).not.toBe(contentHash(run(1, 2).events));
    expect(contentHash(DEFAULT_PARAMS)).toBe(base);
  });
});

describe('生活的典型事实（14 天）', () => {
  let events: DomainEvent[];
  let e: Engine;
  const DAYS = 14;
  beforeAll(() => {
    ({ e, events } = run(1, DAYS));
  });
  const P = () => Object.fromEntries(def.people.map((p) => [p.id, p]));
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

  it('睡眠：人均 6.5–9.5 小时', () => {
    const rows = events.filter((x) => x.type === 'day_summary' && x.day > 1) as Extract<DomainEvent, { type: 'day_summary' }>[];
    const people = P();
    const byPerson = new Map<string, number[]>();
    for (const r of rows) byPerson.set(r.agent, [...(byPerson.get(r.agent) ?? []), r.use.sleep / 3600]);
    const adults = [...byPerson].filter(([id]) => people[id]!.age >= 18).map(([, v]) => avg(v));
    expect(avg(adults)).toBeGreaterThan(6.5);
    expect(avg(adults)).toBeLessThan(9.5);
    // 没有人长期睡不够 5 小时
    expect(adults.filter((h) => h < 5).length).toBe(0);
  });

  it('工作：朝九晚六的人工作日工作 6–10 小时，周末不上班', () => {
    const people = P();
    const rows = events.filter((x) => x.type === 'day_summary' && people[x.agent]!.job?.shift === 'office') as Extract<DomainEvent, { type: 'day_summary' }>[];
    const weekday = rows.filter((r) => (r.day - 1) % 7 < 5).map((r) => r.use.work / 3600);
    const weekend = rows.filter((r) => (r.day - 1) % 7 >= 5).map((r) => r.use.work / 3600);
    expect(avg(weekday)).toBeGreaterThan(6);
    expect(avg(weekday)).toBeLessThan(10);
    expect(Math.max(...weekend)).toBe(0);
  });

  it('吃饭：没有人连续两天不吃饭', () => {
    const ate = new Map<string, Set<number>>();
    for (const ev of events) if (ev.type === 'act_started' && (ev.act.kind === 'eat_home' || ev.act.kind === 'eat_out' || ev.act.kind === 'eat_work' || ev.act.away)) ate.set(ev.agent, (ate.get(ev.agent) ?? new Set()).add(Math.floor(ev.t / DAY) + 1));
    for (const p of def.people) {
      const days = ate.get(p.id) ?? new Set();
      for (let d = 1; d < DAYS; d++) expect(days.has(d) || days.has(d + 1), `${p.name} D${d}`).toBe(true);
    }
  });

  it('上班上学基本不迟到：错过的固定安排不到 2%，迟到五分钟以上的班不到 1%', () => {
    const started = events.filter((x) => x.type === 'act_started' && x.act.commit).length;
    const missed = events.filter((x) => x.type === 'commit_missed').length;
    expect(missed / (started + missed)).toBeLessThan(0.02);
    const map = new WorldMap(def.map);
    const ctx = { seed: 1, params: DEFAULT_PARAMS, map, P: P(), H: Object.fromEntries(def.households.map((h) => [h.id, h])) };
    let shifts = 0;
    let late = 0;
    for (const ev of events) {
      if (ev.type !== 'act_started' || ev.act.kind !== 'work' || !ev.act.commit) continue;
      const day = Number(ev.act.commit.split(':')[0]);
      const c = commitsFor(ctx, ctx.P[ev.agent]!, day).find((x) => x.id === ev.act.commit)!;
      shifts++;
      if (ev.t - c.start > 300) late++;
    }
    expect(shifts).toBeGreaterThan(500);
    expect(late / shifts).toBeLessThan(0.01);
  });

  it('钱：入不敷出的家庭不到一成；个人钱包不为负', () => {
    const neg = def.households.filter((h) => (e.state.accounts[`hh:${h.id}`] ?? 0) < 0).length;
    expect(neg / def.households.length).toBeLessThan(0.1);
    for (const p of def.people) expect(e.state.accounts[p.id]!).toBeGreaterThanOrEqual(0);
  });

  it('关系会变：出现了新的熟人；有人从熟人、邻居、同事变成朋友', () => {
    expect(events.filter((x) => x.type === 'tie_formed').length).toBeGreaterThan(3);
    expect(events.filter((x) => x.type === 'chat').length).toBeGreaterThan(500);
  });

  it('每个自由选择都有决策记录：选中的在候选里，概率合理，因子相加等于效用', () => {
    const decisions = events.filter((x) => x.type === 'decision') as Extract<DomainEvent, { type: 'decision' }>[];
    expect(decisions.length).toBeGreaterThan(1000);
    for (const d of decisions.slice(0, 3000)) {
      const chosen = d.options.find((o) => o.id === d.chosen);
      expect(chosen).toBeTruthy();
      expect(d.options.length).toBeLessThanOrEqual(6);
      expect(d.options.reduce((a, o) => a + o.p, 0)).toBeLessThanOrEqual(1.01);
      for (const o of d.options) expect(Math.abs(Object.values(o.f).reduce((a, b) => a + b, 0) - o.u)).toBeLessThan(0.02);
    }
    // 不是固定安排、也不是等待和洗漱的活动，前面都有一次选择；接着做的那一件（做完饭吃饭）跟着前一件，不另选
    const started = events.filter((x): x is Extract<DomainEvent, { type: 'act_started' }> => x.type === 'act_started' && x.t > 0);
    const free = started.filter((x) => !x.act.commit && x.act.kind !== 'wait' && x.act.kind !== 'wash').length;
    const chained = started.filter((x) => x.act.next).length;
    expect(decisions.length).toBeGreaterThanOrEqual(free - chained);
  });

  it('生活有节律：工作日白天街上的人比深夜多；晚上有人跳广场舞', () => {
    const dance = events.filter((x) => x.type === 'act_started' && x.act.hobby === 'dance');
    expect(dance.length).toBeGreaterThan(20);
    const moves = events.filter((x) => x.type === 'move_started');
    const hour = (t: number) => Math.floor((t % DAY) / 3600);
    expect(moves.filter((m) => hour(m.t) >= 7 && hour(m.t) < 9).length).toBeGreaterThan(moves.filter((m) => hour(m.t) >= 0 && hour(m.t) < 4).length * 20);
  });
});
