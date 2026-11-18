import { beforeAll, describe, expect, it } from 'vitest';
import { BUCKETS, compare, DayRunner, dayStart, generateCommunity, gini, INDICATOR_LIST, judge, median, OCC_SLOTS, OLDTOWN, runLine, validateExperiment, type CommunityDef, type DayResult, type DomainEvent, type Experiment } from '../src/index.ts';

let def: CommunityDef;
let days: DayResult[];
beforeAll(() => {
  def = generateCommunity(OLDTOWN);
  const runner = new DayRunner(def, { seed: 1 }, true);
  days = [runner.next(), runner.next(), runner.next(), runner.next()];
});

describe('每日统计（D86）', () => {
  it('每人每天的小结与内核午夜发出的 day_summary 一致', () => {
    for (const d of [0, 1, 2]) {
      const sums = days[d + 1]!.events!.filter((e): e is Extract<DomainEvent, { type: 'day_summary' }> => e.type === 'day_summary');
      expect(sums.length).toBe(def.people.length);
      def.people.forEach((p, i) => {
        const s = sums.find((x) => x.agent === p.id)!;
        const mine = days[d]!.agg.people[i]!;
        expect(s.day).toBe(d + 1);
        expect(mine.use).toEqual(BUCKETS.map((b) => s.use[b]));
        expect([mine.spent, mine.earned, mine.chats, mine.mood]).toEqual([s.spent, s.earned, s.chats, s.mood]);
        // 一天的时间利用加起来正好是一天
        expect(mine.use.reduce((a, b) => a + b, 0)).toBe(86400);
      });
    }
  });

  it('分时段人数：24 个整点，每个整点所有人都有着落', () => {
    for (const d of days) {
      expect(d.agg.occupancy.length).toBe(24);
      for (const row of d.agg.occupancy) {
        expect(row.length).toBe(OCC_SLOTS.length);
        expect(row.reduce((a, b) => a + b, 0)).toBe(def.people.length);
      }
    }
    // 凌晨三点大家都在家；工作日上午十点有人在上班的地方、有人去了城里
    const night = days[1]!.agg.occupancy[3]!;
    expect(night[OCC_SLOTS.indexOf('house')]! + night[OCC_SLOTS.indexOf('apartment')]!).toBeGreaterThan(def.people.length * 0.95);
    const morning = days[1]!.agg.occupancy[10]!;
    expect(morning[OCC_SLOTS.indexOf('away')]!).toBeGreaterThan(5);
    expect(morning[OCC_SLOTS.indexOf('school')]!).toBeGreaterThan(10);
  });

  it('钱的流向与营业额：与当天的转账事件对得上', () => {
    for (const d of days) {
      const transfers = d.events!.filter((e): e is Extract<DomainEvent, { type: 'transfer' }> => e.type === 'transfer');
      const total = transfers.reduce((a, e) => a + e.amount, 0);
      expect(Object.values(d.agg.flows).reduce((a, b) => a + b, 0)).toBeCloseTo(total, 1);
      const sales = transfers.filter((e) => e.kind === 'purchase').reduce((a, e) => a + e.amount, 0);
      expect(Object.values(d.agg.revenue).reduce((a, b) => a + b, 0)).toBeCloseTo(sales, 1);
    }
    expect(days[0]!.agg.wallets.length).toBe(def.people.length);
    expect(days[0]!.agg.households.length).toBe(def.households.length);
  });

  it('快照 + 当天事件的时刻都落在这一天里', () => {
    for (const d of days) for (const e of d.events!) expect(e.t >= dayStart(d.day) && e.t < dayStart(d.day + 1)).toBe(true);
    expect(days[1]!.snapshot!.day).toBe(1);
  });

  it('所有指标都算得出有限的数', () => {
    const aggs = days.map((d) => d.agg);
    for (const ind of INDICATOR_LIST) expect(Number.isFinite(ind.compute(def, aggs)), ind.key).toBe(true);
    expect(new Set(INDICATOR_LIST.map((i) => i.key)).size).toBe(INDICATOR_LIST.length);
  });

  it('基尼系数与中位数', () => {
    expect(gini([1, 1, 1, 1])).toBeCloseTo(0);
    expect(gini([0, 0, 0, 10])).toBeCloseTo(0.75);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe('实验（D90）', () => {
  const x: Experiment = {
    name: '菜市场停业',
    question: '菜市场关了，小超市会不会更忙？',
    spec: OLDTOWN,
    seeds: [1, 2, 3],
    days: 7,
    interventions: [{ kind: 'close', place: 'market', from: 3 }],
    predictions: [
      { id: 'P1', text: '小超市的营业额更高', metric: 'revenue.grocery', expect: 'higher' },
      { id: 'P2', text: '菜市场的营业额更高', metric: 'revenue.market', expect: 'higher' },
    ],
  };

  it('清单校验', () => {
    expect(validateExperiment(x)).toEqual([]);
    expect(validateExperiment({ ...x, seeds: [], days: 99, interventions: [], predictions: [{ id: 'P', text: '', metric: 'nope', expect: 'higher' }] }).length).toBe(4);
    expect(validateExperiment({ ...x, seeds: [1, 1] }).length).toBe(1);
    expect(validateExperiment({ ...x, interventions: [{ kind: 'grant', amount: 1, day: 20 }] }).length).toBe(1);
  });

  it('判定：七成同向为支持，三成以下为相反，完全相同为没有差别', () => {
    expect(judge('higher', [1, 1, 1, 1], [2, 2, 2, 0]).verdict).toBe('支持');
    expect(judge('higher', [1, 1, 1, 1], [2, 2, 0, 0]).verdict).toBe('不明确');
    expect(judge('lower', [1, 1, 1, 1], [2, 2, 2, 0]).verdict).toBe('相反');
    expect(judge('higher', [1, 2], [1, 2]).verdict).toBe('没有差别');
  });

  it('两条世界线逐种子配对：预测得到判定，并找出日子过得最不一样的人', () => {
    const base = x.seeds.map((s) => runLine(def, s, [], x.days));
    const treat = x.seeds.map((s) => runLine(def, s, x.interventions, x.days));
    const r = compare(def, x, base, treat);
    expect(r.from).toBe(3);
    expect(r.predictions.map((p) => p.verdict)).toEqual(['支持', '相反']);
    expect(r.metrics.find((m) => m.key === 'revenue.market')!.treat).toEqual([0, 0, 0]);
    expect(r.affected.length).toBe(12);
    for (let i = 1; i < r.affected.length; i++) expect(r.affected[i]!.score).toBeLessThanOrEqual(r.affected[i - 1]!.score);
    expect(r.affected[0]!.score).toBeGreaterThan(0);
    expect(r.affected[0]!.day).toBeGreaterThanOrEqual(3);
    // 受影响最大的人里应当有菜摊摊主（他们不上班了）
    const vendors = r.affected.filter((a) => def.people[a.index]!.job?.occupation === 'vendor').length;
    expect(vendors).toBeGreaterThan(0);
    // 基线对基线：没有差别
    const same = compare(def, { ...x, predictions: [x.predictions[0]!] }, base, base);
    expect(same.predictions[0]!.verdict).toBe('没有差别');
    expect(same.affected[0]!.score).toBe(0);
  });
});
