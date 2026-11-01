/**
 * TownSpec：给人和 LLM 填的小镇规格（spec v1 §2.5，D23）。
 * 规则都在代码里：normalizeSpec 夹取值域、补齐必需设施、把每处调整写进 warnings。
 * 规格是纯数据（时间用 'D03 08:05' / '14:00' 字符串），方便对话与表单直接编辑。
 */
import { contentHash } from '../core/hash.ts';
import { parseTime, weekday } from '../core/time.ts';
import type { Advice, PublishChannel } from '../info/types.ts';
import type { OutageEventSpec } from './events.ts';
import type { RoleId, Traits } from './types.ts';

export interface CharacterSpec {
  name: string;
  age?: number;
  gender?: 'f' | 'm';
  role?: RoleId;
  district?: 'north' | 'south';
  bio?: string;
  traits?: Partial<Traits>;
  habits?: { push?: boolean; website?: boolean; phone?: 'low' | 'mid' | 'high' };
  /** 与另一位具名人物的亲属关系（对方也要在 characters 里，或在经典小镇里） */
  kin?: { name: string; relation: KinRelation };
}

export type KinRelation = '父女' | '父子' | '母女' | '母子' | '夫妻' | '兄妹' | '姐弟' | '朋友';

export interface EventInput {
  id?: string;
  area: 'north' | 'south';
  /** 停电在第几天（D02–D07） */
  day: number;
  from: string;
  to: string;
  notice: { at: string; channels: PublishChannel[]; headline: 'exact' | 'coarse' | 'none'; advice?: Advice[] } | null;
  clarify?: { at: string; channels: PublishChannel[] } | null;
  workOrder?: boolean;
  /** 虚惊：发了通知但没有停电（v3） */
  falseAlarm?: boolean;
}

export interface TownSpec {
  v: 1;
  name: string;
  base: 'classic' | 'generated';
  /** 生成用的种子（与运行 seed 分开） */
  seed: number;
  population: { size: number; seniors: number; youth: number; northShare: number };
  facilities: { cafe: number; restaurant: number; convenience: number; supermarket: number; studio: number; clinic: number; library: number; newsroom: number; parks: number };
  culture: { trustGov: number; anxiety: number; sociability: number; detail: number };
  media: { push: number; website: number; boards: number };
  network: { friends: number; crossDistrict: number; kin: number };
  characters: CharacterSpec[];
  events: EventInput[];
}

export const ROLE_IDS: RoleId[] = ['cafe_manager', 'barista', 'chef_owner', 'server', 'clerk', 'market_manager', 'cashier', 'studio_lead', 'designer', 'gov_clerk', 'gov_liaison', 'doctor', 'nurse', 'librarian', 'technician', 'reporter', 'wfh', 'student', 'retiree', 'caregiver', 'jobseeker'];

export const ROLE_LABEL: Record<RoleId, string> = {
  cafe_manager: '咖啡馆值班经理',
  barista: '咖啡师',
  chef_owner: '小馆主厨兼老板',
  server: '小馆服务员',
  clerk: '便利店店长',
  market_manager: '超市店长',
  cashier: '超市收银员',
  studio_lead: '设计工作室主管',
  designer: '设计师',
  gov_clerk: '政务中心办事员',
  gov_liaison: '社区联络员',
  doctor: '诊所医生',
  nurse: '诊所护士',
  librarian: '图书馆管理员',
  technician: '维护站技术员',
  reporter: '社区报记者',
  wfh: '在家接单的自由职业者',
  student: '成年学生',
  retiree: '退休',
  caregiver: '全职照顾家人',
  jobseeker: '求职中',
};

/** 每类设施的编制（岗位） */
export const STAFFING: Record<string, RoleId[]> = {
  cafe: ['cafe_manager', 'barista'],
  restaurant: ['chef_owner', 'server'],
  convenience: ['clerk'],
  supermarket: ['market_manager', 'cashier'],
  studio: ['studio_lead', 'designer', 'designer'],
  gov: ['gov_clerk', 'gov_liaison'],
  clinic: ['doctor', 'nurse'],
  library: ['librarian'],
  utility: ['technician', 'technician'],
  newsroom: ['reporter'],
};

export const FACILITY_LABEL: Record<keyof TownSpec['facilities'], string> = {
  cafe: '咖啡馆',
  restaurant: '小馆',
  convenience: '便利店',
  supermarket: '超市',
  studio: '设计工作室',
  clinic: '诊所',
  library: '图书馆',
  newsroom: '社区报',
  parks: '公园/广场',
};

export const LIMITS = {
  size: [12, 60],
  share: [0, 0.6],
  northShare: [0.2, 0.8],
  facility: [0, 3],
  parks: [1, 3],
  trait: [0.05, 0.95],
  media: [0, 1],
  boards: [0, 3],
  friends: [0, 6],
  events: [1, 3],
  characters: 12,
} as const;

/** 默认的经典规格：与 v0 town30 完全一致（修饰全部为“不变”） */
export const CLASSIC_BASELINE = {
  culture: { trustGov: 0.6, anxiety: 0.4, sociability: 0.62, detail: 0.6 },
  media: { push: 0.3, website: 0.27, boards: 2 },
  network: { friends: 1.53, crossDistrict: 0.3, kin: 0.1 },
} as const;

export const CLASSIC_EVENT_INPUT: EventInput = {
  id: 'E1',
  area: 'north',
  day: 4,
  from: '14:00',
  to: '16:00',
  notice: { at: 'D03 08:05', channels: ['website', 'push', 'board'], headline: 'coarse', advice: ['charge_devices', 'plan_elsewhere'] },
  clarify: null,
  workOrder: true,
};

export function classicSpec(): TownSpec {
  return {
    v: 1,
    name: '河岸小镇',
    base: 'classic',
    seed: 1,
    population: { size: 30, seniors: 0.13, youth: 0.3, northShare: 0.67 },
    facilities: { cafe: 1, restaurant: 1, convenience: 1, supermarket: 1, studio: 1, clinic: 1, library: 1, newsroom: 1, parks: 3 },
    culture: { ...CLASSIC_BASELINE.culture },
    media: { ...CLASSIC_BASELINE.media },
    network: { ...CLASSIC_BASELINE.network },
    characters: [],
    events: [structuredClone(CLASSIC_EVENT_INPUT)],
  };
}

export function generatedDefaults(): TownSpec {
  return {
    v: 1,
    name: '新镇',
    base: 'generated',
    seed: 7,
    population: { size: 30, seniors: 0.2, youth: 0.25, northShare: 0.55 },
    facilities: { cafe: 1, restaurant: 1, convenience: 1, supermarket: 1, studio: 1, clinic: 1, library: 1, newsroom: 1, parks: 2 },
    culture: { trustGov: 0.6, anxiety: 0.45, sociability: 0.6, detail: 0.58 },
    media: { push: 0.3, website: 0.25, boards: 2 },
    network: { friends: 2.5, crossDistrict: 0.3, kin: 0.4 },
    characters: [],
    events: [structuredClone(CLASSIC_EVENT_INPUT)],
  };
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const clampN = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const r2 = (x: number): number => Math.round(x * 100) / 100;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

const CHANNELS: PublishChannel[] = ['website', 'push', 'board'];
const ADVICES: Advice[] = ['charge_devices', 'plan_elsewhere', 'store_food'];
const KIN: KinRelation[] = ['父女', '父子', '母女', '母子', '夫妻', '兄妹', '姐弟', '朋友'];
const TRAIT_KEYS: Array<keyof Traits> = ['anxiety', 'riskAversion', 'sociability', 'order', 'curiosity', 'altruism', 'commitment', 'trustOfficial', 'detail'];

const pad = (n: number) => String(n).padStart(2, '0');

function hhmmToSec(s: unknown): number | undefined {
  const m = typeof s === 'string' ? /^(\d{1,2})[:：](\d{2})$/.exec(s.trim()) : null;
  if (!m) return undefined;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return undefined;
  return h * 3600 + mi * 60;
}
const secToHHMM = (s: number): string => `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}`;
function parseSim(s: unknown): number | undefined {
  if (typeof s !== 'string') return undefined;
  try {
    return parseTime(s.replace('：', ':'));
  } catch {
    return undefined;
  }
}
const fmtSim = (t: number): string => `D${pad(Math.floor(t / 86400) + 1)} ${secToHHMM(t % 86400)}`;

/**
 * 规范化：任何输入（含 LLM 的半成品）都变成一个合法规格；每处修改写进 warnings（中文，给人看）。
 * 未给出的字段取 base 对应的默认值。
 */
export function normalizeSpec(input: unknown, prev?: TownSpec): { spec: TownSpec; warnings: string[] } {
  const w: string[] = [];
  const x = obj(input);
  const base: TownSpec['base'] = x.base === 'classic' || x.base === 'generated' ? x.base : (prev?.base ?? 'generated');
  const d = prev && prev.base === base ? prev : base === 'classic' ? classicSpec() : generatedDefaults();
  const name = typeof x.name === 'string' && x.name.trim() ? x.name.trim().slice(0, 16) : d.name;
  const seed = Math.trunc(clampN(num(x.seed, d.seed), 0, 1_000_000));

  const fit = (label: string, v: number, lo: number, hi: number, digits = 2): number => {
    const c = clampN(v, lo, hi);
    if (Math.abs(c - v) > 1e-9) w.push(`${label} ${Math.round(v * 100) / 100} 超出范围，已改为 ${Math.round(c * 100) / 100}`);
    return digits === 0 ? Math.round(c) : r2(c);
  };

  const pi = obj(x.population);
  let seniors = fit('老人比例', num(pi.seniors, d.population.seniors), LIMITS.share[0], LIMITS.share[1]);
  let youth = fit('年轻人比例', num(pi.youth, d.population.youth), LIMITS.share[0], LIMITS.share[1]);
  if (seniors + youth > 0.85) {
    const k = 0.85 / (seniors + youth);
    seniors = r2(seniors * k);
    youth = r2(youth * k);
    w.push(`老人与年轻人合计超过 85%，已按比例缩到 ${Math.round(seniors * 100)}% / ${Math.round(youth * 100)}%（得留些中年人撑起岗位）`);
  }
  const population = {
    size: fit('人口', num(pi.size, d.population.size), LIMITS.size[0], LIMITS.size[1], 0),
    seniors,
    youth,
    northShare: fit('北区人口比例', num(pi.northShare, d.population.northShare), LIMITS.northShare[0], LIMITS.northShare[1]),
  };

  const fi = obj(x.facilities);
  const facilities = { ...d.facilities };
  for (const k of Object.keys(facilities) as Array<keyof TownSpec['facilities']>) {
    const [lo, hi] = k === 'parks' ? LIMITS.parks : k === 'newsroom' ? [0, 1] : k === 'supermarket' || k === 'studio' || k === 'clinic' || k === 'library' ? [0, 2] : LIMITS.facility;
    facilities[k] = fit(FACILITY_LABEL[k], num(fi[k], d.facilities[k]), lo, hi, 0);
  }
  if (facilities.supermarket + facilities.convenience === 0) {
    facilities.supermarket = 1;
    w.push('小镇至少要有一家超市或便利店（买菜、买充电宝），已补一家超市');
  }

  const ci = obj(x.culture);
  const culture = {
    trustGov: fit('对官方的信任', num(ci.trustGov, d.culture.trustGov), LIMITS.trait[0], LIMITS.trait[1]),
    anxiety: fit('焦虑程度', num(ci.anxiety, d.culture.anxiety), LIMITS.trait[0], LIMITS.trait[1]),
    sociability: fit('社交活跃', num(ci.sociability, d.culture.sociability), LIMITS.trait[0], LIMITS.trait[1]),
    detail: fit('记细节', num(ci.detail, d.culture.detail), LIMITS.trait[0], LIMITS.trait[1]),
  };
  const mi = obj(x.media);
  const media = {
    push: fit('订阅推送比例', num(mi.push, d.media.push), LIMITS.media[0], LIMITS.media[1]),
    website: fit('常看镇网站比例', num(mi.website, d.media.website), LIMITS.media[0], LIMITS.media[1]),
    boards: fit('公告栏个数', num(mi.boards, d.media.boards), LIMITS.boards[0], LIMITS.boards[1], 0),
  };
  const ni = obj(x.network);
  const network = {
    friends: fit('人均朋友数', num(ni.friends, d.network.friends), LIMITS.friends[0], LIMITS.friends[1]),
    crossDistrict: fit('跨区朋友比例', num(ni.crossDistrict, d.network.crossDistrict), 0, 1),
    kin: fit('跨户亲属比例', num(ni.kin, d.network.kin), 0, 1),
  };

  // 具名人物
  const characters: CharacterSpec[] = [];
  const rawChars = Array.isArray(x.characters) ? x.characters : d.characters;
  for (const rc of rawChars.slice(0, LIMITS.characters)) {
    const c = obj(rc);
    const cname = typeof c.name === 'string' ? c.name.trim().slice(0, 6) : '';
    if (!cname) continue;
    if (characters.some((y) => y.name === cname)) {
      w.push(`人物“${cname}”重复，只保留一个`);
      continue;
    }
    const out: CharacterSpec = { name: cname };
    if (c.age !== undefined) out.age = Math.round(clampN(num(c.age, 35), 18, 88));
    if (c.gender === 'f' || c.gender === 'm') out.gender = c.gender;
    if (typeof c.role === 'string') {
      if ((ROLE_IDS as string[]).includes(c.role)) out.role = c.role as RoleId;
      else w.push(`人物“${cname}”的身份 ${c.role} 不在模板里，改由生成器分配`);
    }
    if (c.district === 'north' || c.district === 'south') out.district = c.district;
    if (typeof c.bio === 'string' && c.bio.trim()) out.bio = c.bio.trim().slice(0, 60);
    const t = obj(c.traits);
    const traits: Partial<Traits> = {};
    for (const k of TRAIT_KEYS) if (t[k] !== undefined) traits[k] = r2(clampN(num(t[k], 0.5), LIMITS.trait[0], LIMITS.trait[1]));
    if (Object.keys(traits).length) out.traits = traits;
    const h = obj(c.habits);
    const habits: NonNullable<CharacterSpec['habits']> = {};
    if (typeof h.push === 'boolean') habits.push = h.push;
    if (typeof h.website === 'boolean') habits.website = h.website;
    if (h.phone === 'low' || h.phone === 'mid' || h.phone === 'high') habits.phone = h.phone;
    if (Object.keys(habits).length) out.habits = habits;
    const k = obj(c.kin);
    if (typeof k.name === 'string' && k.name.trim() && (KIN as string[]).includes(String(k.relation))) out.kin = { name: k.name.trim().slice(0, 6), relation: k.relation as KinRelation };
    characters.push(out);
  }
  if (Array.isArray(x.characters) && x.characters.length > LIMITS.characters) w.push(`具名人物最多 ${LIMITS.characters} 个，其余忽略`);
  if (base === 'generated' && characters.length > population.size) w.push('具名人物多于人口，多出的会被忽略');

  // 事件剧本
  const rawEvents = Array.isArray(x.events) ? x.events : d.events;
  const events: EventInput[] = [];
  for (const re of rawEvents.slice(0, LIMITS.events[1])) {
    const e = obj(re);
    const i = events.length + 1;
    const area = e.area === 'south' ? 'south' : e.area === 'north' ? 'north' : ((w.push(`第 ${i} 轮事件区域不明，按北区处理`), 'north') as 'north');
    let day = Math.round(num(e.day, 4));
    if (day < 2 || day > 7) {
      const nd = Math.min(7, Math.max(2, day));
      w.push(`第 ${i} 轮停电日 D${pad(day)} 超出 D02–D07，已改为 D${pad(nd)}`);
      day = nd;
    }
    let from = hhmmToSec(e.from) ?? 14 * 3600;
    let to = hhmmToSec(e.to) ?? from + 2 * 3600;
    if (from < 6 * 3600 || to > 22 * 3600 || to - from < 30 * 60) {
      const nf = Math.min(Math.max(from, 6 * 3600), 20 * 3600);
      const nt = Math.min(Math.max(to, nf + 30 * 60), 22 * 3600);
      w.push(`第 ${i} 轮停电时段 ${secToHHMM(from)}–${secToHHMM(to)} 不合理，已改为 ${secToHHMM(nf)}–${secToHHMM(nt)}`);
      from = nf;
      to = nt;
    }
    const start = (day - 1) * 86400 + from;
    let notice: EventInput['notice'] = null;
    const n = e.notice === null ? null : obj(e.notice);
    if (n && Object.keys(n).length > 0) {
      let at = parseSim(n.at) ?? start - 30 * 3600;
      if (at >= start || at < 7 * 3600) {
        const nat = Math.max(7 * 3600, Math.min(start - 3600, (day - 2) * 86400 + 9 * 3600));
        w.push(`第 ${i} 轮通知时间 ${typeof n.at === 'string' ? n.at : '缺失'} 不在停电之前，已改为 ${fmtSim(nat)}`);
        at = nat;
      }
      const channels = (Array.isArray(n.channels) ? n.channels : ['website']).filter((c): c is PublishChannel => (CHANNELS as unknown[]).includes(c));
      if (channels.length === 0) {
        channels.push('website');
        w.push(`第 ${i} 轮通知没有有效渠道，已设为镇网站`);
      }
      const headline = n.headline === 'exact' || n.headline === 'none' || n.headline === 'coarse' ? n.headline : 'coarse';
      const advice = (Array.isArray(n.advice) ? n.advice : ['charge_devices']).filter((a): a is Advice => (ADVICES as unknown[]).includes(a));
      notice = { at: fmtSim(at), channels: [...new Set(channels)], headline, advice: [...new Set(advice)] };
    }
    let clarify: EventInput['clarify'] = null;
    const c = e.clarify === null || e.clarify === undefined ? null : obj(e.clarify);
    if (c && Object.keys(c).length > 0) {
      let at = parseSim(c.at);
      const noticeAt = notice ? parseSim(notice.at)! : undefined;
      if (at === undefined || at >= start || (noticeAt !== undefined && at <= noticeAt)) {
        const nat = noticeAt !== undefined ? Math.min(start - 1800, noticeAt + 8 * 3600) : start - 6 * 3600;
        w.push(`第 ${i} 轮澄清时间不合理，已改为 ${fmtSim(nat)}`);
        at = nat;
      }
      const channels = (Array.isArray(c.channels) ? c.channels : ['website', 'push']).filter((ch): ch is PublishChannel => (CHANNELS as unknown[]).includes(ch));
      clarify = { at: fmtSim(at), channels: channels.length ? [...new Set(channels)] : ['website'] };
    }
    events.push({ id: `E${i}`, area, day, from: secToHHMM(from), to: secToHHMM(to), notice, clarify, workOrder: e.workOrder === undefined ? true : !!e.workOrder, ...(e.falseAlarm === true ? { falseAlarm: true } : {}) });
  }
  if (events.length === 0) {
    events.push(structuredClone(CLASSIC_EVENT_INPUT));
    w.push('剧本至少要有一轮停电，已放入默认的一轮（北区 D04 14:00–16:00）');
  }
  // 同区同日的停电只能有一轮
  const seen = new Set<string>();
  for (let i = events.length - 1; i >= 0; i--) {
    const k = `${events[i]!.area}${events[i]!.day}`;
    if (seen.has(k)) {
      w.push(`第 ${i + 1} 轮与另一轮同区同日，已删除`);
      events.splice(i, 1);
    } else seen.add(k);
  }
  events.sort((a, b) => a.day - b.day || (hhmmToSec(a.from) ?? 0) - (hhmmToSec(b.from) ?? 0));
  events.forEach((e, i) => (e.id = `E${i + 1}`));

  const spec: TownSpec = { v: 1, name, base, seed, population, facilities, culture, media, network, characters, events };
  if (base === 'generated') {
    trimFacilities(spec, w);
    // 公告栏立在公园/广场上：开放空间有几处，最多就几块
    if (spec.media.boards > spec.facilities.parks) {
      w.push(`公告栏要立在公园或广场上，这座镇只有 ${spec.facilities.parks} 处，公告栏改为 ${spec.facilities.parks} 块`);
      spec.media.boards = spec.facilities.parks;
    }
  }
  return { spec, warnings: w };
}

/** 岗位数不能超过劳动年龄人口：按从“可有可无”到“必需”的顺序削减设施 */
function trimFacilities(spec: TownSpec, w: string[]): void {
  const workers = Math.floor(spec.population.size * (1 - spec.population.seniors) * 0.92);
  const jobs = () => {
    let n = STAFFING.gov!.length + STAFFING.utility!.length;
    for (const [k, c] of Object.entries(spec.facilities)) if (k !== 'parks') n += (STAFFING[k]?.length ?? 0) * c;
    return n;
  };
  const order: Array<keyof TownSpec['facilities']> = ['studio', 'restaurant', 'cafe', 'clinic', 'newsroom', 'library', 'supermarket', 'convenience', 'studio', 'cafe', 'restaurant', 'clinic', 'library', 'supermarket', 'convenience'];
  let i = 0;
  const cut: string[] = [];
  while (jobs() > workers && i < order.length * 3) {
    const k = order[i % order.length]!;
    // 至少留一家店：超市与便利店不能同时砍光
    const min = (k === 'supermarket' && spec.facilities.convenience === 0) || (k === 'convenience' && spec.facilities.supermarket === 0) ? 1 : 0;
    if (spec.facilities[k] > min) {
      spec.facilities[k] -= 1;
      cut.push(FACILITY_LABEL[k]);
    }
    i++;
  }
  if (cut.length) w.push(`${spec.population.size} 人撑不起这么多岗位（劳动年龄约 ${workers} 人），已减少：${cut.join('、')}`);
  // 连政务中心、维护站和一家店都撑不起：少放些老人
  const need = jobs();
  if (need > workers) {
    const seniors = Math.max(0, Math.floor((1 - need / 0.92 / spec.population.size) * 100) / 100);
    w.push(`老人比例 ${Math.round(spec.population.seniors * 100)}% 太高，镇上最基本的 ${need} 个岗位都没人做，已降到 ${Math.round(seniors * 100)}%`);
    spec.population.seniors = seniors;
  }
}

/** 规格的内容哈希（登记场景用） */
export const specHash = (spec: TownSpec): string => contentHash(spec).slice(0, 10);

/** 事件输入 → 内核的事件规格（经典小镇的第一轮沿用 v0 的族与新闻 id） */
export function toOutageEvents(events: EventInput[], classic: boolean): OutageEventSpec[] {
  return events.map((e, i) => {
    const out: OutageEventSpec = {
      id: e.id ?? `E${i + 1}`,
      area: e.area,
      day: e.day,
      from: hhmmToSec(e.from)!,
      to: hhmmToSec(e.to)!,
      notice: e.notice ? { at: parseTime(e.notice.at), channels: [...e.notice.channels], headline: e.notice.headline, advice: [...(e.notice.advice ?? [])] } : null,
      clarify: e.clarify ? { at: parseTime(e.clarify.at), channels: [...e.clarify.channels] } : null,
      workOrder: e.workOrder ?? true,
      ...(e.falseAlarm ? { mode: 'false_alarm' as const } : {}),
    };
    if (classic && i === 0) {
      out.family = 'F_OUTAGE';
      out.ids = { notice: 'N001', clarify: 'N002', workOrder: 'WO01' };
    }
    return out;
  });
}

/** 一轮事件的中文描述（预览与对话提示用） */
export function describeEventInput(e: EventInput): string {
  const area = e.area === 'north' ? '北区' : '南区';
  const n = e.notice ? `${e.notice.at} 发通知（${e.notice.channels.map((c) => ({ website: '网站', push: '推送', board: '公告栏' })[c]).join('+')}；标题${e.notice.headline === 'exact' ? '写精确时间' : e.notice.headline === 'coarse' ? '只写“上午/下午”' : '不写时间'}）` : '不发通知';
  const c = e.clarify ? `；${e.clarify.at} 澄清` : '';
  return `${area} D${pad(e.day)} ${weekday(e.day)} ${e.from}–${e.to} ${e.falseAlarm ? '虚惊（通知了但没停电）' : '停电'}；${n}${c}`;
}
