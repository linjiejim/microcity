import { beforeAll, describe, expect, it } from 'vitest';
import { checkInvariants, contentHash, DAY, dayOf, dayStart, DEFAULT_PARAMS, Engine, generateCommunity, initialState, OLDTOWN, rand, reduce, totalMoney, type CommunityDef, type DomainEvent, type Intervention } from '../src/index.ts';

let def: CommunityDef;
let base: DomainEvent[];
const DAYS = 9;

function run(interventions: Intervention[], days = DAYS, seed = 1): { e: Engine; events: DomainEvent[] } {
  const events: DomainEvent[] = [];
  const e = Engine.create(def, { seed, interventions, onEvent: (ev) => events.push(ev) });
  const total0 = totalMoney(e.state);
  for (let d = 1; d <= days; d++) {
    e.advance(d * DAY - 1);
    expect(checkInvariants(def, e.state, total0), `D${d}`).toEqual([]);
  }
  return { e, events };
}

beforeAll(() => {
  def = generateCommunity(OLDTOWN);
  base = run([]).events;
});

const firmOf = (kind: string) => def.firms.find((f) => def.map.places.find((p) => p.id === f.place)!.kind === kind)!;
const sales = (events: DomainEvent[], firm: string, from = 1) => events.filter((x) => x.type === 'transfer' && x.to === firm && x.kind === 'purchase' && dayOf(x.t) >= from).reduce((a, x) => a + (x as Extract<DomainEvent, { type: 'transfer' }>).amount, 0);
const prefix = (events: DomainEvent[], day: number) => contentHash(events.filter((x) => x.t < dayStart(day)));

describe('干预（D88）', () => {
  it('不加干预与基线逐事件相同；干预生效的前一天之前，事件也相同', () => {
    expect(contentHash(run([]).events)).toBe(contentHash(base));
    const { events } = run([{ kind: 'close', place: 'market', from: 4 }]);
    // 有起止的干预是事先知道的：前一天晚上，人们已经按“明天不开门”安排起床时间了
    expect(prefix(events, 3)).toBe(prefix(base, 3));
    // 一次性的干预（发钱、裁员、传言）事先没人知道：到点之前完全相同
    const grant = run([{ kind: 'grant', amount: 500, day: 4 }]).events;
    expect(contentHash(grant.filter((x) => x.t < dayStart(4) + 9 * 3600))).toBe(contentHash(base.filter((x) => x.t < dayStart(4) + 9 * 3600)));
    expect(contentHash(events)).not.toBe(contentHash(base));
  });

  it('停业：菜市场关门后没有人在那里买到菜，摊主不上班，买菜的人去了别处', () => {
    const market = firmOf('market');
    const { events } = run([{ kind: 'close', place: 'market', from: 4 }]);
    expect(sales(events, market.id, 4)).toBe(0);
    expect(events.filter((x) => x.type === 'act_started' && x.act.kind === 'work' && x.act.place === market.place && dayOf(x.t) >= 4).length).toBe(0);
    const groceries = def.firms.filter((f) => def.map.places.find((p) => p.id === f.place)!.kind === 'grocery');
    const grocerySales = (ev: DomainEvent[]) => groceries.reduce((a, f) => a + sales(ev, f.id, 4), 0);
    expect(grocerySales(events)).toBeGreaterThan(grocerySales(base) * 1.2);
    expect(events.some((x) => x.type === 'intervention' && x.phase === 'start')).toBe(true);
  });

  it('调价：涨价后菜市场按新价格收钱', () => {
    const market = firmOf('market');
    const basePrice = market.offers.find((o) => o.item === 'food')!.price;
    const { events } = run([{ kind: 'price', place: 'market', item: 'food', factor: 1.5, from: 4, to: 6 }]);
    const unit = (x: DomainEvent) => {
      if (x.type !== 'transfer' || x.to !== market.id || x.kind !== 'purchase') return undefined;
      const qty = Number(/× (\d+)/.exec(x.memo)?.[1]);
      return Math.round((x.amount / qty) * 100) / 100;
    };
    const during = events.filter((x) => dayOf(x.t) >= 4 && dayOf(x.t) <= 6).map(unit).filter((u) => u !== undefined);
    const after = events.filter((x) => dayOf(x.t) >= 7).map(unit).filter((u) => u !== undefined);
    expect(during.length).toBeGreaterThan(0);
    expect(new Set(during)).toEqual(new Set([basePrice * 1.5]));
    expect(new Set(after)).toEqual(new Set([basePrice]));
    expect(events.filter((x) => x.type === 'intervention').map((x) => (x as Extract<DomainEvent, { type: 'intervention' }>).phase)).toEqual(['start', 'end']);
  });

  it('发钱：每户收到一笔；只发给指定类型时只有那些家庭收到', () => {
    const all = run([{ kind: 'grant', amount: 500, day: 3 }], 3).events.filter((x) => x.type === 'transfer' && x.kind === 'grant' && x.memo.includes('补贴'));
    expect(all.length).toBe(def.households.length);
    const some = run([{ kind: 'grant', amount: 500, day: 3, households: ['elder_single'] }], 3).events.filter((x) => x.type === 'transfer' && x.kind === 'grant' && x.memo.includes('补贴'));
    expect(some.length).toBe(def.households.filter((h) => h.type === 'elder_single').length);
  });

  it('裁员：被裁的人此后不再上班，周五没有工资', () => {
    const shop = firmOf('workshop');
    const { e, events } = run([{ kind: 'layoff', place: 'workshop', fraction: 0.5, day: 3 }]);
    const fired = events.filter((x) => x.type === 'laid_off').map((x) => (x as Extract<DomainEvent, { type: 'laid_off' }>).agent);
    expect(fired.length).toBe(Math.round(shop.staff.filter((id) => id !== shop.owner).length * 0.5));
    expect(fired).not.toContain(shop.owner);
    for (const id of fired) {
      expect(e.state.people[id]!.laidOff).toBe(true);
      expect(events.filter((x) => x.type === 'act_started' && x.agent === id && x.act.kind === 'work' && dayOf(x.t) >= 4).length).toBe(0);
    }
    // 第 5 天（周五）发的工资只算裁员前上的班
    const wages = events.filter((x) => x.type === 'transfer' && x.kind === 'wage' && fired.includes(x.to)) as Extract<DomainEvent, { type: 'transfer' }>[];
    for (const w of wages) expect(w.memo).toMatch(/[123] 天/);
  });

  it('房租：涨了之后每周的房租变多', () => {
    const rent = (ev: DomainEvent[]) => ev.filter((x) => x.type === 'transfer' && x.kind === 'rent' && dayOf(x.t) === 8).reduce((a, x) => a + (x as Extract<DomainEvent, { type: 'transfer' }>).amount, 0);
    const { events } = run([{ kind: 'rent', factor: 1.5, from: 8 }]);
    expect(rent(base)).toBeGreaterThan(0);
    expect(rent(events) / rent(base)).toBeCloseTo(1.5, 1);
  });

  it('开伙：活动中心办起食堂后，有人在那里吃饭', () => {
    const center = firmOf('center');
    expect(sales(base, center.id)).toBe(0);
    const { events } = run([{ kind: 'canteen', place: 'center', price: 9, from: 3 }]);
    const meals = events.filter((x) => x.type === 'act_started' && x.act.kind === 'eat_out' && x.act.place === center.place);
    expect(meals.length).toBeGreaterThan(10);
    expect(sales(events, center.id, 3)).toBe(meals.length * 9);
    expect(meals.every((x) => dayOf(x.t) >= 3)).toBe(true);
  });

  it('天气：连着下雨的几天，露天的消遣少了', () => {
    const { events } = run([{ kind: 'weather', weather: 'rain', from: 2, to: 5 }]);
    const days = events.filter((x) => x.type === 'day_started') as Extract<DomainEvent, { type: 'day_started' }>[];
    for (const d of days) if (d.day >= 2 && d.day <= 5) expect(d.weather).toBe('rain');
    const open = new Set(def.map.places.filter((p) => p.open).map((p) => p.id));
    const outdoor = (ev: DomainEvent[]) => ev.filter((x) => x.type === 'act_started' && x.act.kind === 'hobby' && open.has(x.act.place) && dayOf(x.t) >= 2 && dayOf(x.t) <= 5).length;
    const sunny = run([{ kind: 'weather', weather: 'sun', from: 2, to: 5 }]).events;
    expect(outdoor(events)).toBeLessThan(outdoor(sunny) * 0.5);
  });

  it('传言：从几个人开始，经聊天传开；听说的家庭多买了菜', () => {
    const { e, events } = run([{ kind: 'rumor', topic: 'price_up', seeds: 6, day: 3 }]);
    const heard = events.filter((x) => x.type === 'heard') as Extract<DomainEvent, { type: 'heard' }>[];
    expect(heard.filter((h) => !h.from).length).toBe(6);
    expect(heard.filter((h) => h.from).length).toBeGreaterThan(6);
    // 每个人只听说一次；告诉他的人当时已经知道
    expect(new Set(heard.map((h) => h.agent)).size).toBe(heard.length);
    const known = new Set<string>();
    for (const h of heard) {
      if (h.from) expect(known.has(h.from)).toBe(true);
      known.add(h.agent);
    }
    const food = (ev: DomainEvent[]) => ev.filter((x) => x.type === 'stock' && x.holder.startsWith('hh:') && x.item === 'food' && x.delta > 0 && dayOf(x.t) >= 3 && dayOf(x.t) <= 6).reduce((a, x) => a + (x as Extract<DomainEvent, { type: 'stock' }>).delta, 0);
    expect(food(events)).toBeGreaterThan(food(base) * 1.1);
    expect(Object.values(e.state.people).filter((p) => p.heard.price_up !== undefined).length).toBe(heard.length);
  });

  it('几条干预叠在一起：重放一致，分叉一致', () => {
    const ivs: Intervention[] = [
      { kind: 'close', place: 'market', from: 3, to: 6 },
      { kind: 'rumor', topic: 'shortage', seeds: 4, day: 2 },
      { kind: 'grant', amount: 300, day: 4 },
      { kind: 'layoff', place: 'workshop', fraction: 0.3, day: 4 },
      { kind: 'canteen', place: 'center', price: 8, from: 2 },
      { kind: 'rent', factor: 1.2, from: 1 },
    ];
    const events: DomainEvent[] = [];
    const a = Engine.create(def, { seed: 6, interventions: ivs, onEvent: (ev) => events.push(ev) });
    a.advance(3 * DAY + 40000);
    const snap = a.snapshot();
    const cut = events.length;
    a.advance(7 * DAY);
    const st = initialState(def, DEFAULT_PARAMS, 6, rand);
    for (const ev of events) reduce(st, ev, { params: DEFAULT_PARAMS });
    expect(contentHash(st)).toBe(a.stateHash());
    const b = Engine.restore(def, snap);
    const forked: DomainEvent[] = [];
    b.onEvent((ev) => forked.push(ev));
    b.advance(7 * DAY);
    expect(contentHash(forked)).toBe(contentHash(events.slice(cut)));
  });
});

describe('预算感与处境（D98）', () => {
  it('被裁之后：更省着花，心情里多了一笔处境分；房租涨了也更紧', async () => {
    const { budgetOf } = await import('../src/index.ts');
    const fired: string[] = [];
    const e = Engine.create(def, { seed: 1, interventions: [{ kind: 'layoff', place: 'workshop', fraction: 0.5, day: 2 }, { kind: 'rent', factor: 1.6, from: 3 }], onEvent: (ev) => ev.type === 'laid_off' && fired.push(ev.agent) });
    const base = Engine.create(def, { seed: 1 });
    e.advance(2 * DAY + 10 * 3600);
    base.advance(2 * DAY + 10 * 3600);
    expect(fired.length).toBeGreaterThan(0);
    for (const id of fired) {
      const p = def.people.find((x) => x.id === id)!;
      const a = budgetOf(e, p, 3);
      const b = budgetOf(base, p, 3);
      expect(a.tight).toBeGreaterThan(b.tight);
      expect(a.stress).toBeGreaterThan(b.stress);
      expect(a.disposable).toBeLessThan(b.disposable);
    }
    const renter = def.people.find((p) => def.households.find((h) => h.id === p.household)!.rentWeekly > 0 && !fired.includes(p.id))!;
    expect(budgetOf(e, renter, 3).disposable).toBeLessThan(budgetOf(e, renter, 2).disposable);
  });
});
