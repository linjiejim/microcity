/**
 * 规则参数（spec v2 §2.1，D35）：注意、转述、理解、可信度、决策、语义、信任、经历记忆这些“心智规则”里的常数。
 * - params_v2 的默认值来自校准（D40–D42）：语义因子向 Jev 的真实决策拟合，信任幅度与经历记忆来自 Jev 信任面板；
 *   其余沿用 v1 的手设值。`PARAM_PRESETS.v1` 可以把校准过的几组换回 v1。
 * - 实验分支可以只覆盖其中几项（敏感性分析、校准、参数对照）；覆盖从分叉点起生效。
 * - 改默认值要升 PARAMS_VERSION，并在方案里记下依据。
 */
import { canonical, contentHash } from './core/hash.ts';
import type { Channel } from './info/types.ts';
import type { ExperienceKind } from './state/types.ts';

export const PARAMS_VERSION = 'params_v3';

export interface RuleParams {
  /** P(注意 | 曝光) = sigmoid(截距 + 权重·因子)，mind/assess.ts */
  attention: {
    intercept: number;
    relevance: number;
    novelty: number;
    curiosity: number;
    busy: number;
    fatigue: number;
    repeat: number;
    salience: Record<Channel, number>;
  };
  /** 对话中提起一条消息，mind/assess.ts */
  mention: {
    intercept: number;
    salience: number;
    listenerRelevance: number;
    sociability: number;
    tie: number;
    anxiety: number;
    told: number;
    toldOthers: number;
  };
  /** 转述变形，info/claims.ts */
  transmit: {
    /** 加在说话人细致度上（正 = 更忠实） */
    detailShift: number;
    /** 精确时段原样转述的概率 = exactBase + exactDetail × 细致度 */
    exactBase: number;
    exactDetail: number;
    /** 均匀数超过它就整个漏说时段（其余降为“下午”之类） */
    dropWindowAbove: number;
    /** 焦虑补全“全天”：P = max(0, 焦虑 − fillFrom) × fillGain */
    fillFrom: number;
    fillGain: number;
  };
  /** 可信度与信念状态，info/belief.ts */
  credibility: {
    officialBase: number;
    officialTrust: number;
    unofficialBase: number;
    unofficialTrust: number;
    talkBase: number;
    talkTie: number;
    talkOfficial: number;
    /** 置信度 ≥ believe 才算“相信”，≥ doubt 算“半信半疑” */
    believe: number;
    doubt: number;
  };
  /** 效用与抽样，mind/reaction.ts */
  decision: {
    keep: number;
    fit: number;
    verify: number;
    avoid: number;
    concernBase: number;
    costTime: number;
    costMoney: number;
    tauBase: number;
    tauOrder: number;
  };
  /**
   * 规则心智的语义因子（mind/reaction.ts 的 ruleSemantics）：Jev 不可用时由它回答“像不像这个人会做的”。
   * 各选项的原始分 = 基线 + 特质权重，再归一化成契合度；担心、想查证、会发消息也在这里。
   */
  semantics: {
    keepBase: number;
    keepRisk: number;
    keepCalm: number;
    verifyBase: number;
    verifyDetail: number;
    verifyDistrust: number;
    moveBase: number;
    moveRisk: number;
    moveOrder: number;
    adaptBase: number;
    adaptOrder: number;
    adaptRisk: number;
    serviceBase: number;
    serviceCommit: number;
    prepareBase: number;
    prepareRisk: number;
    prepareAnx: number;
    restoreBase: number;
    restoreOrder: number;
    concernBase: number;
    concernAnx: number;
    concernRisk: number;
    /** 想查证：时段模糊 / 精确时的基线，细致、不信官方的加成，官方确认的减免 */
    verifyVague: number;
    verifyPrecise: number;
    verifyNeedDetail: number;
    verifyNeedDistrust: number;
    verifyOfficial: number;
    msgBase: number;
    msgAltruism: number;
    msgTie: number;
  };
  /**
   * 经历记忆：每次停电经历对下一轮“担心”“想查证”“照常”的加减，按次数叠加（social_v3）。
   * keep 是“照常”的效用加减 = −（面板里“照下次通知改安排”的概率变化），按 softmax 在 P≈0.75、τ≈0.18 处线性化。
   */
  memory: {
    concern: Record<ExperienceKind, number>;
    verify: Record<ExperienceKind, number>;
    keep: Record<ExperienceKind, number>;
  };
  /** 信任裁决，mind/social.ts；每条规则的变化量 × scale */
  trust: {
    scale: number;
    surprisedUninformed: number;
    surprisedInformed: number;
    accurateNotice: number;
    vagueHeadline: number;
    clarification: number;
    relayExact: number;
    relayCoarse: number;
    relayAllDay: number;
    relayWrongPlace: number;
    relayWrongTime: number;
    /** 虚惊（v3）：信了通知、为此改了安排 / 信了但没耽误什么 */
    falseAlarmCostly: number;
    falseAlarm: number;
  };
}

export const DEFAULT_PARAMS: RuleParams = deepFreeze({
  attention: {
    intercept: -0.9,
    relevance: 1.7,
    novelty: 0.7,
    curiosity: 0.9,
    busy: 0.9,
    fatigue: 0.8,
    repeat: 0.5,
    salience: { push: 0.3, website: 0.5, board: -0.2, talk: 2.0, dm: 1.2, org: 2.5 },
  },
  mention: { intercept: -3.6, salience: 2.6, listenerRelevance: 1.3, sociability: 1.1, tie: 0.9, anxiety: 0.6, told: 3, toldOthers: 0.35 },
  transmit: { detailShift: 0, exactBase: 0.5, exactDetail: 0.45, dropWindowAbove: 0.96, fillFrom: 0.45, fillGain: 1.25 },
  credibility: { officialBase: 0.5, officialTrust: 0.45, unofficialBase: 0.35, unofficialTrust: 0.3, talkBase: 0.3, talkTie: 0.55, talkOfficial: 0.15, believe: 0.55, doubt: 0.3 },
  decision: { keep: 0.45, fit: 0.8, verify: 1.3, avoid: 1.6, concernBase: 0.35, costTime: 0.6, costMoney: 0.7, tauBase: 0.12, tauOrder: 0.12 },
  // C2b：向 Jev 的 2168 个真实决策拟合（seed 42–46 训练、47–51 检验）；未列出的沿用 v1
  semantics: {
    keepBase: 0.3,
    keepRisk: 0.5,
    keepCalm: 0.2,
    verifyBase: 0.12,
    verifyDetail: 0.5,
    verifyDistrust: 0.3,
    moveBase: 0.01,
    moveRisk: 0.4,
    moveOrder: 0.2,
    adaptBase: 3,
    adaptOrder: 0.3,
    adaptRisk: 0.2,
    serviceBase: 0.39,
    serviceCommit: 0.4,
    prepareBase: 1.82,
    prepareRisk: 0.6,
    prepareAnx: 0.3,
    restoreBase: 0.01,
    restoreOrder: 0.4,
    concernBase: 0.09,
    concernAnx: 0.47,
    concernRisk: 0.3,
    verifyVague: 0.71,
    verifyPrecise: 0.66,
    verifyNeedDetail: 0.25,
    verifyNeedDistrust: 0.2,
    verifyOfficial: 0.15,
    msgBase: 0,
    msgAltruism: 0.5,
    msgTie: 0.3,
  },
  // C4 与经典案例 W：Jev 信任面板里 30 位居民“担心”“想先查证”“照下次通知做”相对对照的平均变化
  memory: {
    concern: { surprised_uninformed: 0.13, surprised_informed: 0.1, vague_overreact: 0.08, clarified: 0, accurate: -0.06, false_alarm_costly: 0.02, false_alarm: -0.05 },
    verify: { surprised_uninformed: 0.03, surprised_informed: 0.01, vague_overreact: 0.04, clarified: 0.05, accurate: -0.03, false_alarm_costly: 0.02, false_alarm: 0 },
    keep: { surprised_uninformed: -0.05, surprised_informed: 0.05, vague_overreact: -0.07, clarified: -0.07, accurate: -0.13, false_alarm_costly: 0.08, false_alarm: 0.15 },
  },
  // C4：Jev 信任面板的平均变化（0–1 标尺）；面板没问的两条按其余转述规则的平均倍数（×2.3）放大；
  // 虚惊两条来自经典案例 W 的面板（白挪安排 −0.13，没耽误 −0.09）
  trust: {
    scale: 1,
    surprisedUninformed: -0.11,
    surprisedInformed: -0.1,
    accurateNotice: 0.14,
    vagueHeadline: -0.11,
    clarification: 0.07,
    relayExact: 0.14,
    relayCoarse: 0.05,
    relayAllDay: -0.2,
    relayWrongPlace: -0.2,
    relayWrongTime: -0.14,
    falseAlarmCostly: -0.13,
    falseAlarm: -0.09,
  },
});

/** 校准前（params_v1）的语义、信任幅度与经历记忆：用于“校准前后”的对照 */
export const PARAM_PRESETS: Record<'v1', ParamPatch> = {
  v1: {
    semantics: { verifyBase: 0.3, moveBase: 0.3, adaptBase: 0.35, serviceBase: 0.3, prepareBase: 0.2, restoreBase: 0.4, concernBase: 0.15, concernAnx: 0.45, verifyVague: 0.55, verifyPrecise: 0.1, msgBase: 0.2 },
    memory: {
      concern: { surprised_uninformed: 0, surprised_informed: 0, vague_overreact: 0, clarified: 0, accurate: 0, false_alarm_costly: 0, false_alarm: 0 },
      verify: { surprised_uninformed: 0, surprised_informed: 0, vague_overreact: 0, clarified: 0, accurate: 0, false_alarm_costly: 0, false_alarm: 0 },
      keep: { surprised_uninformed: 0, surprised_informed: 0, vague_overreact: 0, clarified: 0, accurate: 0, false_alarm_costly: 0, false_alarm: 0 },
    },
    trust: { surprisedUninformed: -0.12, surprisedInformed: -0.04, accurateNotice: 0.04, vagueHeadline: -0.05, clarification: 0.03, relayExact: 0.05, relayCoarse: 0.02, relayAllDay: -0.12, relayWrongPlace: -0.08, relayWrongTime: -0.06 },
  },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
/** 参数覆盖：只写要改的项 */
export type ParamPatch = DeepPartial<RuleParams>;

/** 把覆盖合并到默认值上；未知键、非有限数都拒绝（实验清单来自外部输入） */
export function resolveParams(patch?: ParamPatch | null): RuleParams {
  if (!patch || Object.keys(patch).length === 0) return DEFAULT_PARAMS;
  const out = structuredClone(DEFAULT_PARAMS) as unknown as Record<string, unknown>;
  merge(out, patch as Record<string, unknown>, '');
  return deepFreeze(out as unknown as RuleParams);
}

function merge(into: Record<string, unknown>, patch: Record<string, unknown>, path: string): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const cur = into[k];
    const at = path ? `${path}.${k}` : k;
    if (cur === undefined) throw new Error(`未知参数 ${at}`);
    if (typeof cur === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`参数 ${at} 必须是有限数`);
      into[k] = v;
    } else if (cur && typeof cur === 'object') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`参数 ${at} 必须是对象`);
      merge(cur as Record<string, unknown>, v as Record<string, unknown>, at);
    }
  }
}

/** 覆盖是否为空（空覆盖 = 默认参数，运行记录里不写） */
export const isDefaultPatch = (patch?: ParamPatch | null): boolean => !patch || canonical(patch) === '{}';

export const paramsHash = (patch?: ParamPatch | null): string => (isDefaultPatch(patch) ? 'default' : contentHash(patch).slice(0, 10));

/** 按路径读/写一个标量参数（'mention.intercept'、'attention.salience.push'） */
export function paramAt(p: RuleParams, path: string): number {
  let cur: unknown = p;
  for (const k of path.split('.')) cur = (cur as Record<string, unknown>)?.[k];
  if (typeof cur !== 'number') throw new Error(`未知参数 ${path}`);
  return cur;
}

export function patchAt(path: string, value: number, into: ParamPatch = {}): ParamPatch {
  const keys = path.split('.');
  let cur = into as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) cur = (cur[k] ??= {}) as Record<string, unknown>;
  cur[keys[keys.length - 1]!] = value;
  paramAt(resolveParams(into), path);
  return into;
}

/** 敏感性分析里扫的旋钮：路径、中文名、合理范围（低/高） */
export interface ParamKnob {
  path: string;
  label: string;
  lo: number;
  hi: number;
}

export const PARAM_KNOBS: ParamKnob[] = [
  { path: 'attention.intercept', label: '注意基线', lo: -1.6, hi: -0.2 },
  { path: 'attention.salience.push', label: '推送显著度', lo: -0.3, hi: 0.9 },
  { path: 'attention.salience.board', label: '公告栏显著度', lo: -0.8, hi: 0.4 },
  { path: 'mention.intercept', label: '提起消息基线', lo: -4.3, hi: -2.9 },
  { path: 'mention.salience', label: '提起：显著性权重', lo: 1.8, hi: 3.4 },
  { path: 'transmit.detailShift', label: '转述忠实度', lo: -0.2, hi: 0.2 },
  { path: 'transmit.fillGain', label: '焦虑补全“全天”', lo: 0.6, hi: 1.9 },
  { path: 'credibility.officialTrust', label: '官方可信度对信任的斜率', lo: 0.25, hi: 0.65 },
  { path: 'credibility.talkTie', label: '口耳相传对关系信任的斜率', lo: 0.35, hi: 0.75 },
  { path: 'credibility.believe', label: '相信阈值', lo: 0.45, hi: 0.65 },
  { path: 'decision.avoid', label: '避损权重', lo: 1.1, hi: 2.1 },
  { path: 'decision.keep', label: '惯性（照常）权重', lo: 0.3, hi: 0.6 },
  { path: 'decision.tauBase', label: '抽样温度', lo: 0.07, hi: 0.17 },
  { path: 'trust.scale', label: '信任变化幅度', lo: 0.5, hi: 3 },
];

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}
