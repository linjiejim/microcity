import { BUCKETS, type Bucket } from '../data/tables.ts';
import type { CommunityDef, PersonDef, PlaceKind } from '../model/def.ts';
import type { DayAgg } from './stats.ts';

/**
 * 指标：从每日统计里算出的一个数（在一段日子上取平均，或取最后一天）。
 * 实验的预测与判定都指向这里的键；新增指标只需要在这里加一行。
 */
export interface Indicator {
  key: string;
  label: string;
  unit: string;
  group: '过日子' | '人与人' | '钱' | '店铺' | '消息';
  /** 小数位数 */
  digits: number;
  compute: (def: CommunityDef, days: DayAgg[]) => number;
}

type Who = (p: PersonDef) => boolean;
const ALL: Who = () => true;
const ELDER: Who = (p) => p.age >= 60;
const WORKER: Who = (p) => !!p.job;
const CHILD: Who = (p) => p.age < 18;

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** 一群人在这些天里某个量的人均日均值 */
function perPerson(def: CommunityDef, days: DayAgg[], who: Who, f: (s: DayAgg['people'][number]) => number): number {
  const idx = def.people.map((p, i) => (who(p) ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0 || days.length === 0) return 0;
  let sum = 0;
  for (const d of days) for (const i of idx) sum += f(d.people[i]!);
  return sum / (idx.length * days.length);
}

const hours = (bucket: Bucket) => {
  const k = BUCKETS.indexOf(bucket);
  return (s: DayAgg['people'][number]) => s.use[k]! / 3600;
};
const perDay = (days: DayAgg[], f: (d: DayAgg) => number): number => mean(days.map(f));
const last = <T>(days: DayAgg[], f: (d: DayAgg) => T, empty: T): T => (days.length ? f(days[days.length - 1]!) : empty);

export function gini(values: number[]): number {
  const xs = values.map((v) => Math.max(0, v)).sort((a, b) => a - b);
  const n = xs.length;
  const total = xs.reduce((a, b) => a + b, 0);
  if (n === 0 || total === 0) return 0;
  let acc = 0;
  xs.forEach((x, i) => (acc += (2 * (i + 1) - n - 1) * x));
  return acc / (n * total);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const xs = [...values].sort((a, b) => a - b);
  const m = xs.length >> 1;
  return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
}

const revenueOf = (kind: PlaceKind) => (def: CommunityDef, days: DayAgg[]) => {
  const firms = def.firms.filter((f) => def.map.places.find((p) => p.id === f.place)?.kind === kind).map((f) => f.id);
  return perDay(days, (d) => firms.reduce((a, id) => a + (d.revenue[id] ?? 0), 0));
};
const visitsOf = (kind: PlaceKind) => (_def: CommunityDef, days: DayAgg[]) => perDay(days, (d) => d.visits[kind] ?? 0);
const actsOf = (...keys: string[]) => (_def: CommunityDef, days: DayAgg[]) => perDay(days, (d) => keys.reduce((a, k) => a + (d.acts[k] ?? 0), 0));

const LIST: Indicator[] = [
  { key: 'mood.all', label: '心情（所有人）', unit: '分', group: '过日子', digits: 1, compute: (def, days) => perPerson(def, days, ALL, (s) => s.mood) * 100 },
  { key: 'mood.elder', label: '心情（老人）', unit: '分', group: '过日子', digits: 1, compute: (def, days) => perPerson(def, days, ELDER, (s) => s.mood) * 100 },
  { key: 'mood.worker', label: '心情（上班的人）', unit: '分', group: '过日子', digits: 1, compute: (def, days) => perPerson(def, days, WORKER, (s) => s.mood) * 100 },
  { key: 'mood.child', label: '心情（孩子）', unit: '分', group: '过日子', digits: 1, compute: (def, days) => perPerson(def, days, CHILD, (s) => s.mood) * 100 },
  { key: 'time.sleep', label: '睡觉', unit: '小时/天', group: '过日子', digits: 2, compute: (def, days) => perPerson(def, days, ALL, hours('sleep')) },
  { key: 'time.work', label: '上班的人的工作时间', unit: '小时/天', group: '过日子', digits: 2, compute: (def, days) => perPerson(def, days, WORKER, hours('work')) },
  { key: 'time.leisure', label: '休闲', unit: '小时/天', group: '过日子', digits: 2, compute: (def, days) => perPerson(def, days, ALL, hours('leisure')) },
  { key: 'time.leisure.elder', label: '老人的休闲', unit: '小时/天', group: '过日子', digits: 2, compute: (def, days) => perPerson(def, days, ELDER, hours('leisure')) },
  { key: 'time.chores', label: '家务与采购', unit: '小时/天', group: '过日子', digits: 2, compute: (def, days) => perPerson(def, days, ALL, hours('chores')) },
  { key: 'time.travel', label: '在路上', unit: '小时/天', group: '过日子', digits: 2, compute: (def, days) => perPerson(def, days, ALL, hours('travel')) },
  { key: 'time.travel.elder', label: '老人在路上', unit: '小时/天', group: '过日子', digits: 2, compute: (def, days) => perPerson(def, days, ELDER, hours('travel')) },
  { key: 'eat.out', label: '在外面吃的顿数', unit: '顿/天', group: '过日子', digits: 1, compute: actsOf('eat_out') },
  { key: 'eat.home', label: '在家吃的顿数', unit: '顿/天', group: '过日子', digits: 1, compute: actsOf('eat_home') },
  { key: 'pantry', label: '人均存粮', unit: '份', group: '过日子', digits: 2, compute: (_def, days) => perDay(days, (d) => d.pantry) },

  { key: 'chats.all', label: '聊天（所有人）', unit: '次/人/天', group: '人与人', digits: 2, compute: (def, days) => perPerson(def, days, ALL, (s) => s.chats) },
  { key: 'chats.elder', label: '聊天（老人）', unit: '次/人/天', group: '人与人', digits: 2, compute: (def, days) => perPerson(def, days, ELDER, (s) => s.chats) },
  {
    key: 'alone.elder',
    label: '一整天没和人聊过的老人',
    unit: '%',
    group: '人与人',
    digits: 1,
    compute: (def, days) => perPerson(def, days, ELDER, (s) => (s.chats === 0 ? 100 : 0)),
  },
  { key: 'alone.all', label: '一整天没和人聊过的人', unit: '%', group: '人与人', digits: 1, compute: (def, days) => perPerson(def, days, ALL, (s) => (s.chats === 0 ? 100 : 0)) },
  { key: 'ties.new', label: '新认识的人', unit: '对/天', group: '人与人', digits: 2, compute: (_def, days) => perDay(days, (d) => d.newTies) },
  { key: 'friends.new', label: '新交的朋友', unit: '对/天', group: '人与人', digits: 2, compute: (_def, days) => perDay(days, (d) => d.newFriends) },
  { key: 'visits.park', label: '去公园', unit: '人次/天', group: '人与人', digits: 1, compute: visitsOf('park') },
  { key: 'visits.square', label: '去广场', unit: '人次/天', group: '人与人', digits: 1, compute: visitsOf('square') },
  { key: 'visits.teahouse', label: '去茶馆', unit: '人次/天', group: '人与人', digits: 1, compute: visitsOf('teahouse') },
  { key: 'visits.center', label: '去活动中心', unit: '人次/天', group: '人与人', digits: 1, compute: visitsOf('center') },

  { key: 'spend', label: '个人花销', unit: '元/人/天', group: '钱', digits: 1, compute: (def, days) => perPerson(def, days, ALL, (s) => s.spent) },
  { key: 'hh.balance', label: '家庭账户的中位数', unit: '元', group: '钱', digits: 0, compute: (_def, days) => last(days, (d) => median(d.households), 0) },
  { key: 'hh.negative', label: '入不敷出的家庭', unit: '%', group: '钱', digits: 1, compute: (_def, days) => last(days, (d) => (100 * d.households.filter((x) => x < 0).length) / Math.max(1, d.households.length), 0) },
  { key: 'wallet.gini', label: '个人钱包的基尼系数', unit: '', group: '钱', digits: 3, compute: (def, days) => last(days, (d) => gini(d.wallets.filter((_, i) => def.people[i]!.age >= 18)), 0) },
  { key: 'jobless', label: '被裁的人', unit: '人', group: '钱', digits: 0, compute: (_def, days) => last(days, (d) => d.laidOff, 0) },

  { key: 'revenue.market', label: '菜市场的营业额', unit: '元/天', group: '店铺', digits: 0, compute: revenueOf('market') },
  { key: 'revenue.grocery', label: '小超市的营业额', unit: '元/天', group: '店铺', digits: 0, compute: revenueOf('grocery') },
  { key: 'revenue.eatery', label: '饭馆的营业额', unit: '元/天', group: '店铺', digits: 0, compute: revenueOf('eatery') },
  { key: 'revenue.teahouse', label: '茶馆的营业额', unit: '元/天', group: '店铺', digits: 0, compute: revenueOf('teahouse') },
  { key: 'revenue.center', label: '活动中心（食堂）的营业额', unit: '元/天', group: '店铺', digits: 0, compute: revenueOf('center') },
  { key: 'stockout', label: '白跑一趟（没买到、卖完了）', unit: '次/天', group: '店铺', digits: 2, compute: (_def, days) => perDay(days, (d) => d.stockouts) },

  { key: 'heard', label: '听说了传言的人', unit: '%', group: '消息', digits: 1, compute: (def, days) => last(days, (d) => (100 * Math.max(0, ...Object.values(d.heard))) / def.people.length, 0) },
];

export const INDICATORS: Record<string, Indicator> = Object.fromEntries(LIST.map((x) => [x.key, x]));
export const INDICATOR_LIST: readonly Indicator[] = LIST;
export const isIndicatorKey = (key: string): boolean => key in INDICATORS;
