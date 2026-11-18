import type { HouseholdType, PlaceKind } from './def.ts';
import type { Weather } from './state.ts';

/**
 * 干预（D88）：对世界规则的补丁，有起止日期（都是第几天，含首尾）。
 * 它是运行配置的一部分，和种子、参数并列；不加干预时世界与基线逐事件相同。
 *
 * 地点可以写 id，也可以写类型（取该类型的第一个），这样同一份干预能用在不同的社区上。
 */
export type PlaceRef = string | PlaceKind;

export type Intervention =
  /** 停业：这段时间关门，店员也不上班（没有工资） */
  | { kind: 'close'; place: PlaceRef; from: number; to?: number }
  /** 调价：某类店（或某个地点）某种商品的价格乘一个系数 */
  | { kind: 'price'; place: PlaceRef; item: string; factor: number; from: number; to?: number }
  /** 发钱：某天给每户（或某几类家庭）一笔钱 */
  | { kind: 'grant'; amount: number; households?: HouseholdType[]; day: number }
  /** 裁员：某天某个单位裁掉一部分人（店主不裁） */
  | { kind: 'layoff'; place: PlaceRef; fraction: number; day: number }
  /** 房租乘一个系数 */
  | { kind: 'rent'; factor: number; from: number; to?: number }
  /** 开伙：某个地点开始卖饭 */
  | { kind: 'canteen'; place: PlaceRef; price: number; from: number; to?: number }
  /** 这段时间都是某种天气 */
  | { kind: 'weather'; weather: Weather; from: number; to: number }
  /** 传言：某天从几个人开始传开 */
  | { kind: 'rumor'; topic: string; seeds: number; day: number };

export type InterventionKind = Intervention['kind'];

/** 传言的内容与效果（最小版信息系统，D89）：知道的人在若干天内多囤东西 */
export interface RumorInfo {
  id: string;
  label: string;
  /** 说给别人听的那句话 */
  saying: string;
  /** 知道后的几天里有效 */
  days: number;
  /** 存粮“该买了”的线与“买到多少”乘的系数 */
  hoardLow: number;
  hoardTarget: number;
  /** 聊天时说出去的概率 */
  spread: number;
}

export const RUMORS: Record<string, RumorInfo> = {
  price_up: { id: 'price_up', label: '菜要涨价了', saying: '听说菜要涨价了', days: 4, hoardLow: 2.4, hoardTarget: 1.9, spread: 0.7 },
  shortage: { id: 'shortage', label: '菜市场要关了', saying: '听说菜市场要关了', days: 5, hoardLow: 3, hoardTarget: 2.2, spread: 0.75 },
};

export const INTERVENTION_LABEL: Record<InterventionKind, string> = { close: '停业', price: '调价', grant: '发钱', layoff: '裁员', rent: '房租', canteen: '开伙', weather: '天气', rumor: '传言' };

const span = (from: number, to?: number): string => (to === undefined ? `第 ${from} 天起` : to === from ? `第 ${from} 天` : `第 ${from}–${to} 天`);
const pct = (factor: number): string => `${factor >= 1 ? '涨' : '降'} ${Math.round(Math.abs(factor - 1) * 100)}%`;

/** 一句话说清一条干预（placeName 把地点引用换成名字） */
export function describeIntervention(iv: Intervention, placeName: (ref: PlaceRef) => string): string {
  switch (iv.kind) {
    case 'close':
      return `${placeName(iv.place)}停业（${span(iv.from, iv.to)}）`;
    case 'price':
      return `${placeName(iv.place)}的${iv.item === 'food' ? '菜' : iv.item === 'meal' ? '饭' : iv.item}${pct(iv.factor)}（${span(iv.from, iv.to)}）`;
    case 'grant':
      return `第 ${iv.day} 天给${iv.households ? '部分家庭' : '每户'}发 ${iv.amount} 元`;
    case 'layoff':
      return `第 ${iv.day} 天${placeName(iv.place)}裁员 ${Math.round(iv.fraction * 100)}%`;
    case 'rent':
      return `房租${pct(iv.factor)}（${span(iv.from, iv.to)}）`;
    case 'canteen':
      return `${placeName(iv.place)}开伙，一顿 ${iv.price} 元（${span(iv.from, iv.to)}）`;
    case 'weather':
      return `${span(iv.from, iv.to)}都是${iv.weather === 'rain' ? '雨天' : iv.weather === 'cloud' ? '阴天' : '晴天'}`;
    case 'rumor':
      return `第 ${iv.day} 天，“${RUMORS[iv.topic]?.label ?? iv.topic}”从 ${iv.seeds} 个人开始传开`;
  }
}

export const activeOn = (iv: { from: number; to?: number }, day: number): boolean => day >= iv.from && (iv.to === undefined || day <= iv.to);
