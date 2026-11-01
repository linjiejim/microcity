import { contentHash } from '../core/hash.ts';
import { clamp01, r3, sigmoid } from '../core/rng.ts';
import { clock, dayOf, dayStart, formatTime, hhmm, type SimTime, timeOfDay, weekday } from '../core/time.ts';
import type { District, TownMap } from '../world/map.ts';
import { describeSlots, slotSummary, windowInterval, windowPrecision } from '../info/slots.ts';
import type { Belief } from '../info/types.ts';
import type { Agent, Experience, ExperienceKind, WorldState } from '../state/types.ts';
import { atRiskItems, contactsOf, districtOf, IMPORTANCE, relevanceOf, riskOverlap, type AtRisk } from './assess.ts';
import type { Candidate, FactorValue, Observation, Rejected, SemanticAnswer } from './types.ts';
import { DEFAULT_PARAMS, type RuleParams } from '../params.ts';

export const POLICY_VERSION = 'utility_v3';

const TRAIT_WORD = (x: number) => (x >= 0.75 ? 'high' : x >= 0.45 ? 'medium' : 'low');

function personObs(a: Agent): Observation['person'] {
  const t = a.traits;
  return {
    name: a.name,
    age: a.age,
    role: a.roleLabel,
    bio: a.bio,
    traits: {
      anxiety: TRAIT_WORD(t.anxiety),
      risk_aversion: TRAIT_WORD(t.riskAversion),
      sociability: TRAIT_WORD(t.sociability),
      orderliness: TRAIT_WORD(t.order),
      curiosity: TRAIT_WORD(t.curiosity),
      altruism: TRAIT_WORD(t.altruism),
      commitment: TRAIT_WORD(t.commitment),
      trust_in_official_notices: TRAIT_WORD(a.trustGov),
      attention_to_detail: TRAIT_WORD(t.detail),
    },
  };
}

function beliefObs(s: WorldState, b: Belief): Observation['belief'] {
  const slots: Record<string, string> = {};
  for (const row of slotSummary(b.slots)) if (row.value !== '—') slots[row.key] = row.value;
  const heardFrom = b.sources.map((x) => (x.from ? `${s.agents[x.from]?.name ?? x.from}（${x.channel}）` : x.channel));
  return { summary: describeSlots(b.slots, { withSource: true }), slots, confidence: b.confidence, heardFrom: [...new Set(heardFrom)].slice(0, 5) };
}

function locationLabel(map: TownMap, a: Agent): string {
  if (a.loc.k === 'in') return map.places[a.loc.place]?.name ?? a.loc.place;
  if (a.loc.k === 'walk') return `在去${map.places[a.loc.walk.toPlace]?.name ?? ''}的路上`;
  return '街上';
}

/**
 * 替代地点：避开所信的停电区域（区域不详时避开这项安排所在的区），找最近的同类可去处。
 * 返回 undefined 表示这座小镇没有合适的替代地点。
 */
export function altFor(map: TownMap, kind: string, itemPlace: string, avoid: District | undefined): { place: string; kind: string; label: string } | undefined {
  const lib = () => map.nearestOf('library', itemPlace, avoid ? { avoid } : {});
  switch (kind) {
    case 'wfh': {
      const p = lib();
      return p && { place: p.id, kind: 'wfh', label: `去${p.short}办公` };
    }
    case 'work': {
      const p = lib();
      return p && { place: p.id, kind: 'wfh', label: `去${p.short}远程办公` };
    }
    case 'study': {
      const p = lib();
      return p && { place: p.id, kind: 'study', label: `去${p.short}自习` };
    }
    case 'jobsearch': {
      const p = lib();
      return p && { place: p.id, kind: 'jobsearch', label: `照常去${p.short}` };
    }
    case 'tv':
    case 'leisure': {
      const p = map.nearestOf(['plaza', 'park'], itemPlace, avoid ? { avoid } : {});
      return p && { place: p.id, kind: 'walk', label: kind === 'tv' ? `去${p.name}转转` : `改去${p.name}` };
    }
    case 'shop': {
      const p = map.nearestOf(['supermarket', 'convenience'], itemPlace, avoid ? { avoid } : {});
      return p && { place: p.id, kind: 'shop', label: `改去${p.name}` };
    }
    default:
      return undefined;
  }
}

const ALT_KINDS = ['wfh', 'study', 'tv', 'leisure', 'shop', 'jobsearch'];
const ADAPT_LABEL: Record<string, string> = {
  tv: '改做不用电的事（看书、收拾屋子）',
  study: '提前备好不用电的学习材料',
  breakfast: '提前备好不用开火的饭',
  lunch: '提前备好不用开火的饭',
  dinner: '提前备好不用开火的饭',
};

export interface ReactionBuild {
  candidates: Candidate[];
  rejected: Rejected[];
  ruleFactors: Record<string, Record<string, FactorValue>>;
  semanticRule: SemanticAnswer;
  observation: Observation;
  observationHash: string;
  atRisk: AtRisk[];
}

/** reaction 候选：由规则从当前可见世界筛出合法选项（原方案第 13、24 页） */
export function buildReaction(s: WorldState, map: TownMap, a: Agent, b: Belief, t: SimTime, verifiedToday: boolean, P: RuleParams = DEFAULT_PARAMS): ReactionBuild {
  const risks = atRiskItems(map, a, b.slots, t);
  const candidates: Candidate[] = [];
  const rejected: Rejected[] = [];
  const rf: Record<string, Record<string, FactorValue>> = {};
  const totalRisk = risks.reduce((acc, r) => acc + r.overlapSec * (IMPORTANCE[r.item.kind] ?? 0.3), 0);
  const wallet = s.accounts[a.wallet] ?? 0;

  const add = (c: Candidate, f: Record<string, number>, sources: Record<string, string> = {}) => {
    candidates.push(c);
    rf[c.id] = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, { value: r3(v), source: sources[k] ?? `rule:${k}` }]));
  };

  add({ id: 'keep', kind: 'keep', label: '照常安排', params: {} }, { avoid: 0, cost_time: 0, cost_money: 0, habit: 1 });

  const relevant = risks.length > 0 || relevanceOf(s, map, a, b.slots, t).area >= 0.7;
  const needVerify = relevant && (windowPrecision(b.slots.window) < 3 || b.slots.certainty !== 'confirmed' || (b.slots.source !== 'gov' && b.slots.source !== 'org'));
  if (needVerify && !verifiedToday && a.phone.battery > 3) {
    add({ id: 'verify', kind: 'verify', label: '先上镇网站查证具体时间', params: {} }, { avoid: 0, cost_time: 0.05, cost_money: 0, habit: 0 });
  } else if (needVerify) {
    rejected.push({ id: 'verify', label: '先上镇网站查证具体时间', reason: verifiedToday ? '今天已经查过' : '手机没电' });
  }

  // 管理者：调整营业（需授权）
  const org = a.org ? Object.values(s.orgs).find((o) => o.id === a.org) : undefined;
  const isManager = !!org && org.manager === a.id;
  const workRisk = risks.find((r) => r.item.kind === 'work' && r.item.place === a.workplace);

  for (const r of risks.slice(0, 4)) {
    const it = r.item;
    const w = ((r.overlapSec * (IMPORTANCE[it.kind] ?? 0.3)) / Math.max(1, totalRisk)) * Math.min(1, r.overlapSec / 7200);
    const span = `${clock(r.from)}–${clock(r.to)}`;
    const avoidD = b.slots.area === 'north' || b.slots.area === 'south' ? b.slots.area : b.slots.area === 'town' ? undefined : districtOf(map, it.place);
    if (it.kind === 'work' && it.place === a.workplace) {
      const alt = a.role === 'designer' || a.role === 'studio_lead' ? altFor(map, 'work', it.place, avoidD) : undefined;
      if (alt) {
        add(
          { id: `move:${it.id}`, kind: 'move', label: `${weekday(r.day)} ${span} ${alt.label}`, params: { item: it.id, day: r.day, place: alt.place, kind: alt.kind, from: r.from, to: r.to } },
          { avoid: w, cost_time: map.travelSeconds(it.place, alt.place) / 1800, cost_money: 0, habit: 0 },
        );
      } else if (!isManager) {
        rejected.push({ id: `move:${it.id}`, label: `${span} 换地方上班`, reason: '岗位在店里，个人无权调整' });
      }
      continue;
    }
    const alt = altFor(map, it.kind, it.place, avoidD);
    if (alt && alt.place !== it.place && !(districtOf(map, alt.place) === b.slots.area)) {
      add(
        { id: `move:${it.id}`, kind: 'move', label: `${weekday(r.day)} ${span} ${alt.label}`, params: { item: it.id, day: r.day, place: alt.place, kind: alt.kind, from: r.from, to: r.to } },
        { avoid: w, cost_time: map.travelSeconds(it.place, alt.place) / 1800, cost_money: 0, habit: 0 },
      );
    } else if (ALT_KINDS.includes(it.kind) && !alt) {
      rejected.push({ id: `move:${it.id}`, label: `${span} 换个地方${it.label}`, reason: '镇上没有合适的替代地点' });
    }
    if (ADAPT_LABEL[it.kind]) {
      add({ id: `adapt:${it.id}`, kind: 'adapt', label: `${weekday(r.day)} ${span} ${ADAPT_LABEL[it.kind]}`, params: { item: it.id, day: r.day, from: r.from, to: r.to } }, { avoid: w * 0.8, cost_time: 0.02, cost_money: 0, habit: 0 });
    }
  }

  if (isManager && workRisk && org) {
    const place = org.place;
    // 调整的是整家店：按此人所信的停电时段（与营业时间取交集），而不是只看自己的班次
    const [w0, w1] = windowInterval(b.slots.window);
    const d0 = dayStart(workRisk.day);
    const hours = map.places[place]?.hours ?? [[0, 86400]];
    const open0 = Math.min(...hours.map((h) => h[0]));
    const open1 = Math.max(...hours.map((h) => h[1]));
    const from = Math.max(d0 + Math.max(w0, open0), t);
    const to = d0 + Math.min(w1, open1);
    if (to - from >= 20 * 60) {
      const span = `${clock(from)}–${clock(to)}`;
      const staffRisk = 0.9;
      const kind = map.places[place]?.kind;
      if (kind === 'cafe') {
        add({ id: `service:${place}:cold_menu`, kind: 'service', label: `${weekday(workRisk.day)} ${span} 改卖冷饮点心，照常开门`, params: { place, mode: 'cold_menu', day: workRisk.day, from, to } }, { avoid: staffRisk, cost_time: 0.1, cost_money: 0.2 * ((to - from) / 7200), habit: 0 });
      }
      const lib = kind === 'studio' ? map.nearestOf('library', place, b.slots.area === 'north' || b.slots.area === 'south' ? { avoid: b.slots.area } : {}) : undefined;
      if (lib) {
        add({ id: `service:${place}:relocate_team`, kind: 'service', label: `${weekday(workRisk.day)} ${span} 团队去${lib.short}办公`, params: { place, mode: 'relocate_team', day: workRisk.day, from, to, dest: lib.id } }, { avoid: staffRisk, cost_time: 0.25, cost_money: 0, habit: 0 });
      }
      add({ id: `service:${place}:closed_window`, kind: 'service', label: `${weekday(workRisk.day)} ${span} 暂停营业，员工休息`, params: { place, mode: 'closed_window', day: workRisk.day, from, to } }, { avoid: staffRisk, cost_time: 0.05, cost_money: Math.min(1, (kind === 'studio' ? 0.3 : 0.5) * ((to - from) / 7200)), habit: 0 });
    }
  }

  // 备充电宝
  const hasBank = (s.stock[a.id]?.power_bank ?? 0) > 0;
  if (risks.length > 0 && !hasBank) {
    const sells = (p: { id: string }) => s.prices[p.id]?.power_bank !== undefined;
    const storeP = map.nearestOf(['convenience', 'supermarket'], a.home, { district: districtOf(map, a.home), filter: sells }) ?? map.nearestOf(['convenience', 'supermarket'], a.home, { filter: sells });
    if (storeP) {
      const store = storeP.id;
      const price = s.prices[store]?.power_bank ?? 7900;
      const stock = s.stock[store]?.power_bank ?? 0;
      if (wallet < price) rejected.push({ id: 'prepare', label: '买个充电宝备用', reason: '钱不够' });
      else if (stock <= 0) rejected.push({ id: 'prepare', label: '买个充电宝备用', reason: `${storeP.short}充电宝售罄` });
      else add({ id: 'prepare', kind: 'prepare', label: `去${storeP.short}买个充电宝备用`, params: { store } }, { avoid: 0.25, cost_time: 0.2, cost_money: price / 10000, habit: 0 });
    }
  }

  // 以前的挪动按新消息不再必要 → 恢复原安排；只是挪多了 → 缩小到所信时段，其余照原安排（v2）
  for (const d of [dayOf(t), dayOf(t) + 1]) {
    for (const it of a.plans[d] ?? []) {
      if (it.status !== 'planned' || it.origin?.family !== b.familyId || !it.origin.replaces || it.origin.reason === 'restore') continue;
      if (risks.some((r) => r.item.id === it.id) || candidates.some((c) => c.params.item === it.origin!.replaces)) continue;
      const orig = it.origin.orig;
      const origRisk = orig ? riskOverlap(map, { start: it.start, end: it.end, place: orig.place, needsPower: orig.needsPower }, b.slots, t) : 0;
      if (origRisk < 10 * 60) {
        add({ id: `restore:${it.id}`, kind: 'restore', label: `按新消息恢复原安排（${it.label}）`, params: { item: it.id, day: d } }, { avoid: 0, cost_time: 0, cost_money: 0, habit: 0.8 });
        continue;
      }
      if (!orig || it.origin.reason === 'org') continue;
      const [w0, w1] = windowInterval(b.slots.window);
      const from = Math.max(it.start, dayStart(d) + w0, t);
      const to = Math.min(it.end, dayStart(d) + w1);
      const extra = it.end - Math.max(it.start, t) - Math.max(0, to - from);
      if (to - from >= 10 * 60 && extra >= 30 * 60) {
        add({ id: `narrow:${it.id}`, kind: 'restore', label: `按新消息只在 ${clock(from)}–${clock(to)} ${it.label}，其余时间照原安排`, params: { item: it.id, day: d, narrow: true, from, to } }, { avoid: 0, cost_time: 0, cost_money: 0, habit: 0.8 });
      }
    }
  }

  const semanticRule = ruleSemantics(a, b, candidates, P);
  const options = Object.fromEntries(candidates.map((c) => [c.id, c.label]));
  const observation: Observation = {
    person: personObs(a),
    ...(a.memory?.length ? { pastExperience: a.memory.slice(-2).map((m) => m.text) } : {}),
    now: `${formatTime(t)} ${weekday(dayOf(t))}`,
    location: locationLabel(map, a),
    activity: a.act?.label ?? '空闲',
    belief: beliefObs(s, b),
    atRisk: risks.slice(0, 4).map((r) => ({ item: r.item.label, time: `${weekday(r.day)} ${hhmm(timeOfDay(r.item.start))}–${hhmm(timeOfDay(r.item.end))}`, place: map.places[r.item.place]?.name ?? r.item.place, overlapMin: Math.round(r.overlapSec / 60) })),
    options,
  };
  return { candidates, rejected, ruleFactors: rf, semanticRule, observation, observationHash: contentHash(observation).slice(0, 16), atRisk: risks };
}

/** 规则 provider 对语义因子的近似（Jev 失败时的回退也用它）；系数在 RuleParams.semantics */
export function ruleSemantics(a: Agent, b: Belief, candidates: Candidate[], P: RuleParams = DEFAULT_PARAMS): SemanticAnswer {
  const t = a.traits;
  const S = P.semantics;
  const raw: Record<string, number> = {};
  for (const c of candidates) {
    switch (c.kind) {
      case 'keep':
        raw[c.id] = S.keepBase + S.keepRisk * (1 - t.riskAversion) + S.keepCalm * (1 - t.anxiety);
        break;
      case 'verify':
        raw[c.id] = S.verifyBase + S.verifyDetail * t.detail + S.verifyDistrust * (1 - a.trustGov);
        break;
      case 'move':
        raw[c.id] = S.moveBase + S.moveRisk * t.riskAversion + S.moveOrder * t.order;
        break;
      case 'adapt':
        raw[c.id] = S.adaptBase + S.adaptOrder * t.order + S.adaptRisk * t.riskAversion;
        break;
      case 'service':
        raw[c.id] = S.serviceBase + S.serviceCommit * t.commitment + (String(c.params.mode) === 'closed_window' ? 0.2 * t.riskAversion : 0.1);
        break;
      case 'prepare':
        raw[c.id] = S.prepareBase + S.prepareRisk * t.riskAversion + S.prepareAnx * t.anxiety;
        break;
      case 'restore':
        raw[c.id] = S.restoreBase + S.restoreOrder * t.order;
        break;
      default:
        raw[c.id] = 0.3;
    }
  }
  const total = Object.values(raw).reduce((x, y) => x + y, 0) || 1;
  const fit = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, r3(v / total)]));
  const concern = concernOf(a, P);
  const verifyNeed = r3(clamp01((windowPrecision(b.slots.window) >= 3 ? S.verifyPrecise : S.verifyVague) + S.verifyNeedDetail * t.detail + S.verifyNeedDistrust * (1 - a.trustGov) - (b.slots.source === 'gov' && b.slots.certainty === 'confirmed' ? S.verifyOfficial : 0) + memoryEffect(a, P.memory.verify)));
  // 经历对“照不照做”的直接影响：只在规则心智里加（Jev 从观察里的过往经历自己判断）
  const keepBias = r3(Math.max(-0.4, Math.min(0.4, memoryEffect(a, P.memory.keep))));
  return { provider: 'rule', model: 'rule', callIds: [], fit, concern, verifyNeed, ...(keepBias ? { keepBias } : {}) };
}

/** 规则心智的“担心”：焦虑与风险厌恶，加上历次停电经历的影响 */
export function concernOf(a: Agent, P: RuleParams = DEFAULT_PARAMS): number {
  const S = P.semantics;
  return r3(clamp01(S.concernBase + S.concernAnx * a.traits.anxiety + S.concernRisk * a.traits.riskAversion + memoryEffect(a, P.memory.concern)));
}

export const lastExperience = (a: Agent): Experience | undefined => a.memory?.[a.memory.length - 1];

/** 经历记忆的效应按次数叠加（social_v3；依据：信任面板里“两次虚惊”≈ 两次单独的效应之和） */
export function memoryEffect(a: Agent, table: Record<ExperienceKind, number>): number {
  let x = 0;
  for (const m of a.memory ?? []) x += table[m.kind] ?? 0;
  return x;
}

export interface Scored {
  factors: Record<string, Record<string, FactorValue>>;
  utilities: Record<string, number>;
  probabilities: Record<string, number>;
  tau: number;
}

/** 显式效用 + softmax（原方案第 24 页）；w 由特质推出，τ 由秩序偏好推出 */
export function scoreReaction(a: Agent, b: Belief, candidates: Candidate[], ruleFactors: Record<string, Record<string, FactorValue>>, sem: SemanticAnswer, verifiedToday: boolean, P: RuleParams = DEFAULT_PARAMS): Scored {
  const src = (k: string) => (sem.provider === 'rule' ? `rule:${k}` : sem.fallback ? `fallback:${sem.fallback}` : `model:${sem.callIds[0] ?? 'jev'}`);
  const D = P.decision;
  const order = a.traits.order;
  const concern = sem.concern ?? 0.4;
  const verifyNeed = sem.verifyNeed ?? 0.3;
  const factors: Record<string, Record<string, FactorValue>> = {};
  const utilities: Record<string, number> = {};
  for (const c of candidates) {
    const f = ruleFactors[c.id] ?? {};
    const v = (k: string) => f[k]?.value ?? 0;
    const fit = sem.fit?.[c.id] ?? 1 / candidates.length;
    factors[c.id] = { ...f, fit: { value: r3(fit), source: src('fit') }, concern: { value: r3(concern), source: src('concern') }, verify_need: { value: r3(verifyNeed), source: src('verify_need') } };
    let u: number;
    switch (c.kind) {
      case 'keep':
        u = D.keep * (0.5 + order) + D.fit * fit + (sem.keepBias ?? 0);
        if (sem.keepBias) factors[c.id]!.keep_bias = { value: sem.keepBias, source: 'rule:memory' };
        break;
      case 'verify':
        u = D.verify * verifyNeed - 0.4 * v('cost_time') + D.fit * fit - (verifiedToday ? 0.6 : 0);
        break;
      case 'restore':
        u = 0.6 * (0.5 + order) + D.fit * fit;
        break;
      case 'prepare':
        u = 1.2 * v('avoid') * (D.concernBase + concern) * b.confidence - D.costMoney * v('cost_money') + D.fit * fit;
        break;
      default:
        u = D.avoid * v('avoid') * (D.concernBase + concern) * b.confidence - D.costTime * v('cost_time') - D.costMoney * v('cost_money') + D.fit * fit;
    }
    utilities[c.id] = r3(u);
  }
  const tau = r3(D.tauBase + D.tauOrder * (1 - order));
  return { factors, utilities, probabilities: softmax(utilities, tau), tau };
}

export function softmax(u: Record<string, number>, tau: number): Record<string, number> {
  const keys = Object.keys(u);
  const max = Math.max(...keys.map((k) => u[k]!));
  const exps = keys.map((k) => Math.exp((u[k]! - max) / tau));
  const sum = exps.reduce((x, y) => x + y, 0);
  return Object.fromEntries(keys.map((k, i) => [k, r3(exps[i]! / sum)]));
}

// ---------- notify：要不要主动给不在身边的亲友发消息 ----------

export interface NotifyBuild {
  candidates: Candidate[];
  rejected: Rejected[];
  ruleFactors: Record<string, Record<string, FactorValue>>;
  semanticRule: SemanticAnswer;
  observation: Observation;
  observationHash: string;
}

export function buildNotify(s: WorldState, map: TownMap, a: Agent, b: Belief, t: SimTime, P: RuleParams = DEFAULT_PARAMS): NotifyBuild {
  const candidates: Candidate[] = [{ id: 'skip', kind: 'keep', label: '不特意通知谁', params: {} }];
  const rejected: Rejected[] = [];
  const rf: Record<string, Record<string, FactorValue>> = { skip: {} };
  const told = new Set(a.told[b.familyId] ?? []);
  const here = a.loc.k === 'in' ? a.loc.place : undefined;
  const contacts: NonNullable<Observation['contacts']> = [];
  for (const { id, rel } of contactsOf(s, a.id)) {
    const c = s.agents[id];
    if (!c) continue;
    const label = `给${c.name}发消息提醒`;
    if (rel.strength < 0.6) continue;
    if (c.householdId === a.householdId) {
      continue; // 同住的人当面说
    }
    if (told.has(id)) {
      rejected.push({ id: `dm:${id}`, label, reason: '已经告诉过' });
      continue;
    }
    if (here && c.loc.k === 'in' && c.loc.place === here) {
      rejected.push({ id: `dm:${id}`, label, reason: '就在身边，当面说' });
      continue;
    }
    const rel2 = relevanceOf(s, map, c, b.slots, t);
    if (rel2.area < 0.6) {
      rejected.push({ id: `dm:${id}`, label, reason: '跟对方关系不大' });
      continue;
    }
    candidates.push({ id: `dm:${id}`, kind: 'dm', label, params: { to: id } });
    rf[`dm:${id}`] = {
      tie: { value: rel.strength, source: 'rule:tie' },
      contact_relevance: { value: r3(rel2.score), source: 'rule:relevance' },
    };
    contacts.push({ id, name: c.name, relation: rel.note ?? relLabel(rel.kind), livesOrWorksInArea: rel2.area >= 1 });
  }
  const t2 = a.traits;
  const S = P.semantics;
  const wouldMessage = Object.fromEntries(candidates.filter((c) => c.kind === 'dm').map((c) => [c.id, r3(clamp01(S.msgBase + S.msgAltruism * t2.altruism + S.msgTie * (rf[c.id]?.tie?.value ?? 0.5)))]));
  const observation: Observation = {
    person: personObs(a),
    ...(a.memory?.length ? { pastExperience: a.memory.slice(-2).map((m) => m.text) } : {}),
    now: `${formatTime(t)} ${weekday(dayOf(t))}`,
    location: locationLabel(map, a),
    activity: a.act?.label ?? '空闲',
    belief: beliefObs(s, b),
    atRisk: [],
    options: Object.fromEntries(candidates.map((c) => [c.id, c.label])),
    contacts,
  };
  return {
    candidates,
    rejected,
    ruleFactors: rf,
    semanticRule: { provider: 'rule', model: 'rule', callIds: [], wouldMessage, concern: concernOf(a, P) },
    observation,
    observationHash: contentHash(observation).slice(0, 16),
  };
}

const relLabel = (k: string) => (k === 'family' ? '家人' : k === 'friend' ? '朋友' : k === 'coworker' ? '同事' : '邻居');

/** 每个联系人独立判断：P = sigmoid(利他 + 关系 + 对方相关性 + 担心 + 语义“会发消息”) */
export function scoreNotify(a: Agent, candidates: Candidate[], ruleFactors: Record<string, Record<string, FactorValue>>, sem: SemanticAnswer): Scored {
  const src = (k: string) => (sem.provider === 'rule' ? `rule:${k}` : sem.fallback ? `fallback:${sem.fallback}` : `model:${sem.callIds[0] ?? 'jev'}`);
  const factors: Record<string, Record<string, FactorValue>> = {};
  const utilities: Record<string, number> = {};
  const probabilities: Record<string, number> = {};
  const concern = sem.concern ?? 0.4;
  for (const c of candidates) {
    if (c.kind !== 'dm') continue;
    const f = ruleFactors[c.id] ?? {};
    const wm = sem.wouldMessage?.[c.id] ?? 0.5;
    factors[c.id] = { ...f, altruism: { value: a.traits.altruism, source: 'rule:trait' }, concern: { value: r3(concern), source: src('concern') }, would_message: { value: r3(wm), source: src('would_message') } };
    const x = -3.4 + 1.6 * a.traits.altruism + 1.2 * (f.tie?.value ?? 0.5) + 1.2 * (f.contact_relevance?.value ?? 0.5) + 0.8 * concern + 2.4 * (wm - 0.5);
    utilities[c.id] = r3(x);
    probabilities[c.id] = r3(sigmoid(x));
  }
  return { factors, utilities, probabilities, tau: 1 };
}
