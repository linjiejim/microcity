import { clamp } from '../core/rng.ts';
import { shortHash } from '../core/hash.ts';
import type { HouseholdType } from '../model/def.ts';

/** 社区规格：生成器的全部输入。同一规格永远生成同一社区。 */
export interface CommunitySpec {
  /** 布局模板 */
  template: 'oldtown' | 'newtown' | 'village' | 'factory';
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
  /** 在职者去城里上班的比例（本地岗位不够时会更高） */
  cityShare: number;
}

export const SPEC_LIMITS = { population: [120, 220], apartments: [0, 0.9], renters: [0, 0.9], wealth: [0.6, 1.6], cityShare: [0, 0.85] } as const;

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
  cityShare: 0.26,
};

/** 通勤新小区：年轻家庭多，白天一大半人去城里上班，邻里不太熟 */
export const NEWTOWN: CommunitySpec = {
  template: 'newtown',
  name: '青禾苑',
  blurb: '通勤新小区：年轻家庭多，白天一大半人坐车去城里，回来已是傍晚。',
  seed: 11,
  population: 190,
  households: { elder_couple: 0.06, elder_single: 0.03, three_gen: 0.1, nuclear: 0.36, couple: 0.22, single: 0.14, single_parent: 0.04, sharers: 0.05 },
  apartments: 0.85,
  renters: 0.45,
  wealth: 1.25,
  cityShare: 0.68,
};

/** 城中村：外来的年轻人多，合租、单住，小店密，手头紧 */
export const VILLAGE: CommunitySpec = {
  template: 'village',
  name: '塘尾村',
  blurb: '城中村：外来的年轻人多，合租或一个人住，楼下就是小店，手头不宽裕。',
  seed: 23,
  population: 200,
  households: { elder_couple: 0.05, elder_single: 0.03, three_gen: 0.07, nuclear: 0.13, couple: 0.14, single: 0.3, single_parent: 0.04, sharers: 0.24 },
  apartments: 0.7,
  renters: 0.78,
  wealth: 0.72,
  cityShare: 0.5,
};

/** 工厂镇：两个车间养着大半个镇，上下班的钟点就是全镇的钟点 */
export const FACTORY: CommunitySpec = {
  template: 'factory',
  name: '红星厂',
  blurb: '工厂镇：两个车间养着大半个镇，上下班的钟点就是全镇的钟点。',
  seed: 31,
  population: 190,
  households: { elder_couple: 0.13, elder_single: 0.06, three_gen: 0.14, nuclear: 0.3, couple: 0.12, single: 0.13, single_parent: 0.04, sharers: 0.08 },
  apartments: 0.6,
  renters: 0.15,
  wealth: 0.95,
  cityShare: 0.08,
};

export const PRESETS: Record<CommunitySpec['template'], CommunitySpec> = { oldtown: OLDTOWN, newtown: NEWTOWN, village: VILLAGE, factory: FACTORY };
export const TEMPLATE_LABEL: Record<CommunitySpec['template'], string> = { oldtown: '老城街坊', newtown: '通勤新小区', village: '城中村', factory: '工厂镇' };

export interface Adjustment {
  field: string;
  from: number;
  to: number;
  reason: string;
}

/** 规范化：把越界的值拉回范围，并说明改了什么 */
export function normalizeSpec(input: CommunitySpec): { spec: CommunitySpec; adjustments: Adjustment[] } {
  const adjustments: Adjustment[] = [];
  const fix = (field: 'population' | 'apartments' | 'renters' | 'wealth' | 'cityShare', v: number): number => {
    const [lo, hi] = SPEC_LIMITS[field];
    const to = clamp(Number.isFinite(v) ? v : lo, lo, hi);
    if (to !== v) adjustments.push({ field, from: v, to, reason: `超出范围 ${lo}–${hi}` });
    return to;
  };
  const template = input.template in PRESETS ? input.template : 'oldtown';
  const preset = PRESETS[template];
  const households = { ...preset.households, ...input.households };
  let total = 0;
  for (const k of Object.keys(households) as HouseholdType[]) {
    households[k] = Math.max(0, households[k]);
    total += households[k];
  }
  if (total <= 0) Object.assign(households, preset.households);
  const spec: CommunitySpec = {
    ...input,
    population: Math.round(fix('population', input.population)),
    apartments: fix('apartments', input.apartments),
    renters: fix('renters', input.renters),
    wealth: fix('wealth', input.wealth),
    cityShare: fix('cityShare', input.cityShare ?? preset.cityShare),
    template,
    name: String(input.name ?? '').trim().slice(0, 12) || preset.name,
    blurb: String(input.blurb ?? '').slice(0, 80),
    seed: Number.isFinite(input.seed) ? Math.round(input.seed) : preset.seed,
    households,
  };
  return { spec, adjustments };
}

export const specHash = (spec: CommunitySpec): string => shortHash(spec);
