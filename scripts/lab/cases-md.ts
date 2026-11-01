// 把 docs/experiments/results/cases.json 渲染成实验记录里的判定表与各分支中位数（避免手抄数字）
// 用法：node --import tsx --no-warnings scripts/lab/cases-md.ts inject
import { readFileSync, writeFileSync } from 'node:fs';

interface Term {
  label: string;
  type: string;
  median: number;
  pos: number;
  neg: number;
  n: number;
}
interface H {
  kind: string;
  text: string;
  verdict: string;
  terms: Term[];
}
interface Mode {
  n: number;
  levels: Record<string, Record<string, number>>;
  hypotheses: Record<string, H>;
}
interface C {
  name: string;
  branches: Record<string, string>;
  rule: Mode | null;
  jev: Mode | null;
  ui: { rule: string | null; jev: string | null };
}

const all = JSON.parse(readFileSync('docs/experiments/results/cases.json', 'utf8')) as Record<string, C>;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const TIME = /t50|speedGap/;
const fmt = (label: string, key: string, v: number): string => {
  if (!Number.isFinite(v)) return '—';
  if (TIME.test(key) || TIME.test(label)) {
    const a = Math.abs(v);
    const sign = v < 0 ? '−' : '';
    return a >= 7 * 86400 ? '未过半' : a >= 3600 ? `${sign}${Math.round((a / 3600) * 10) / 10} h` : `${sign}${Math.round(a / 60)} min`;
  }
  if (/trust|信任/.test(key + label)) return v.toFixed(3);
  if (/exactHop|decay|第1手/.test(key + label)) return `${Math.round(v * 100)}%`;
  return String(Math.round(v * 10) / 10);
};
const cell = (m: Mode | null, hid: string): string => {
  const h = m?.hypotheses[hid];
  if (!h) return '—';
  return `**${h.verdict}**<br>${h.terms.map((t) => `${t.label}：${fmt(t.label, '', t.median)}${t.type === 'positive' ? `，${pct(t.pos)} / ${pct(t.neg)}` : ''}`).join('<br>')}`;
};

const LABEL: Record<string, string> = {
  trustE3: 'E3 前信任',
  'e3.intended': 'E3 改安排',
  'e3.surprised': 'E3 措手不及',
  'e3.verified': 'E3 查证',
  'e3.disbelieved': 'E3 不信',
  'e3.t50': 'E3 半数相信',
  'prior.over': '前两轮白挪（分）',
  'prior.surprised': '前两轮措手不及',
  't50.youth': '青年半数相信',
  't50.senior': '老人半数相信',
  speedGap: '速度差',
  'aware.youth': '青年知情 %',
  'aware.senior': '老人知情 %',
  'exact.youth': '青年精确 %',
  'exact.senior': '老人精确 %',
  'surprised.youth': '青年措手不及 %',
  'surprised.senior': '老人措手不及 %',
  distortedEver: '信过走样',
  versions: '版本数',
  relays: '人传人',
  relayNorth: '北区人均转述',
  relaySouth: '南区人均转述',
  allDayEver: '信过“全天”',
  exactHop1: '第1手带精确时段',
  exactHop2: '第2手',
  exactHop3: '第3手',
  aware: '停电时知情',
  surprised: '措手不及',
};

const lines: string[] = [];
const log = (x = '') => lines.push(x);
for (const [id, c] of Object.entries(all)) {
  log(`\n#### ${c.name}\n`);
  log('| 假设 | 类型 | 规则（3 座镇 × 20 seed） | Jev（10 seed） |');
  log('| --- | --- | --- | --- |');
  for (const [hid, h] of Object.entries((c.rule ?? c.jev)!.hypotheses)) log(`| ${hid} ${h.text} | ${h.kind} | ${cell(c.rule, hid)} | ${cell(c.jev, hid)} |`);
  log(`\n复盘里打开：规则 \`${c.ui.rule ?? '—'}\` · Jev \`${c.ui.jev ?? '—'}\``);
  void id;
}
log('\n#### 附：各分支的中位数（每格“规则 / Jev”）');
for (const c of Object.values(all)) {
  const keys = Object.keys(Object.values(c.rule?.levels ?? c.jev!.levels)[0]!);
  log(`\n**${c.name}**\n`);
  log(`| 分支 | ${keys.map((k) => LABEL[k] ?? k).join(' | ')} |`);
  log(`| --- | ${keys.map(() => '---').join(' | ')} |`);
  for (const [b, label] of Object.entries(c.branches)) log(`| ${b} ${label} | ${keys.map((k) => [c.rule, c.jev].map((m) => (m ? fmt(LABEL[k] ?? k, k, m.levels[b]?.[k] ?? Number.NaN) : '—')).join(' / ')).join(' | ')} |`);
}

const file = 'docs/experiments/20260929-classic-cases.md';
const doc = readFileSync(file, 'utf8');
const a = doc.indexOf('<!-- cases-tables:begin -->');
const b = doc.indexOf('<!-- cases-tables:end -->');
if (process.argv[2] === 'inject') {
  if (a < 0 || b < 0) throw new Error('找不到标记');
  writeFileSync(file, `${doc.slice(0, a)}<!-- cases-tables:begin -->\n<!-- 由 scripts/lab/cases-md.ts inject 生成，不要手改 -->\n${lines.join('\n')}\n${doc.slice(b)}`);
  console.log('injected', lines.length, 'lines');
} else process.stdout.write(lines.join('\n') + '\n');
