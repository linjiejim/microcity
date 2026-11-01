// C4 信任面板：让 Jev 扮演经典小镇的 30 位居民，设想上一次停电时的不同经历，回答信任与行为问题
// 用法：node --import tsx --no-warnings scripts/lab/panel.ts [run|analyze]（dev 服务要先停）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS, r3, town30, type PersonDef } from '@microcity/sim';
import { askJev, pmap, type JevAnswer } from './jev-call.ts';
import { openLab } from './lab-db.ts';

const TPL = 'panel_v1';
const RAW = 'data/lab/c4-panel.json';
const SUMMARY = 'docs/experiments/results/c4-trust-panel.json';

const WORD = (x: number) => (x >= 0.75 ? 'high' : x >= 0.45 ? 'medium' : 'low');
function person(p: PersonDef) {
  const t = p.traits;
  return {
    name: p.name,
    age: p.age,
    role: p.roleLabel,
    bio: p.bio,
    traits: {
      anxiety: WORD(t.anxiety),
      risk_aversion: WORD(t.riskAversion),
      sociability: WORD(t.sociability),
      orderliness: WORD(t.order),
      curiosity: WORD(t.curiosity),
      trust_in_official_notices: WORD(t.trustOfficial),
      attention_to_detail: WORD(t.detail),
    },
  };
}

const CONTEXT = 'They live in a small riverside town. The town government announces planned power cuts (for line maintenance) on the town website, by phone push notification and on street notice boards. Neighbours and friends also pass such news along by word of mouth.';

/** 经历：gov 类问对官方的信任，relay 类问对那位朋友的信任 */
export const VIGNETTES: Array<{ id: string; kind: 'gov' | 'relay'; rule?: string; text: string }> = [
  { id: 'V0', kind: 'gov', text: 'Nothing notable: there has been no power cut in their area recently.' },
  { id: 'V1', kind: 'gov', rule: 'surprisedUninformed', text: 'Last week the power in their area was cut for two hours in the afternoon. No official notice reached them beforehand, and the outage interrupted what they were doing.' },
  { id: 'V2', kind: 'gov', rule: 'surprisedInformed', text: 'Last week the town announced a power cut in their area. They saw the notice but did not get the time right, so the two-hour outage still interrupted what they were doing.' },
  { id: 'V3', kind: 'gov', rule: 'accurateNotice', text: 'Last week the town announced a power cut in their area for 14:00–16:00. They read the notice, planned around it, and the outage happened exactly as announced.' },
  { id: 'V4', kind: 'gov', rule: 'vagueHeadline', text: 'Last week the town notice headline only said the power in their area would be cut "in the afternoon". They rearranged their whole afternoon, but the outage actually lasted only two hours (14:00–16:00).' },
  { id: 'V5', kind: 'gov', rule: 'clarification', text: 'Last week the first town notice about a power cut in their area was vague ("in the afternoon"), but the same day the town issued a clarification with the exact time (14:00–16:00), and it happened as clarified.' },
  // v3：虚惊（经典案例“狼来了”，预注册见 docs/experiments/20260929-classic-cases.md §3.2）
  { id: 'V6', kind: 'gov', rule: 'falseAlarmCostly', text: 'Last week the town announced a power cut in their area for 14:00–16:00. They rearranged their plans for it, but the power was never cut.' },
  { id: 'V7', kind: 'gov', rule: 'falseAlarm', text: 'Last week the town announced a power cut in their area for 14:00–16:00, but the power was never cut. It did not affect their plans.' },
  { id: 'V8', kind: 'gov', text: 'In the past two weeks the town twice announced power cuts in their area, and both times the power was never cut. The first time they rearranged their plans for nothing.' },
  { id: 'R0', kind: 'relay', text: 'A friend of theirs (a neighbour) often passes on local news. Nothing notable has happened recently.' },
  { id: 'R1', kind: 'relay', rule: 'relayAllDay', text: 'Last week a friend of theirs (a neighbour) told them the power in their area would be off all day. They rearranged their whole day, but the outage lasted only two hours.' },
  { id: 'R2', kind: 'relay', rule: 'relayExact', text: 'Last week a friend of theirs (a neighbour) told them the exact time of a power cut in their area (14:00–16:00), and it was exactly right.' },
  { id: 'R3', kind: 'relay', rule: 'relayWrongPlace', text: 'Last week a friend of theirs (a neighbour) told them the power in their area would be cut, but it was actually the other side of the river; their area was not affected.' },
];

const FIVE = ['Not at all', 'A little', 'Somewhat', 'Mostly', 'Completely'];
const GOV_Q = {
  trust: { type: 'score', instructions: 'How much would this person now trust the next official power-cut notice from the town to be accurate about when and where?', criteria: FIVE },
  act: { type: 'noul', instructions: 'If this person now received an official notice that the power in their area will be cut tomorrow from 14:00 to 16:00, would they change their plans for that time accordingly?' },
  verify: { type: 'noul', instructions: 'Before changing any plans, would this person try to double-check such a notice through another source (for example asking someone, or checking the town website)?' },
  concern: { type: 'score', instructions: 'How worried would this person be about the next power cut disrupting their plans?', criteria: ['Not worried at all', 'Slightly worried', 'Moderately worried', 'Quite worried', 'Very worried'] },
};
const RELAY_Q = {
  friend: { type: 'score', instructions: 'How much would this person now trust what this friend tells them next time about local news such as power cuts?', criteria: FIVE },
  actFriend: { type: 'noul', instructions: 'If this friend now told them the power in their area will be cut tomorrow afternoon, would they change their plans because of it?' },
};

interface Cell {
  person: string;
  vignette: string;
  retest?: boolean;
  answers?: Record<string, JevAnswer>;
  error?: string;
}

async function run(): Promise<void> {
  const { store } = openLab();
  const people = town30().people;
  // 已有答案的格子不再问（重测格子尤其不能重问）
  const prev: Cell[] = existsSync(RAW) ? (JSON.parse(readFileSync(RAW, 'utf8')) as Cell[]) : [];
  const find = (pid: string, vid: string, retest = false) => prev.find((c) => c.person === pid && c.vignette === vid && !!c.retest === retest && c.answers);
  const cells: Cell[] = [];
  for (const p of people) for (const v of VIGNETTES) cells.push(find(p.id, v.id) ?? { person: p.id, vignette: v.id });
  for (const p of people) cells.push(find(p.id, 'V0', true) ?? { person: p.id, vignette: 'V0', retest: true });
  const spend0 = store.spend();
  let done = 0;
  await pmap(cells.filter((c) => !c.answers), 8, async (c) => {
    const p = people.find((x) => x.id === c.person)!;
    const v = VIGNETTES.find((x) => x.id === c.vignette)!;
    const r = await askJev(store, { tpl: TPL, purpose: 'panel', state: { person: person(p), context: CONTEXT, past_experience: v.text }, questions: v.kind === 'gov' ? GOV_Q : RELAY_Q, ...(c.retest ? { bypass: true } : {}) });
    if ('error' in r) c.error = r.error;
    else c.answers = r.answers;
    if (++done % 20 === 0) process.stderr.write(`\rpanel ${done}/${cells.length}`);
  });
  process.stderr.write('\n');
  mkdirSync('data/lab', { recursive: true });
  writeFileSync(RAW, JSON.stringify(cells));
  console.log('panel spend $', (store.spend() - spend0).toFixed(4), 'errors', cells.filter((c) => c.error).length);
}

function analyze(): void {
  const cells = JSON.parse(readFileSync(RAW, 'utf8')) as Cell[];
  const people = town30().people;
  const get = (pid: string, vid: string, q: string, retest = false): number => {
    const c = cells.find((x) => x.person === pid && x.vignette === vid && !!x.retest === retest);
    const a = c?.answers?.[q];
    if (!a) return NaN;
    return a.type === 'score' ? (a.score ?? NaN) / 4 : (a.noul ?? NaN);
  };
  const mean = (xs: number[]) => {
    const ok = xs.filter(Number.isFinite);
    return ok.reduce((a, b) => a + b, 0) / ok.length;
  };
  const sd = (xs: number[]) => {
    const ok = xs.filter(Number.isFinite);
    const m = mean(ok);
    return Math.sqrt(ok.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, ok.length - 1));
  };
  // 每种经历相对对照的变化（逐人配对），附 95% 区间（t≈2.05，n=30）
  const delta = (vid: string, base: string, q: string) => {
    const d = people.map((p) => get(p.id, vid, q) - get(p.id, base, q)).filter(Number.isFinite);
    const m = mean(d);
    const se = sd(d) / Math.sqrt(d.length);
    return { mean: r3(m), lo: r3(m - 2.05 * se), hi: r3(m + 2.05 * se), n: d.length };
  };
  const levels: Record<string, Record<string, number>> = {};
  for (const v of VIGNETTES) {
    const qs = v.kind === 'gov' ? Object.keys(GOV_Q) : Object.keys(RELAY_Q);
    levels[v.id] = Object.fromEntries(qs.map((q) => [q, r3(mean(people.map((p) => get(p.id, v.id, q))))]));
  }
  const rules = DEFAULT_PARAMS.trust as unknown as Record<string, number>;
  const deltas = VIGNETTES.filter((v) => v.rule).map((v) => {
    const base = v.kind === 'gov' ? 'V0' : 'R0';
    const qs = v.kind === 'gov' ? ['trust', 'act', 'verify', 'concern'] : ['friend', 'actFriend'];
    return { id: v.id, rule: v.rule!, v1: rules[v.rule!], ...Object.fromEntries(qs.map((q) => [q, delta(v.id, base, q)])) };
  });
  // 两次虚惊（V8）：检查“按次数叠加”是否合理（与一次虚惊 V6 比）
  const twice = Object.fromEntries(['trust', 'act', 'verify', 'concern'].map((q) => [q, delta('V8', 'V0', q)]));
  // Jev 自身的波动：同一问题问两遍
  const retest = Object.fromEntries(
    Object.keys(GOV_Q).map((q) => {
      const d = people.map((p) => Math.abs(get(p.id, 'V0', q) - get(p.id, 'V0', q, true))).filter(Number.isFinite);
      return [q, { meanAbsDiff: r3(mean(d)), exactSame: r3(d.filter((x) => x < 1e-9).length / d.length) }];
    }),
  );
  // 信任的个体差异：初始信任（特质）与面板基线的相关
  const base = people.map((p) => [p.traits.trustOfficial, get(p.id, 'V0', 'trust')] as [number, number]).filter(([, y]) => Number.isFinite(y));
  const cor = (() => {
    const mx = mean(base.map((v) => v[0]));
    const my = mean(base.map((v) => v[1]));
    let a = 0;
    let b = 0;
    let c = 0;
    for (const [x, y] of base) {
      a += (x - mx) * (y - my);
      b += (x - mx) ** 2;
      c += (y - my) ** 2;
    }
    return r3(a / Math.sqrt(b * c));
  })();
  // 信任 → 行为：同一经历内，信任分与“照通知改安排”的相关（跨人），以及跨经历的均值关系
  const pairs = VIGNETTES.filter((v) => v.kind === 'gov').flatMap((v) => people.map((p) => [get(p.id, v.id, 'trust'), get(p.id, v.id, 'act')] as [number, number]));
  const slope = (() => {
    const ok = pairs.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    const mx = mean(ok.map((v) => v[0]));
    const my = mean(ok.map((v) => v[1]));
    let a = 0;
    let b = 0;
    for (const [x, y] of ok) {
      a += (x - mx) * (y - my);
      b += (x - mx) ** 2;
    }
    return r3(a / b);
  })();
  const out = { tpl: TPL, n: people.length, levels, deltas, twiceFalseAlarm: twice, retest, trustTraitVsPanel: cor, actOnTrustSlope: slope };
  mkdirSync('docs/experiments/results', { recursive: true });
  writeFileSync(SUMMARY, JSON.stringify(out, null, 1));
  console.log('==== 各经历的平均回答（0–1）');
  for (const [k, v] of Object.entries(levels)) console.log(k, JSON.stringify(v));
  console.log('==== 相对对照的变化（逐人配对，95% 区间） vs social_v1 规则');
  for (const d of deltas) console.log(d.id, d.rule.padEnd(20), 'v1', d.v1, JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => !['id', 'rule', 'v1'].includes(k)))));
  console.log('==== 两次虚惊（V8 − V0）', JSON.stringify(twice));
  console.log('==== 重测', JSON.stringify(retest), '初始信任特质 vs 面板基线 r =', cor, '· 照通知改安排 对 信任 的斜率', slope);
}

const cmd = process.argv[2] ?? 'run';
if (cmd === 'run') await run();
if (cmd === 'run' || cmd === 'analyze') analyze();
