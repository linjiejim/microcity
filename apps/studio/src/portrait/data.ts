import { BUCKETS, gini, householdAccount, median, OCC_SLOTS, type Bucket, type CommunityDef, type DayAgg, type HouseholdType, type PersonDef, type TieKind } from '@microcity/society';
import { REF_CATEGORIES, TIME_USE_2018, type RefCategory } from './reference.ts';

/** 画像的数据（D86）：全部由社区定义与每日统计算出，纯函数，界面只管画 */

export interface Group {
  key: string;
  label: string;
  idx: number[];
}

export function groups(def: CommunityDef): Group[] {
  const pick = (label: string, key: string, f: (p: PersonDef) => boolean): Group => ({ key, label, idx: def.people.map((p, i) => (f(p) ? i : -1)).filter((i) => i >= 0) });
  return [
    pick('所有人', 'all', () => true),
    pick('小学生', 'child', (p) => p.stage === 'child'),
    pick('中学生', 'student', (p) => p.stage === 'student'),
    pick('上班的人', 'worker', (p) => !!p.job),
    pick('持家', 'homemaker', (p) => p.stage === 'homemaker'),
    pick('退休', 'retired', (p) => p.stage === 'retired' && !p.job),
  ].filter((g) => g.idx.length > 0);
}

export interface GroupStats {
  /** 每个分桶的小时/天，顺序同 BUCKETS */
  hours: number[];
  spent: number;
  earned: number;
  chats: number;
  mood: number;
}

export function groupStats(aggs: DayAgg[], idx: number[]): GroupStats {
  const hours = BUCKETS.map(() => 0);
  let spent = 0;
  let earned = 0;
  let chats = 0;
  let mood = 0;
  const n = Math.max(1, aggs.length * idx.length);
  for (const d of aggs)
    for (const i of idx) {
      const s = d.people[i]!;
      for (let k = 0; k < hours.length; k++) hours[k]! += s.use[k]! / 3600;
      spent += s.spent;
      earned += s.earned;
      chats += s.chats;
      mood += s.mood;
    }
  return { hours: hours.map((h) => h / n), spent: spent / n, earned: earned / n, chats: chats / n, mood: mood / n };
}

export interface Band {
  label: string;
  m: number;
  f: number;
}

export function pyramid(def: CommunityDef): Band[] {
  const bands: Band[] = ['0–9', '10–19', '20–29', '30–39', '40–49', '50–59', '60–69', '70–79', '80+'].map((label) => ({ label, m: 0, f: 0 }));
  for (const p of def.people) bands[Math.min(8, Math.floor(p.age / 10))]![p.gender]++;
  return bands;
}

export const HOUSEHOLD_LABEL: Record<HouseholdType, string> = { elder_couple: '老两口', elder_single: '独居老人', three_gen: '三代同堂', nuclear: '一家三四口', couple: '小两口', single: '一个人住', single_parent: '单亲', sharers: '合租' };

export function householdMix(def: CommunityDef): Array<{ label: string; n: number }> {
  const count = new Map<HouseholdType, number>();
  for (const h of def.households) count.set(h.type, (count.get(h.type) ?? 0) + 1);
  return [...count].map(([t, n]) => ({ label: HOUSEHOLD_LABEL[t], n })).sort((a, b) => b.n - a.n);
}

export interface Headline {
  people: number;
  households: number;
  avgAge: number;
  elders: number;
  children: number;
  localJobs: number;
  cityJobs: number;
  renters: number;
}

export function headline(def: CommunityDef): Headline {
  const n = def.people.length;
  return {
    people: n,
    households: def.households.length,
    avgAge: def.people.reduce((a, p) => a + p.age, 0) / n,
    elders: def.people.filter((p) => p.age >= 60).length,
    children: def.people.filter((p) => p.age < 18).length,
    localJobs: def.people.filter((p) => p.job && p.job.firm !== 'city').length,
    cityJobs: def.people.filter((p) => p.job?.firm === 'city').length,
    renters: def.households.filter((h) => h.rentWeekly > 0).length,
  };
}

export const TIE_LABEL: Record<TieKind, string> = { family: '家人', partner: '伴侣', friend: '朋友', coworker: '同事', classmate: '同学', neighbor: '邻居', acquaintance: '熟人' };

const SECTOR_LABEL: Record<string, string> = { person: '个人', household: '家庭', ext: '社区外' };
const FIRM_LABEL: Record<string, string> = { market: '菜市场', grocery: '小超市', eatery: '饭馆', teahouse: '茶馆', center: '活动中心', clinic: '卫生站', school: '学校', office: '办公楼', workshop: '车间' };
const KIND_LABEL: Record<string, string> = { wage: '工资', pension: '养老金与补助', family: '交给家里', allowance: '零花钱', rent: '房租', utilities: '水电', purchase: '买东西', restock: '进货', grant: '拨款与补贴', profit: '利润', lunch: '在外的午饭' };
const sectorName = (s: string): string => (s.startsWith('firm:') ? (FIRM_LABEL[s.slice(5)] ?? s.slice(5)) : (SECTOR_LABEL[s] ?? s));

export interface Flow {
  from: string;
  to: string;
  kind: string;
  /** 元/天 */
  perDay: number;
}

/** 钱从哪来到哪去：这些天的日均流量，从大到小 */
export function flows(aggs: DayAgg[], top = 12): Flow[] {
  const sum = new Map<string, number>();
  for (const d of aggs) for (const k in d.flows) sum.set(k, (sum.get(k) ?? 0) + d.flows[k]!);
  return [...sum]
    .map(([key, v]) => {
      // 键是 `付方>收方:种类`；付方收方里可能有冒号（firm:market），种类取最后一段
      const cut = key.lastIndexOf(':');
      const kind = key.slice(cut + 1);
      const [from, to] = key.slice(0, cut).split('>');
      return { from: sectorName(from!), to: sectorName(to!), kind: KIND_LABEL[kind] ?? kind, perDay: v / Math.max(1, aggs.length) };
    })
    .sort((a, b) => b.perDay - a.perDay)
    .slice(0, top);
}

const SLOT_LABEL: Record<string, string> = { house: '院子里', apartment: '楼里', market: '菜市场', grocery: '小超市', eatery: '饭馆', teahouse: '茶馆', center: '活动中心', clinic: '卫生站', school: '学校', office: '办公楼', workshop: '车间', park: '公园', square: '广场', court: '球场', busstop: '公交站', street: '在路上', away: '去城里了' };

export interface Heat {
  rows: Array<{ label: string; byHour: number[] }>;
  max: number;
}

/** 一天里各处有多少人：这些天各整点的平均；“在家”合成一行 */
export function heat(aggs: DayAgg[]): Heat {
  const n = Math.max(1, aggs.length);
  const raw = OCC_SLOTS.map((slot, k) => ({ slot, byHour: Array.from({ length: 24 }, (_, h) => aggs.reduce((a, d) => a + (d.occupancy[h]?.[k] ?? 0), 0) / n) }));
  const home = { label: '在家', byHour: Array.from({ length: 24 }, (_, h) => raw[0]!.byHour[h]! + raw[1]!.byHour[h]!) };
  const rest = raw.slice(2).filter((r) => r.byHour.some((v) => v >= 0.5)).map((r) => ({ label: SLOT_LABEL[r.slot] ?? r.slot, byHour: r.byHour }));
  const rows = [home, ...rest];
  return { rows, max: Math.max(1, ...rest.flatMap((r) => r.byHour)) };
}

export interface CalRow {
  category: RefCategory;
  model: number;
  reference: number;
}

const CATEGORY_OF: Record<Bucket, RefCategory> = { sleep: '生理必需', meal: '生理必需', other: '生理必需', work: '有酬劳动', chores: '无酬劳动', leisure: '自由支配', study: '学习培训', travel: '交通' };

/** 校准：15 岁以上居民的时间利用（分钟/天），与参照并排 */
export function calibration(def: CommunityDef, aggs: DayAgg[]): CalRow[] {
  const idx = def.people.map((p, i) => (p.age >= 15 ? i : -1)).filter((i) => i >= 0);
  const g = groupStats(aggs, idx);
  const model = Object.fromEntries(REF_CATEGORIES.map((c) => [c, 0])) as Record<RefCategory, number>;
  BUCKETS.forEach((b, k) => (model[CATEGORY_OF[b]] += g.hours[k]! * 60));
  return REF_CATEGORIES.map((category) => ({ category, model: model[category], reference: TIME_USE_2018.minutes[category] }));
}

export interface Money {
  gini: number;
  walletMedian: number;
  householdMedian: number;
  negative: number;
  /** 成年人钱包的分布：每一档的人数 */
  hist: Array<{ label: string; n: number }>;
  /** 每天家庭账户的中位数 */
  trend: number[];
}

export function money(def: CommunityDef, aggs: DayAgg[]): Money {
  const last = aggs[aggs.length - 1];
  const adults = last ? last.wallets.filter((_, i) => def.people[i]!.age >= 18) : [];
  const edges = [0, 500, 1000, 2000, 3000, 5000, 8000, Infinity];
  const hist = edges.slice(0, -1).map((lo, k) => ({ label: edges[k + 1] === Infinity ? `${lo}+` : `${lo}–${edges[k + 1]}`, n: adults.filter((w) => w >= lo && w < edges[k + 1]!).length }));
  return { gini: gini(adults), walletMedian: median(adults), householdMedian: last ? median(last.households) : 0, negative: last ? last.households.filter((x) => x < 0).length : 0, hist, trend: aggs.map((d) => median(d.households)) };
}

export interface Social {
  ties: Array<{ label: string; n: number }>;
  /** 每天：聊天次数、新认识、新朋友、一整天没聊过天的人的比例 */
  chats: number[];
  newTies: number[];
  alone: number[];
}

export function social(aggs: DayAgg[]): Social {
  const last = aggs[aggs.length - 1];
  const ties = last ? (Object.entries(last.ties) as Array<[TieKind, number]>).map(([k, n]) => ({ label: TIE_LABEL[k], n })).sort((a, b) => b.n - a.n) : [];
  return { ties, chats: aggs.map((d) => d.chats), newTies: aggs.map((d) => d.newTies + d.newFriends), alone: aggs.map((d) => (100 * d.people.filter((s) => s.chats === 0).length) / Math.max(1, d.people.length)) };
}

const yuan = (x: number): string => `${Math.round(x)} 元`;
const WEATHER: Record<string, string> = { sun: '晴', cloud: '阴', rain: '有雨' };

/** 社区日报：某一天里值得说的事，全部来自统计，不用模型 */
export function paper(def: CommunityDef, agg: DayAgg): Array<{ title: string; text: string }> {
  const out: Array<{ title: string; text: string }> = [];
  const name = (i: number) => def.people[i]!.name;
  out.push({ title: '天气', text: `今天${WEATHER[agg.weather]}。` });
  for (const m of agg.marks) out.push({ title: '大事', text: `${m}。` });
  const visits = (Object.entries(agg.visits) as Array<[string, number]>).filter(([k]) => k !== 'house' && k !== 'apartment').sort((a, b) => b[1] - a[1]);
  if (visits.length) out.push({ title: '最热闹的地方', text: visits.slice(0, 3).map(([k, n]) => `${SLOT_LABEL[k] ?? k} ${n} 人次`).join('，') + '。' });
  const top = (f: (s: DayAgg['people'][number]) => number) => agg.people.map((s, i) => ({ i, v: f(s) })).sort((a, b) => b.v - a.v)[0]!;
  const talker = top((s) => s.chats);
  out.push({ title: '人来人往', text: `全社区聊了 ${agg.chats} 次天${talker.v > 0 ? `，${name(talker.i)}聊得最多（${talker.v} 次）` : ''}。${agg.newTies ? `有 ${agg.newTies} 对人今天算是认识了。` : ''}${agg.newFriends ? `${agg.newFriends} 对成了朋友。` : ''}` });
  const alone = agg.people.filter((s) => s.chats === 0).length;
  if (alone) out.push({ title: '没说上话的人', text: `有 ${alone} 个人今天一整天没和谁聊过。` });
  const spender = top((s) => s.spent);
  const revenue = Object.entries(agg.revenue).sort((a, b) => b[1] - a[1])[0];
  const firm = revenue ? def.firms.find((f) => f.id === revenue[0]) : undefined;
  out.push({ title: '买卖', text: `${firm ? `${firm.name}今天卖了 ${yuan(revenue![1])}，是最多的一家。` : '今天没有哪家店开张。'}${spender.v > 0 ? `${name(spender.i)}花得最多（${yuan(spender.v)}）。` : ''}` });
  if (agg.stockouts) out.push({ title: '白跑一趟', text: `有 ${agg.stockouts} 次去了没买到。` });
  const moods = agg.people.map((s, i) => ({ i, v: s.mood })).sort((a, b) => a.v - b.v);
  out.push({ title: '心情', text: `今天过得最舒心的是${name(moods[moods.length - 1]!.i)}，最不顺的是${name(moods[0]!.i)}。` });
  const heard = Object.values(agg.heard)[0];
  if (heard) out.push({ title: '传言', text: `已经有 ${heard} 个人听说了那条传言。` });
  if (agg.laidOff) out.push({ title: '饭碗', text: `眼下有 ${agg.laidOff} 个人被裁、还没有新的工作。` });
  return out;
}

export interface PersonSeries {
  mood: number[];
  spent: number[];
  earned: number[];
  chats: number[];
  wallet: number[];
  /** 这些天平均的时间利用（小时/天），顺序同 BUCKETS */
  hours: number[];
}

export function personSeries(aggs: DayAgg[], i: number): PersonSeries {
  const g = groupStats(aggs, [i]);
  return { mood: aggs.map((d) => d.people[i]!.mood), spent: aggs.map((d) => d.people[i]!.spent), earned: aggs.map((d) => d.people[i]!.earned), chats: aggs.map((d) => d.people[i]!.chats), wallet: aggs.map((d) => d.wallets[i]!), hours: g.hours };
}

export const householdBalance = (def: CommunityDef, agg: DayAgg, householdId: string): number => agg.households[def.households.findIndex((h) => h.id === householdId)] ?? 0;
export { householdAccount };
