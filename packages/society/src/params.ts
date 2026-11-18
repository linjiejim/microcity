import { hm } from './core/time.ts';
import type { ActKind } from './data/tables.ts';

/**
 * 规则参数：心智与经济里的所有常数都在这里，规则模块里不写魔法数。
 * 改默认值要升 PARAMS_VERSION 并写明依据；实验要换参数，用引擎选项覆盖。
 *
 * life_v1 的依据：让“典型事实检查”成立（人均睡眠 6.5–9.5 小时、在职者工作日工作 6–10 小时、
 * 三餐规律、月末极少有家庭入不敷出），尚未对照真实的时间利用调查（M3 的校准页会做）。
 */
export const PARAMS_VERSION = 'life_v1';
/** 候选的生成或效用公式变了就升 */
export const POLICY_VERSION = 'life_policy_v1';
/** 关系变化的规则变了就升 */
export const SOCIAL_RULES_VERSION = 'ties_v1';

export type NeedKey = 'hunger' | 'energy' | 'social' | 'fun';
export const NEEDS: NeedKey[] = ['hunger', 'energy', 'social', 'fun'];
export const NEED_LABEL: Record<NeedKey, string> = { hunger: '吃饱', energy: '精力', social: '社交', fun: '乐趣' };
/** 每小时的变化量，顺序同 NEEDS */
export type Rates = [number, number, number, number];

export interface RuleParams {
  /** 各类活动下需求每小时的变化；hobby 的娱乐、社交、精力由兴趣表给出，这里是底数 */
  rates: Record<ActKind | 'move' | 'away', Rates>;
  /** 一家人一起吃饭时额外的社交回报（每小时） */
  familyMealSocial: number;
  /** 聊一次天，双方社交各涨多少 */
  chatSocial: number;

  /** 效用里各需求的权重 */
  needWeight: Record<NeedKey, number>;
  /** 需求缺口的指数：越缺越急 */
  needCurve: number;
  /** softmax 温度 */
  temperature: number;
  /** 每分钟路程的代价 */
  travelCost: number;
  /** 花费的代价（每元）：底数、手头紧的加成、节俭的加成 */
  costBase: number;
  costTight: number;
  costThrift: number;
  /** 兴趣加成；在习惯时段内 / 外 */
  interestBonus: number;
  windowIn: number;
  windowOut: number;
  /** 熟人在场：每点亲密度的加成与上限；同好在场每人的加成与人数上限 */
  companyPerCloseness: number;
  companyCap: number;
  crowdPer: number;
  crowdCap: number;
  /** 雨天、阴天做户外活动的代价 */
  rainOutdoor: number;
  cloudOutdoor: number;
  /** 今天已经做过同一件事，每次的折扣 */
  repeatPenalty: number;
  /** 过了平时睡觉的点，其他事每小时的代价 */
  latePenalty: number;
  /** 到饭点的加成 */
  mealWindowBonus: number;
  /** 自己做饭的麻烦 */
  cookEffort: number;

  /** 提前多久到（秒） */
  lead: number;
  /** 起床到出门的准备时间（秒） */
  morningPrep: number;
  /** 步行、骑电动车的速度（米/秒）；老人与儿童步行的系数 */
  walkSpeed: number;
  ebikeSpeed: number;
  slowFactor: number;
  /** 超过这个路程才骑车（米） */
  ebikeMin: number;
  /**
   * 街道的压缩倍数：画面上一格 4 米，算路程时按 4 × streetScale 米。
   * 微缩模型把街道画短了，路上的时间仍按真实的街区尺度算（D82）。
   */
  streetScale: number;
  /** 不在饭点时，饿到这个程度以下才会去吃；饭点时的门槛 */
  snackBelow: number;
  mealBelow: number;
  /** 小于这个年龄不会自己下馆子 */
  eatOutAge: number;

  /** 一顿家里的饭用掉几份存粮；存粮低于“每人几份”就该去买；一次买到“每人几份” */
  pantryLow: number;
  pantryTarget: number;
  suppliesLow: number;
  suppliesTarget: number;
  /** 日用品每人每天用掉多少份 */
  suppliesDaily: number;

  /** 发薪后交给家里的比例：在职、退休 */
  shareWorker: number;
  sharePension: number;
  /** 店主每周提走超出备用金的比例 */
  profitDraw: number;
  /** 每周水电：每户底数 + 每人 */
  utilitiesBase: number;
  utilitiesPer: number;
  /** 去城里上班的午饭、学校的午饭（元） */
  cityLunch: number;
  schoolLunch: number;
  /** 儿童每周零花钱（元） */
  allowance: number;
  /** 被裁后每月的失业补助（元） */
  joblessAid: number;

  /** 聊天让亲密度涨多少（随现有亲密度递减） */
  chatCloseness: number;
  /** 陌生人同场聊过几次成为熟人；亲密度过多少成为朋友 */
  acquaintAfter: number;
  friendAt: number;
  /** 陌生人同场时搭话的概率底数 */
  strangerChat: number;
  /** 久不见面，亲密度的半衰期（天）；家人不衰减 */
  tieHalfLife: number;
}

export const DEFAULT_PARAMS: RuleParams = {
  rates: {
    sleep: [-0.03, 0.125, -0.02, -0.02],
    nap: [-0.04, 0.17, -0.01, 0],
    wash: [-0.12, -0.03, -0.05, -0.04],
    eat_home: [1.9, -0.02, 0.1, 0.1],
    eat_out: [1.9, -0.02, 0.14, 0.16],
    eat_work: [1.9, -0.02, 0.08, 0.04],
    cook: [-0.1, -0.07, -0.03, -0.05],
    work: [-0.115, -0.07, -0.01, -0.08],
    school: [-0.05, -0.06, 0.08, -0.02],
    study: [-0.12, -0.07, -0.06, -0.1],
    shop: [-0.12, -0.065, 0.07, 0.03],
    hobby: [-0.12, -0.04, -0.07, -0.08],
    chores: [-0.12, -0.075, -0.07, -0.09],
    rest: [-0.11, 0.03, -0.07, -0.05],
    wait: [-0.12, -0.04, -0.07, -0.08],
    escort: [-0.12, -0.06, 0.08, 0.02],
    clinic: [-0.12, -0.04, 0.03, -0.03],
    move: [-0.14, -0.075, -0.06, -0.06],
    away: [-0.045, -0.065, -0.01, -0.07],
  },
  familyMealSocial: 0.5,
  chatSocial: 0.07,

  needWeight: { hunger: 9, energy: 6, social: 4.2, fun: 5 },
  needCurve: 1.3,
  temperature: 0.7,
  travelCost: 0.06,
  costBase: 0.03,
  costTight: 0.14,
  costThrift: 0.05,
  interestBonus: 0.9,
  windowIn: 1.3,
  windowOut: -1.3,
  companyPerCloseness: 0.6,
  companyCap: 1.5,
  crowdPer: 0.16,
  crowdCap: 5,
  rainOutdoor: 3.6,
  cloudOutdoor: 0.2,
  repeatPenalty: 1.0,
  latePenalty: 2.2,
  mealWindowBonus: 1.2,
  cookEffort: 0.5,

  lead: 120,
  morningPrep: hm(0, 45),
  walkSpeed: 1.25,
  ebikeSpeed: 4.2,
  slowFactor: 0.8,
  ebikeMin: 260,
  streetScale: 3,
  snackBelow: 0.32,
  mealBelow: 0.75,
  eatOutAge: 12,

  pantryLow: 3,
  pantryTarget: 9,
  suppliesLow: 2,
  suppliesTarget: 8,
  suppliesDaily: 0.5,

  shareWorker: 0.55,
  sharePension: 0.65,
  profitDraw: 0.7,
  utilitiesBase: 45,
  utilitiesPer: 12,
  cityLunch: 20,
  schoolLunch: 8,
  allowance: 30,
  joblessAid: 900,

  chatCloseness: 0.03,
  acquaintAfter: 3,
  friendAt: 0.5,
  strangerChat: 0.1,
  tieHalfLife: 60,
};

/** 三餐的时段（当天秒数） */
export const MEAL_WINDOWS: Array<[number, number, string]> = [
  [hm(4, 30), hm(9), '早饭'],
  [hm(11, 15), hm(13, 30), '午饭'],
  [hm(17, 30), hm(20), '晚饭'],
];

export const mealAt = (secOfDay: number): string | undefined => MEAL_WINDOWS.find(([a, b]) => secOfDay >= a && secOfDay < b)?.[2];
