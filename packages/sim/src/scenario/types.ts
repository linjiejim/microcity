import type { SimTime } from '../core/time.ts';
import type { PlaceDef, Prop, TileKind } from '../world/map.ts';
import type { Channel, NewsDraft } from '../info/types.ts';
import type { OutageEventSpec, OutageTruth } from './events.ts';

/** 特质：0–1 连续权重，是模型参数，不宣称完整刻画人格 */
export interface Traits {
  anxiety: number;
  riskAversion: number;
  sociability: number;
  order: number;
  curiosity: number;
  altruism: number;
  commitment: number;
  trustOfficial: number;
  detail: number;
}

export type WebsiteSlot = 'wake' | 'lunch' | 'evening';

export interface Habits {
  /** 什么时候看镇网站 */
  website: WebsiteSlot[];
  /** 是否订阅政务推送 */
  push: boolean;
  /** 看手机频率 */
  phone: 'low' | 'mid' | 'high';
  /** 阅读深度 0–1 */
  readDepth: number;
  /** 醒着时每小时掉电百分比 */
  drain: number;
  /** 午饭习惯 */
  lunch: 'cafe' | 'restaurant' | 'home' | 'bring' | 'workplace';
  /** 偏好的休闲地点 */
  leisure: string[];
}

export type RoleId =
  | 'cafe_manager'
  | 'barista'
  | 'chef_owner'
  | 'server'
  | 'clerk'
  | 'market_manager'
  | 'cashier'
  | 'studio_lead'
  | 'designer'
  | 'gov_clerk'
  | 'gov_liaison'
  | 'doctor'
  | 'nurse'
  | 'librarian'
  | 'technician'
  | 'reporter'
  | 'wfh'
  | 'student'
  | 'retiree'
  | 'caregiver'
  | 'jobseeker';

export interface Look {
  skin: string;
  hair: string;
  hairStyle: 'short' | 'long' | 'bun' | 'bob' | 'curly' | 'cap' | 'ponytail';
  shirt: string;
  pants: string;
  accessory?: 'glasses' | 'apron' | 'scarf';
}

export interface PersonDef {
  id: string;
  name: string;
  age: number;
  gender: 'f' | 'm';
  household: string;
  role: RoleId;
  roleLabel: string;
  org?: string;
  workplace?: string;
  bio: string;
  speech: string;
  traits: Traits;
  habits: Habits;
  look: Look;
  /** 初始现金（元） */
  wallet: number;
}

export interface HouseholdDef {
  id: string;
  label: string;
  place: string;
  unit: number;
  members: string[];
  /** 家庭食物储备（份） */
  food: number;
}

export interface OrgDef {
  id: string;
  name: string;
  place: string;
  manager?: string;
  staff: string[];
  /** 初始资金（元） */
  capital: number;
  /** 每日外部流入（元）：镇预算/外部客户/外来顾客 */
  externalDaily: number;
  externalSource: string;
  /** 每人日薪（元） */
  wages: Record<string, number>;
}

export interface RelationDef {
  a: string;
  b: string;
  kind: 'family' | 'friend' | 'coworker' | 'neighbor';
  strength: number;
  trust: number;
  note?: string;
}

export interface ItemDef {
  id: string;
  name: string;
}

export interface OfferDef {
  place: string;
  item: string;
  /** 价格（元） */
  price: number;
  /** 期初库存 */
  stock: number;
  /** 每日补货到的目标量 */
  restockTo: number;
}

/** 场景脚本：世界事件与组织按计划的动作（不是管理员干预） */
export type ScriptEvent =
  | { at: SimTime; kind: 'publish'; news: NewsDraft; channels: Channel[]; note: string }
  | { at: SimTime; kind: 'org_notice'; org: string; news: NewsDraft; note: string }
  | { at: SimTime; kind: 'power'; area: 'north' | 'south'; on: boolean; note: string; outage?: string }
  /** 虚惊：到原定恢复供电的时刻，大家看见电一直没断 */
  | { at: SimTime; kind: 'reveal'; area: 'north' | 'south'; outage: string; note: string };

export interface ScenarioDef {
  id: string;
  name: string;
  version: string;
  start: SimTime;
  map: { w: number; h: number; tiles: TileKind[]; places: PlaceDef[]; props: Prop[] };
  people: PersonDef[];
  households: HouseholdDef[];
  orgs: OrgDef[];
  relations: RelationDef[];
  items: ItemDef[];
  offers: OfferDef[];
  /** 其他收入（元/天）：退休金、补助等 */
  stipends: Array<{ agent: string; amount: number; source: string }>;
  script: ScriptEvent[];
  /** 剧本来源：事件规格（分支对它打补丁） */
  events: OutageEventSpec[];
  /** 世界真相：每轮停电的实际区域与时段 */
  outages: OutageTruth[];
}
