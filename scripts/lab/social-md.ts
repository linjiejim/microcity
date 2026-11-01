// 把 docs/experiments/results/social.json 渲染成实验记录里用的 Markdown 表（避免手抄数字）
// 用法：node --import tsx --no-warnings scripts/lab/social-md.ts [hyp|levels|score|inject]
//   inject：把假设表与各分支中位数写进实验记录的 <!-- social-tables --> 标记之间
import { readFileSync, writeFileSync } from 'node:fs';

interface Term {
  label: string;
  key?: string;
  median: number;
  pos: number;
  neg: number;
  n: number;
}
interface H {
  text: string;
  verdict: string;
  terms: Term[];
}
interface Mode {
  n: number;
  levels: Record<string, Record<string, number>>;
  hypotheses: Record<string, H>;
}
interface X {
  name: string;
  exploratory?: string;
  branches: Record<string, string>;
  rule: Mode | null;
  ruleV1: Mode | null;
  jev: Mode | null;
  ui: { rule: string | null; jev: string | null };
}

const all = JSON.parse(readFileSync('docs/experiments/results/social.json', 'utf8')) as Record<string, X>;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const num = (k: string, v: number): string => {
  if (!Number.isFinite(v)) return '—';
  if (k.endsWith('t50')) {
    const a = Math.abs(v);
    const sign = v < 0 ? '−' : '';
    return a >= 7 * 86400 ? '未过半' : a >= 3600 ? `${sign}${Math.round((a / 3600) * 10) / 10} h` : `${sign}${Math.round(a / 60)} min`;
  }
  if (k.includes('govMean')) return v.toFixed(3);
  if (k.includes('/ref:')) return `${Math.round(v * 100)}%`;
  return String(Math.round(v * 10) / 10);
};
const cell = (m: Mode | null, hid: string): string => {
  const h = m?.hypotheses[hid];
  if (!h) return '—';
  return `**${h.verdict}**<br>${h.terms.map((t) => `${t.label}：${num(t.key ?? t.label, t.median)}，${pct(t.pos)} / ${pct(t.neg)}`).join('<br>')}`;
};

const LEVEL_LABEL: Record<string, string> = {
  'E1.t50': '半数相信',
  'E1.aware': '停电时知情',
  'E1.exact': '知道精确时段',
  'E1.allDayEver': '信过“全天”',
  'E1.intended': '改了安排',
  'E1.intendedOutside': '区外改安排',
  'E1.surprisedPeople': '措手不及',
  'E1.overreactMin': '过度调整（分）',
  'E1.verified': '查证',
  'trustAt.E2.govMean': 'E2 前信任',
  'E2.t50': 'E2 半数相信',
  'E2.surprisedPeople': 'E2 措手不及',
  'E2.intended': 'E2 改安排',
  'E2.overreactMin': 'E2 过度调整',
  'E2.verified': 'E2 查证',
  'trustAt.E3.govMean': 'E3 前信任',
  'E3.t50': 'E3 半数相信',
  'E3.surprisedPeople': 'E3 措手不及',
  'E3.intended': 'E3 改安排',
  'E3.disbelieved': 'E3 不信',
};

const part = process.argv[2] ?? 'hyp';
const lines: string[] = [];
const log = (x = '') => lines.push(x);
function render(which: 'hyp' | 'levels'): void {
for (const [id, x] of Object.entries(all)) {
  const modes = (['rule', 'jev'] as const).filter((m) => x[m]);
  if (which === 'levels') {
    const keys = Object.keys(LEVEL_LABEL).filter((k) => modes.some((m) => Object.values(x[m]!.levels)[0]?.[k] !== undefined));
    log(`\n**${x.name}**（v2 规则 ${x.rule?.n ?? 0} 次重复${x.jev ? ` · Jev ${x.jev.n} 次` : ''}；每格“规则 / Jev”）\n`);
    log(`| 分支 | ${keys.map((k) => LEVEL_LABEL[k]).join(' | ')} |`);
    log(`| --- | ${keys.map(() => '---').join(' | ')} |`);
    for (const [b, label] of Object.entries(x.branches)) log(`| ${b} ${label} | ${keys.map((k) => modes.map((m) => num(k, x[m]!.levels[b]?.[k] ?? NaN)).join(' / ')).join(' | ')} |`);
    continue;
  }
  log(`\n#### ${x.name}${x.exploratory ? '（探索性）' : ''}\n`);
  if (x.exploratory) log(`> ${x.exploratory}\n`);
  log('| 假设 | 校准前（v1 规则） | v2 规则 | v2 Jev |');
  log('| --- | --- | --- | --- |');
  for (const hid of Object.keys((x.rule ?? x.jev)!.hypotheses)) {
    const h = (x.rule ?? x.jev)!.hypotheses[hid]!;
    log(`| ${hid} ${h.text} | ${cell(x.ruleV1, hid)} | ${cell(x.rule, hid)} | ${cell(x.jev, hid)} |`);
  }
  log(`\n复盘里打开：规则 \`${x.ui.rule ?? '—'}\` · Jev \`${x.ui.jev ?? '—'}\``);
  void id;
}
}
if (part === 'hyp' || part === 'levels') {
  render(part);
  process.stdout.write(lines.join('\n') + '\n');
}
if (part === 'inject') {
  render('hyp');
  log('\n#### 附：各分支的中位数');
  render('levels');
  const file = 'docs/experiments/20260929-calibration-and-social-experiments.md';
  const doc = readFileSync(file, 'utf8');
  const a = doc.indexOf('<!-- social-tables:begin -->');
  const b = doc.indexOf('<!-- social-tables:end -->');
  if (a < 0 || b < 0) throw new Error('找不到标记');
  writeFileSync(file, `${doc.slice(0, a)}<!-- social-tables:begin -->\n<!-- 由 scripts/lab/social-md.ts inject 生成，不要手改 -->\n${lines.join('\n')}\n${doc.slice(b)}`);
  console.log('injected', lines.length, 'lines');
}
if (part === 'score') {
  // 预注册假设（S1–S6，不含“报告”类）的判定汇总
  const pre = Object.entries(all).filter(([, x]) => !x.exploratory);
  for (const m of ['ruleV1', 'rule', 'jev'] as const) {
    const count: Record<string, number> = {};
    for (const [, x] of pre) for (const h of Object.values(x[m]?.hypotheses ?? {})) if (h.verdict !== '报告') count[h.verdict] = (count[h.verdict] ?? 0) + 1;
    console.log(m, JSON.stringify(count));
  }
}
