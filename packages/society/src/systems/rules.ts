import type { CommunityDef, OfferDef, PlaceDef } from '../model/def.ts';
import { activeOn, RUMORS, type Intervention, type PlaceRef } from '../model/intervention.ts';
import type { PersonState, Weather } from '../model/state.ts';
import { DAY, type SimTime } from '../core/time.ts';
import type { RuleParams } from '../params.ts';

/**
 * 当前生效的规则补丁（D88）：把运行配置里的干预解析成“某天某地是否停业、某种商品几折、房租几成”这样的查询。
 * 它只读配置，不占状态；一次性的干预（发钱、裁员、传言）由引擎在到点时发事件。
 */
export class Rules {
  readonly list: Intervention[];
  private readonly placeOf: Array<string | undefined>;

  constructor(
    private readonly def: CommunityDef,
    list: Intervention[],
  ) {
    this.list = list;
    this.placeOf = list.map((iv) => ('place' in iv ? this.resolve(iv.place)?.id : undefined));
  }

  /** 地点引用 → 地点：先按 id，再按类型取第一个 */
  resolve(ref: PlaceRef): PlaceDef | undefined {
    return this.def.map.places.find((p) => p.id === ref) ?? this.def.map.places.find((p) => p.kind === ref);
  }

  placeName(ref: PlaceRef): string {
    return this.resolve(ref)?.name ?? String(ref);
  }

  /** 第 i 条干预指向的地点 id */
  target(i: number): string | undefined {
    return this.placeOf[i];
  }

  closed(place: string, day: number): boolean {
    for (let i = 0; i < this.list.length; i++) {
      const iv = this.list[i]!;
      if (iv.kind === 'close' && this.placeOf[i] === place && activeOn(iv, day)) return true;
    }
    return false;
  }

  priceFactor(place: string, item: string, day: number): number {
    let f = 1;
    for (let i = 0; i < this.list.length; i++) {
      const iv = this.list[i]!;
      if (iv.kind === 'price' && this.placeOf[i] === place && iv.item === item && activeOn(iv, day)) f *= iv.factor;
    }
    return f;
  }

  rentFactor(day: number): number {
    let f = 1;
    for (const iv of this.list) if (iv.kind === 'rent' && activeOn(iv, day)) f *= iv.factor;
    return f;
  }

  /** 这一天在卖饭的“食堂”：地点 → 价格 */
  canteens(day: number): Array<{ place: string; price: number }> {
    const out: Array<{ place: string; price: number }> = [];
    for (let i = 0; i < this.list.length; i++) {
      const iv = this.list[i]!;
      const place = this.placeOf[i];
      if (iv.kind === 'canteen' && place && activeOn(iv, day)) out.push({ place, price: iv.price });
    }
    return out;
  }

  canteenAt(place: string, day: number): OfferDef | undefined {
    const c = this.canteens(day).find((x) => x.place === place);
    return c ? { item: 'meal', price: c.price, cost: 0.6, stock: 0, restockTo: 240 } : undefined;
  }

  weather(day: number): Weather | undefined {
    for (const iv of this.list) if (iv.kind === 'weather' && activeOn(iv, day)) return iv.weather;
    return undefined;
  }
}

/** 一家人现在信着哪条传言：家里有大人在有效期内听说过，就按它囤东西 */
export function hoarding(members: PersonState[], t: SimTime): { low: number; target: number } {
  let low = 1;
  let target = 1;
  for (const m of members)
    for (const topic in m.heard) {
      const info = RUMORS[topic];
      if (!info || t - m.heard[topic]! > info.days * DAY) continue;
      low = Math.max(low, info.hoardLow);
      target = Math.max(target, info.hoardTarget);
    }
  return { low, target };
}

/** 存粮的两条线（每人几份）：该买了、买到多少；信了传言的家庭两条线都更高 */
export function pantryLines(params: RuleParams, members: PersonState[], t: SimTime): { low: number; target: number } {
  const h = hoarding(members, t);
  return { low: params.pantryLow * h.low, target: params.pantryTarget * h.target };
}
