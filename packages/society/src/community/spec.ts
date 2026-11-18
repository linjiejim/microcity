import { clamp } from '../core/rng.ts';
import { shortHash } from '../core/hash.ts';
import type { HouseholdType } from '../model/def.ts';

/** 社区规格：生成器的全部输入。同一规格永远生成同一社区。 */
export interface CommunitySpec {
  /** 布局模板 */
  template: 'oldtown';
  name: string;
  blurb: string;
  /** 生成用的种子（与运行种子分开：换运行种子不换人） */
  seed: number;
  population: number;
  /** 家庭类型的权重 */
  households: Record<HouseholdType, number>;
  /** 住楼房的家庭占比 */
  apartments: number;
  /** 租房家庭占比 */
  renters: number;
  /** 收入水平系数（1 = 模板默认） */
  wealth: number;
}

export const SPEC_LIMITS = { population: [120, 220], apartments: [0, 0.7], renters: [0, 0.8], wealth: [0.6, 1.6] } as const;

/** 老城街坊：老人多、熟人社会、十五分钟生活圈 */
export const OLDTOWN: CommunitySpec = {
  template: 'oldtown',
  name: '和平里',
  blurb: '老城街坊：老人多，街坊相熟，买菜、喝茶、跳舞都在步行十分钟以内。',
  seed: 7,
  population: 180,
  households: { elder_couple: 0.2, elder_single: 0.11, three_gen: 0.15, nuclear: 0.21, couple: 0.11, single: 0.13, single_parent: 0.04, sharers: 0.05 },
  apartments: 0.4,
  renters: 0.25,
  wealth: 1,
};

export const PRESETS: Record<string, CommunitySpec> = { oldtown: OLDTOWN };

export interface Adjustment {
  field: string;
  from: number;
  to: number;
  reason: string;
}

/** 规范化：把越界的值拉回范围，并说明改了什么 */
export function normalizeSpec(input: CommunitySpec): { spec: CommunitySpec; adjustments: Adjustment[] } {
  const adjustments: Adjustment[] = [];
  const fix = (field: 'population' | 'apartments' | 'renters' | 'wealth', v: number): number => {
    const [lo, hi] = SPEC_LIMITS[field];
    const to = clamp(Number.isFinite(v) ? v : lo, lo, hi);
    if (to !== v) adjustments.push({ field, from: v, to, reason: `超出范围 ${lo}–${hi}` });
    return to;
  };
  const households = { ...OLDTOWN.households, ...input.households };
  let total = 0;
  for (const k of Object.keys(households) as HouseholdType[]) {
    households[k] = Math.max(0, households[k]);
    total += households[k];
  }
  if (total <= 0) Object.assign(households, OLDTOWN.households);
  const spec: CommunitySpec = {
    ...input,
    population: Math.round(fix('population', input.population)),
    apartments: fix('apartments', input.apartments),
    renters: fix('renters', input.renters),
    wealth: fix('wealth', input.wealth),
    households,
  };
  return { spec, adjustments };
}

export const specHash = (spec: CommunitySpec): string => shortHash(spec);
