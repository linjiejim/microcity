import { randomUUID } from 'node:crypto';
import {
  applyPatches,
  beliefCensus,
  contentHash,
  dayStart,
  describeBranch,
  describeEvent,
  formatTime,
  funnelMetrics,
  outcomeMetrics,
  patchesOf,
  personCard,
  STOP_LABEL,
  timeToShare,
  townStats,
  trustSummary,
  CARD_STAGE_TEXT,
  type BranchSpec,
  type ExperimentManifest,
  type FunnelStop,
  type OutageEventSpec,
  type ScenarioDef,
  type WorldState,
} from '@microcity/sim';
import { config, hasModelAccess } from './config.ts';
import type { Store } from './db.ts';
import type { Analysis } from './analysis.ts';
import { METRIC_DEFS, TRUST_DEFS, type ExperimentResult } from './experiments.ts';
import type { ChatClient } from './providers/chat.ts';
import type { RunManager } from './runs.ts';

/** 报告模板版本：改提示或事实表结构必须升版本 */
export const REPORT_TEMPLATE_VERSION = 'report_tpl_v2';

export interface Fact {
  id: string;
  text: string;
}
export interface FactGroup {
  key: 'setup' | 'timeline' | 'outcome' | 'society' | 'stories' | 'compare' | 'caveat';
  title: string;
  facts: Fact[];
}
export interface FactSheet {
  subject: { kind: 'run' | 'experiment'; id: string; name: string; at: string };
  groups: FactGroup[];
  people: string[];
}

export interface Report {
  title: string;
  summary: string;
  findings: Array<{ text: string; cites: string[] }>;
  stories: Array<{ person: string; text: string; cites: string[] }>;
  socialChange: { text: string; cites: string[] };
  caveats: string[];
}

export interface ReportView {
  id: string;
  subject: string;
  source: 'model' | 'template';
  model: string;
  report: Report;
  facts: FactSheet;
  validation: { ok: boolean; problems: string[]; attempts: number } | null;
  cost: number;
  createdAt: string;
}

const dur = (sec: number | null | undefined): string => {
  if (sec === null || sec === undefined) return '未达到';
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} 小时 ${m % 60} 分钟` : `${h} 小时`;
};
const pct = (x: number) => `${Math.round(x * 100)}%`;
const area = (a: string) => (a === 'north' ? '北区' : '南区');

class Facts {
  private n = 0;
  groups: FactGroup[] = [];
  group(key: FactGroup['key'], title: string): (text: string) => void {
    const g: FactGroup = { key, title, facts: [] };
    this.groups.push(g);
    return (text: string) => {
      g.facts.push({ id: `F${++this.n}`, text });
    };
  }
}

/** 这条运行实际用的事件（分支补丁 / 不发通知） */
function effectiveEvents(sc: ScenarioDef, manifest: string | null): OutageEventSpec[] {
  try {
    const m = manifest ? (JSON.parse(manifest) as { branch?: BranchSpec | null; script?: string; label?: string; patches?: unknown }) : {};
    if (m.script === 'quiet') return sc.events.map((e) => ({ ...e, notice: null, clarify: null }));
    const spec = (m.branch ?? (m.label ? (m as BranchSpec) : undefined)) as BranchSpec | undefined;
    if (spec) return applyPatches(sc.events, patchesOf(spec, sc.events));
  } catch {
    /* 清单缺失时按场景原剧本 */
  }
  return sc.events;
}

export function runFacts(runs: RunManager, analysis: Analysis, runId: string): FactSheet {
  const run = runs.get(runId)!;
  run.flush();
  const sc = run.engine.scenario;
  const s = run.engine.state;
  const row = run.row;
  const map = run.engine.map;
  const F = new Facts();
  const st = townStats(sc);
  const setup = F.group('setup', '实验设置');
  setup(`小镇“${sc.name}”：${st.population} 人（北区 ${st.districts.north} 人、南区 ${st.districts.south} 人），${st.households} 户；60 岁以上 ${st.ages.senior} 人，30 岁以下 ${st.ages.youth} 人。`);
  setup(`媒介：${pct(st.push)} 的人订阅政务推送，${pct(st.website)} 的人常看镇网站，公告栏 ${st.boards} 块。`);
  setup(`人群：对官方通知的平均信任 ${st.trustGov}，平均焦虑 ${st.anxiety}，人均 ${st.friends} 个朋友。`);
  const events = effectiveEvents(sc, row.manifest);
  for (const e of events) setup(`剧本：${describeEvent(e)}。`);
  setup(`决策方式：${row.provider === 'jev' ? 'Jev 给语义因子，规则算效用后抽样' : '全部用规则因子'}；随机种子 ${row.seed}；截至 ${formatTime(s.meta.t)}。`);

  const tl = F.group('timeline', '关键时刻');
  const beats = analysis.chronicle(runId, 'key');
  const pick = beats.length > 16 ? [...beats.slice(0, 10), ...beats.slice(-6)] : beats;
  for (const b of pick) tl(`${formatTime(b.t)} ${b.title}${b.detail ? `（${b.detail}）` : ''}`);

  const out = F.group('outcome', '结果');
  const hist = runs.history(runId);
  for (const o of sc.outages) {
    const start = dayStart(o.day) + o.from;
    if (s.meta.t < start - 6 * 3600) continue;
    const label = `${area(o.area)} D${String(o.day).padStart(2, '0')} ${formatTime(start).slice(4)} 那轮停电`;
    const atStart = s.meta.t >= start ? runs.stateAt(runId, runs.seqAtTime(runId, start)) : undefined;
    const c = beliefCensus(atStart ?? s, o.family);
    const N = Object.keys(s.agents).length;
    out(`${label}：${atStart ? '停电开始时' : '此刻'} ${c.aware}/${N} 人已知情，其中 ${c.exact} 人知道精确时段、${c.coarse} 人只知道大概、${c.allDay} 人以为“全天”、${c.unknownWindow} 人不清楚时间。`);
    const f = funnelMetrics(s, o.family);
    const first = Math.min(...Object.values(s.news).filter((n) => n.familyId === o.family).map((n) => n.publishedAt), ...Object.values(s.versions).filter((v) => v.familyId === o.family).map((v) => v.createdAt));
    if (Number.isFinite(first)) out(`${label}：从第一条消息出现起，半数人相信用了 ${dur(timeToShare(f, 0.5, first))}，八成人相信用了 ${dur(timeToShare(f, 0.8, first))}。`);
    out(`${label}：${f.stages.intended} 人因此改了安排，${f.stages.relayed} 人把消息告诉了别人。`);
    const stops = (Object.entries(f.stops) as Array<[FunnelStop, number]>).filter(([, n]) => n > 0).map(([k, n]) => `${STOP_LABEL[k]} ${n} 人`);
    if (stops.length) out(`${label}：停在漏斗各处的人——${stops.join('、')}。`);
    if (s.meta.t >= start) {
      const oc = outcomeMetrics(s, o.id);
      out(`${label}：停电影响了 ${oc.affectedPeople} 人的安排，其中 ${oc.surprisedPeople} 人措手不及（合计 ${oc.surprisedMin} 分钟）；真实停电窗口之外被挪走的安排合计 ${oc.overreactMin} 分钟。`);
    }
    const vs = Object.values(s.versions).filter((v) => v.familyId === o.family);
    const rumor = vs.filter((v) => v.slots.window?.kind === 'all_day');
    out(`${label}：这件事在人群里出现了 ${vs.length} 个版本，其中 ${rumor.length} 个把时段说成了“全天”。`);
  }

  const soc = F.group('society', '社会形态');
  const ts = trustSummary(s);
  soc(`对官方通知的平均信任：${ts.govMean0} → ${ts.govMean}（${ts.govUp} 人上升、${ts.govDown} 人下降）。`);
  soc(`人际信任：${ts.tiesUp} 段关系的信任上升，${ts.tiesDown} 段下降。`);
  const told = Object.values(s.agents)
    .map((a) => ({ a, n: Object.values(a.told).reduce((x, y) => x + y.length, 0) }))
    .filter((x) => x.n > 0)
    .sort((x, y) => y.n - x.n || x.a.id.localeCompare(y.a.id));
  if (told.length) soc(`传话最多的人：${told.slice(0, 3).map((x) => `${x.a.name}（告诉了 ${x.n} 人）`).join('、')}。`);
  const rumorMakers = [...new Set(Object.values(s.versions).filter((v) => v.mutations.some((m) => m.op === 'fill_worst_case')).map((v) => s.agents[v.origin.by]?.name ?? v.origin.by))];
  if (rumorMakers.length) soc(`把时段补成“全天”的人：${rumorMakers.join('、')}。`);
  const hh = new Map(Object.values(s.agents).map((a) => [a.id, map.places[a.home]?.district]));
  const tx = hist.filter((e) => e.type === 'transmission');
  const cross = tx.filter((e) => e.type === 'transmission' && hh.get(e.tr.from) !== hh.get(e.tr.to)).length;
  soc(`转述共 ${tx.length} 次，其中跨区（北区↔南区）${cross} 次。`);
  const govDrops = hist.filter((e) => e.type === 'trust_changed' && e.target === 'gov' && e.to < e.from);
  if (govDrops.length) soc(`对官方信任下降的原因：${[...new Set(govDrops.map((e) => (e.type === 'trust_changed' ? e.reason : '')))].slice(0, 3).join('；')}。`);

  const stories = F.group('stories', '个体故事');
  const people = storyPeople(s, sc, hist);
  const fam = sc.outages[0]?.family ?? '';
  for (const id of people) {
    const a = s.agents[id]!;
    const c = personCard(s, map, id, fam, s.meta.t, sc.outages[0]);
    const bits = [`${a.name}（${a.age} 岁，${a.roleLabel}，住${area(c.district)}）`, `阶段：${CARD_STAGE_TEXT[c.stage]}`];
    if (c.belief) bits.push(`相信「${c.belief.text}」（${c.belief.via}，置信 ${c.belief.confidence}）`);
    if (c.changes.length) bits.push(`改了安排：${c.changes.slice(0, 2).join('、')}`);
    if (c.told) bits.push(`告诉了 ${c.told} 人`);
    if (c.surprised) bits.push('停电时措手不及');
    if (c.overreactMin) bits.push(`过度调整 ${c.overreactMin} 分钟`);
    if (Math.abs(c.trustGov - c.trustGov0) >= 0.005) bits.push(`对官方信任 ${c.trustGov0} → ${c.trustGov}`);
    stories(`${bits.join('；')}。此刻的想法：“${c.thought.text}”`);
  }

  const cav = F.group('caveat', '边界');
  cav('这是合成人物的实验沙盘，不是现实预测器；参数是模型设定，未经现实数据校准。');
  cav('单次运行只是一条合成轨迹，结论要看多个随机种子的分布。');
  return { subject: { kind: 'run', id: runId, name: row.name, at: formatTime(s.meta.t) }, groups: F.groups, people: Object.values(s.agents).map((a) => a.name) };
}

/** 个体故事挑谁：第一个相信的、谣言源头、措手不及的、过度调整最多的、传话最多的、对官方信任下降最多的 */
function storyPeople(s: WorldState, sc: ScenarioDef, hist: ReturnType<RunManager['history']>): string[] {
  const out: string[] = [];
  const add = (id?: string) => {
    if (id && !out.includes(id) && s.agents[id] && out.length < 4) out.push(id);
  };
  const fam = sc.outages[0]?.family;
  const firstBelief = hist.find((e) => e.type === 'belief_set' && e.family === fam && e.belief.status === 'believe');
  add(firstBelief?.type === 'belief_set' ? firstBelief.agent : undefined);
  const rumor = Object.values(s.versions).find((v) => v.mutations.some((m) => m.op === 'fill_worst_case'));
  add(rumor?.origin.by);
  add(Object.values(s.agents).find((a) => a.stats.surprised > 0)?.id);
  add(Object.values(s.agents).sort((a, b) => b.stats.overreactSec - a.stats.overreactSec)[0]?.stats.overreactSec ? Object.values(s.agents).sort((a, b) => b.stats.overreactSec - a.stats.overreactSec)[0]!.id : undefined);
  add(Object.values(s.agents).sort((a, b) => Object.values(b.told).flat().length - Object.values(a.told).flat().length)[0]?.id);
  add(Object.values(s.agents).sort((a, b) => a.trustGov - a.traits.trustOfficial - (b.trustGov - b.traits.trustOfficial))[0]?.id);
  return out;
}

export function experimentFacts(runs: RunManager, analysis: Analysis, exp: { id: string; manifest: ExperimentManifest; result: ExperimentResult }): FactSheet {
  const m = exp.manifest;
  const r = exp.result;
  const sc = runs.scenarios.require(m.scenario);
  const F = new Facts();
  const st = townStats(sc);
  const setup = F.group('setup', '实验设置');
  setup(`小镇“${sc.name}”：${st.population} 人（北区 ${st.districts.north} 人、南区 ${st.districts.south} 人）；${pct(st.push)} 订阅推送，${pct(st.website)} 常看网站，公告栏 ${st.boards} 块；对官方的平均信任 ${st.trustGov}。`);
  for (const e of sc.events) setup(`原剧本：${describeEvent(e)}。`);
  const names = Object.keys(r.branches);
  setup(`对照分支：${names.map((k) => `${k}「${r.branches[k]!.label}」`).join('、')}；分叉点 ${formatTime(r.forkT)}，每个分支跑到 ${m.until}。`);
  setup(`随机种子 ${r.seeds.length} 个（${r.seeds.join('、')}）；决策方式：${m.provider === 'jev' ? 'Jev 语义因子' : '规则因子'}。参照分支：${r.reference}。`);
  for (const k of names) {
    const ch = r.branches[k]!.changes ?? [];
    if (ch.length) setup(`分支 ${k} 改动：${ch.join('；')}${r.branches[k]!.scenario !== m.scenario ? '（换了一座镇，从头跑）' : ''}。`);
  }
  const global = m.params ? describeBranch({ label: '', params: m.params }) : [];
  if (global.length) setup(`所有分支共用的规则参数覆盖：${global.join('；')}。`);

  const cmp = F.group('compare', '分支对照');
  const fmt = (unit: string, v: number | null) => (v === null ? '—' : unit === 'sec' ? dur(v) : unit === 'min' ? `${Math.round(v)} 分钟` : unit === 'person' ? `${v} 人` : `${v}`);
  for (const o of r.outages) {
    const label = `${area(o.area)} D${String(o.day).padStart(2, '0')} 那轮`;
    for (const k of names) {
      const stt = r.stats[k]!;
      const parts = METRIC_DEFS.filter((d) => ['t50', 'aware', 'allDay', 'allDayEver', 'surprisedPeople', 'overreactMin', 'intendedOutside'].includes(d.key)).map((d) => {
        const x = stt[`${o.id}.${d.key}`];
        if (!x) return '';
        const iqr = r.seeds.length > 1 && x.p25 !== null && x.p75 !== null ? `（四分位 ${fmt(d.unit, x.p25)}–${fmt(d.unit, x.p75)}）` : '';
        const miss = x.missing ? `，${x.missing} 个 seed 未达到` : '';
        return `${d.label}${r.seeds.length > 1 ? '中位数' : ''} ${fmt(d.unit, x.median)}${iqr}${miss}`;
      });
      cmp(`${label} · 分支 ${k}「${r.branches[k]!.label}」：${parts.filter(Boolean).join('；')}。`);
    }
    if (r.seeds.length > 1) {
      for (const k of names.filter((x) => x !== r.reference)) {
        const lines = METRIC_DEFS.filter((d) => d.better && ['t50', 'surprisedPeople', 'allDay', 'overreactMin'].includes(d.key)).map((d) => {
          const p = r.paired[k]?.[`${o.id}.${d.key}`];
          return p ? `${d.label}在 ${p.better}/${r.seeds.length} 个 seed 里更好、${p.worse} 个更差` : '';
        });
        cmp(`${label} · 分支 ${k} 相比参照 ${r.reference}：${lines.filter(Boolean).join('；')}。`);
      }
    }
  }
  const soc = F.group('society', '社会形态');
  for (const k of names) {
    const g = r.stats[k]!['trust.govDelta'];
    const t = r.stats[k]!['trust.tiesDown'];
    soc(`分支 ${k}：对官方信任的平均变化${r.seeds.length > 1 ? '中位数' : ''} ${g?.median ?? '—'}；信任下降的关系${r.seeds.length > 1 ? '中位数' : ''} ${t?.median ?? '—'} 段。`);
  }
  void TRUST_DEFS;
  const tl = F.group('timeline', '关键时刻（第一个 seed）');
  for (const k of [r.reference, ...names.filter((x) => x !== r.reference)].slice(0, 2)) {
    const rid = r.branches[k]!.runId;
    if (!rid) continue;
    for (const b of analysis.chronicle(rid, 'key').filter((x) => x.t >= r.forkT).slice(0, 7)) tl(`分支 ${k} · ${formatTime(b.t)} ${b.title}`);
  }
  const cav = F.group('caveat', '边界');
  cav('这是合成人物的实验沙盘，不是现实预测器；分支差异是“这个模型下的差异”，不是现实政策效应。');
  cav(r.seeds.length > 1 ? `结论基于 ${r.seeds.length} 个随机种子；种子少时分布仍有噪声。` : '只有 1 个随机种子，差异可能是偶然，建议多跑几个 seed。');
  return { subject: { kind: 'experiment', id: exp.id, name: m.name, at: m.until }, groups: F.groups, people: [] };
}

// ---------------------------------------------------------------- 校验

const NUM_RE = /\d+(?:\.\d+)?/g;
const TIME_RE = /\d{1,2}[:：]\d{2}/g;

function allowedTokens(facts: FactSheet): { nums: Set<string>; times: Set<string>; text: string; ids: Set<string> } {
  const text = facts.groups.flatMap((g) => g.facts.map((f) => f.text)).join('\n');
  const nums = new Set<string>();
  for (const m of text.matchAll(NUM_RE)) {
    nums.add(String(Number(m[0])));
  }
  // 事实里的计数允许说成百分比（基数为总人口或 seed 数）
  const times = new Set([...text.matchAll(TIME_RE)].map((m) => m[0].replace('：', ':').replace(/^0(\d):/, '$1:')));
  const ids = new Set(facts.groups.flatMap((g) => g.facts.map((f) => f.id)));
  for (const n of [0, 1, 2, 3]) nums.add(String(n));
  return { nums, times, text, ids };
}

/** 报告必须以事实表为界（spec v1 §2.8，D27）：数字、时刻、人名、引用、“全天” */
export function validateReport(r: unknown, facts: FactSheet): { report?: Report; problems: string[] } {
  const problems: string[] = [];
  const x = r as Partial<Report> | undefined;
  if (!x || typeof x !== 'object') return { problems: ['不是 JSON 对象'] };
  const str = (v: unknown, max: number, what: string): string => {
    if (typeof v !== 'string' || !v.trim()) {
      problems.push(`${what} 缺失`);
      return '';
    }
    if (v.length > max) problems.push(`${what} 太长（${v.length} 字）`);
    return v.trim();
  };
  const cites = (v: unknown, what: string, ids: Set<string>): string[] => {
    const arr = Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string') : [];
    if (arr.length === 0) problems.push(`${what} 没有引用事实`);
    for (const c of arr) if (!ids.has(c)) problems.push(`${what} 引用了不存在的 ${c}`);
    return arr.filter((c) => ids.has(c));
  };
  const tok = allowedTokens(facts);
  const checkText = (t: string, what: string) => {
    for (const m of t.matchAll(TIME_RE)) {
      const tt = m[0].replace('：', ':').replace(/^0(\d):/, '$1:');
      if (!tok.times.has(tt)) problems.push(`${what} 出现了事实里没有的时刻 ${m[0]}`);
    }
    const noTimes = t.replace(TIME_RE, ' ').replace(/D\d{2}/g, ' ').replace(/F\d+/g, ' ');
    for (const m of noTimes.matchAll(NUM_RE)) {
      if (!tok.nums.has(String(Number(m[0])))) problems.push(`${what} 出现了事实里没有的数字 ${m[0]}`);
    }
    if (/全天|一整天/.test(t) && !/全天|一整天/.test(tok.text)) problems.push(`${what} 凭空出现“全天”`);
  };
  const title = str(x.title, 40, '标题');
  const summary = str(x.summary, 220, '摘要');
  checkText(summary, '摘要');
  const findings = Array.isArray(x.findings) ? x.findings : [];
  if (findings.length < 2 || findings.length > 7) problems.push(`发现应为 2–7 条（实际 ${findings.length}）`);
  const fOut = findings.slice(0, 7).map((f, i) => {
    const text = str(f?.text, 180, `发现 ${i + 1}`);
    checkText(text, `发现 ${i + 1}`);
    return { text, cites: cites(f?.cites, `发现 ${i + 1}`, tok.ids) };
  });
  const stories = Array.isArray(x.stories) ? x.stories : [];
  const sOut = stories.slice(0, 4).map((s, i) => {
    const person = typeof s?.person === 'string' ? s.person.trim() : '';
    if (facts.people.length && !facts.people.includes(person)) problems.push(`故事 ${i + 1} 的人物“${person}”不存在`);
    const text = str(s?.text, 200, `故事 ${i + 1}`);
    checkText(text, `故事 ${i + 1}`);
    return { person, text, cites: cites(s?.cites, `故事 ${i + 1}`, tok.ids) };
  });
  const sc = x.socialChange as { text?: unknown; cites?: unknown } | undefined;
  const scText = str(sc?.text, 220, '社会变化');
  checkText(scText, '社会变化');
  const scOut = { text: scText, cites: cites(sc?.cites, '社会变化', tok.ids) };
  const cav = Array.isArray(x.caveats) ? x.caveats.filter((c): c is string => typeof c === 'string').slice(0, 4) : [];
  if (cav.length === 0) problems.push('缺少边界说明');
  for (const [i, c] of cav.entries()) checkText(c, `边界 ${i + 1}`);
  if (problems.length) return { problems };
  return { report: { title, summary, findings: fOut, stories: sOut, socialChange: scOut, caveats: cav }, problems };
}

/** 模板报告：直接复述事实表（离线或模型输出未通过校验时用） */
export function templateReport(facts: FactSheet): Report {
  const g = (k: FactGroup['key']) => facts.groups.filter((x) => x.key === k).flatMap((x) => x.facts);
  const outcome = [...g('outcome'), ...g('compare')];
  const society = g('society');
  return {
    title: `${facts.subject.name}：实验报告`,
    summary: outcome
      .slice(0, 2)
      .map((f) => f.text)
      .join(''),
    findings: [...outcome.slice(0, 5), ...society.slice(0, 1)].map((f) => ({ text: f.text, cites: [f.id] })),
    stories: g('stories').map((f) => ({ person: /^([^（]+)（/.exec(f.text)?.[1] ?? '', text: f.text, cites: [f.id] })),
    socialChange: { text: society.map((f) => f.text).join(''), cites: society.map((f) => f.id) },
    caveats: g('caveat').map((f) => f.text),
  };
}

const SYSTEM = `你是社会模拟实验的研究助理。下面是一份“事实表”，来自一座合成小镇的事件日志，每条事实都有 id（F1、F2…）。
请写一份简洁的中文实验报告，帮研究者看懂：消息怎样传播、个体怎样反应、社会形态（信任、关系）怎样变化、不同条件下结果有何不同。
硬性规则：
1) 只能使用事实表里的信息。任何数字、时刻、人名都必须原样出自事实表；不要自己计算新的百分比或比例；不要推测事实表之外的原因。
2) 每条发现、故事、社会变化都要用 cites 标出所依据的事实 id。
3) 语言平实，不夸大；把“这个模型下的结果”说清楚，不要说成现实规律。
输出严格 JSON：{"title":"≤20字","summary":"≤120字，3 句以内","findings":[{"text":"≤80字的一条发现","cites":["F3"]}]（3–6 条）,"stories":[{"person":"人名","text":"≤90字","cites":["F20"]}]（0–3 条）,"socialChange":{"text":"≤120字","cites":["F12"]},"caveats":["≤60字"]（1–3 条）}`;

export class Reporter {
  constructor(
    private store: Store,
    private chat: ChatClient,
  ) {}

  latest(subject: string): ReportView | undefined {
    const r = this.store.latestReport(subject);
    if (!r) return undefined;
    return { id: r.id, subject, source: r.source as ReportView['source'], model: r.model, report: r.content as Report, facts: r.facts as FactSheet, validation: r.validation as ReportView['validation'], cost: r.cost_usd, createdAt: r.created_at };
  }

  async generate(subject: string, facts: FactSheet, runId: string | null, opts: { force?: boolean } = {}): Promise<ReportView> {
    const factHash = contentHash({ tpl: REPORT_TEMPLATE_VERSION, facts: facts.groups }).slice(0, 16);
    const model = hasModelAccess() ? config.genModel : 'template';
    if (!opts.force) {
      const hit = this.store.reportByHash(subject, factHash, model);
      if (hit) return { id: hit.id, subject, source: hit.source as ReportView['source'], model: hit.model, report: hit.content as Report, facts: hit.facts as FactSheet, validation: hit.validation as ReportView['validation'], cost: hit.cost_usd, createdAt: hit.created_at };
    }
    let report: Report | undefined;
    let source: ReportView['source'] = 'template';
    let usedModel = 'template';
    let cost = 0;
    let validation: ReportView['validation'] = null;
    if (hasModelAccess()) {
      const factsText = JSON.stringify({ subject: facts.subject, groups: facts.groups.map((g) => ({ 类别: g.title, 事实: g.facts })) });
      const messages = [
        { role: 'system' as const, content: SYSTEM },
        { role: 'user' as const, content: factsText },
      ];
      let problems: string[] = [];
      let attempts = 0;
      for (; attempts < 2 && !report; attempts++) {
        const res = await this.chat.json<unknown>({
          runId,
          purpose: 'report',
          tpl: REPORT_TEMPLATE_VERSION,
          temperature: attempts === 0 ? 0.3 : 0.1,
          maxTokens: 2000,
          cache: !opts.force,
          accept: (d) => !!validateReport(d, facts).report,
          messages: attempts === 0 ? messages : [...messages, { role: 'user' as const, content: `上一版没有通过校验：${problems.slice(0, 8).join('；')}。请只用事实表里的数字和名字重写，JSON 格式不变。` }],
        });
        cost += res.cost;
        if (!res.ok) {
          problems = [res.error];
          continue;
        }
        usedModel = res.model;
        const v = validateReport(res.data, facts);
        problems = v.problems;
        if (v.report) report = v.report;
      }
      validation = { ok: !!report, problems, attempts };
      if (report) source = 'model';
    }
    if (!report) {
      report = templateReport(facts);
      usedModel = 'template';
    }
    const id = `rp_${randomUUID().slice(0, 8)}`;
    this.store.saveReport({ id, subject, factHash, model: source === 'model' ? usedModel : model, source, content: report, facts, validation, cost });
    return { id, subject, source, model: usedModel, report, facts, validation, cost, createdAt: new Date().toISOString() };
  }
}
