// 生成实验广场的内容 docs/experiments/gallery.json（服务端 apps/server/src/gallery.ts 读取）
// 卡片文字手写在这里；小镇规格与分支取自案例定义，保证“在这里重跑”和实验记录是同一个实验。
// 用法：node --import tsx --no-warnings scripts/lab/gallery.ts
import { writeFileSync } from 'node:fs';
import type { Prediction } from '@microcity/sim';
import type { GalleryEntry } from '../../apps/server/src/gallery.ts';
import { CASES } from './cases.ts';
import { EXPERIMENTS } from './social.ts';

const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
const W = CASES.find((c) => c.id === 'W')!;
const K = CASES.find((c) => c.id === 'K')!;
const R = CASES.find((c) => c.id === 'R')!;
const S1 = EXPERIMENTS.find((e) => e.id === 'S1')!;
const S2 = EXPERIMENTS.find((e) => e.id === 'S2')!;
const CASES_DOC = 'docs/experiments/20260929-classic-cases.md';
const SOCIAL_DOC = 'docs/experiments/20260929-calibration-and-social-experiments.md';
const P = (id: string, text: string, metric: string, a: string, b: string, expect: Prediction['expect'], tolerance?: number): Prediction => ({ id, text, metric, a, b, expect, ...(tolerance !== undefined ? { tolerance } : {}) });

const entries: GalleryEntry[] = [
  {
    id: 'wolf',
    version: 1,
    title: '狼来了：虚惊两次之后，还有人听吗？',
    classic: '伊索寓言；Breznitz（1984）的 cry-wolf 效应，后来的实证研究结论不一',
    question: '北区连着三次收到停电通知。前两次是虚惊（通知了但没停），第三次真停了。和从没停过电的镇相比，第三次会发生什么？',
    guess: {
      prompt: '第三次真停电时，照通知改安排的人会……',
      options: ['更多', '差不多', '更少'],
      answer: 2,
      explain: '两次虚惊后照做的人少了：规则心智少 5 人（约四分之一），Jev 少 1.5 人。但措手不及的人没有增加——通知照样传遍全镇，只是信的人打了折扣。',
    },
    findings: [
      { text: '对官方的信任从 0.62 降到 0.49', rule: '支持', jev: '支持' },
      { text: '第三次照通知改安排的人更少', rule: '支持', jev: '支持' },
      { text: '措手不及的人没有增加（社会把代价吸收了）', rule: '支持', jev: '支持' },
      { text: '虚报比漏报更伤信任、也更伤照做；漏报伤的是当下（22 人次措手不及），虚报伤的是以后', rule: '支持', jev: '支持' },
      { text: '只虚惊一次时两种心智方向相反：规则说照做的人已经少了 2 个，Jev 说反而多了 1 个', rule: '少 2 人', jev: '多 1 人' },
    ],
    doc: CASES_DOC,
    figure: { kind: 'dots', total: 60, unit: '人照通知改了安排', a: { label: '从没停过电', value: 20.5 }, b: { label: '两次虚惊之后', value: 15.5 }, note: '照做的人少了约四分之一（规则心智；Jev 少 1.5 人）' },
    spec: W.base(42),
    branches: W.branches,
    predictions: [
      P('P1', '两次虚惊后，对官方的信任更低', 'trustAt.E3.govMean', 'D', 'A', 'lower'),
      P('P2', '两次虚惊后，照通知改安排的人更少', 'E3.intended', 'D', 'A', 'lower'),
      P('P3', '虚报比漏报更伤照做', 'E3.intended', 'D', 'E', 'lower'),
      P('P4', '两次虚惊后，措手不及的人差不多', 'E3.surprisedPeople', 'D', 'A', 'same', 1),
    ],
    seeds: SEEDS,
  },
  {
    id: 'gap',
    version: 1,
    title: '知沟：推送会让老人和年轻人差得更远吗？',
    classic: 'Tichenor、Donohue、Olien（1970）的知沟假说',
    question: '老人占四成的镇，停电通知用不同的渠道发：只发网站、加手机推送、加公告栏、三样都用。老人和年轻人谁先知道？',
    guess: {
      prompt: '加上手机推送之后，老人和年轻人知道消息的时间差会……',
      options: ['缩小', '差不多', '扩大'],
      answer: 2,
      explain: '只发网站时，老人反而比年轻人先知道（常看网站的多是老人）；加推送后年轻人半小时就过半，老人要约 22 小时。到停电那一刻，青年与老人的知情差比只发网站时多出 7–17 个百分点——家人并没有把差距填平。公告栏则把差距反了过来。',
    },
    findings: [
      { text: '推送拉大了“多快知道”的差距', rule: '支持', jev: '支持' },
      { text: '停电那一刻，老人的知情率也更低（没有出现“天花板效应”）', rule: '支持', jev: '支持' },
      { text: '推送也拉大了“知道得准不准”的差距', rule: '支持', jev: '支持' },
      { text: '公告栏把差距反过来：老人约 2 小时过半，年轻人约 10 小时', rule: '支持', jev: '支持' },
    ],
    doc: CASES_DOC,
    figure: {
      kind: 'race',
      unit: '半数人相信用了多久',
      aLabel: '只发网站',
      bLabel: '网站 + 推送',
      rows: [
        { label: '青年', a: 24, b: 0.55, aText: '24 小时', bText: '33 分钟' },
        { label: '老人', a: 22.3, b: 22.1, aText: '22 小时', bText: '22 小时' },
      ],
      note: '加推送后，青年半小时就过半，老人仍要约 22 小时',
    },
    spec: K.base(42),
    branches: K.branches,
    predictions: [
      P('P1', '加推送后，老人比青年晚得更多', 'E1.gapT50', 'B', 'A', 'higher'),
      P('P2', '加推送后，停电时青年比老人多知情', 'E1.gapAware', 'B', 'A', 'higher'),
      P('P3', '加公告栏后，老人比青年晚得更少', 'E1.gapT50', 'C', 'A', 'lower'),
    ],
    seeds: SEEDS,
  },
  {
    id: 'telephone',
    version: 1,
    title: '传话游戏：一条通知传几手会走样？',
    classic: 'Bartlett（1932）的连续复述；Allport 与 Postman（1947）的谣言心理学',
    question: '同一次停电，通知写法不同：标题写精确时段、只写“下午”、不写时间，或者干脆不发通知、只靠维护站工人口耳相传。',
    guess: {
      prompt: '没有官方通知、全靠口耳相传时，传到第三个人手里，还带着准确时间的转述大约占……',
      options: ['七成以上', '三成左右', '几乎没有'],
      answer: 2,
      explain: '第一手还有 75–85% 带着精确时段，到第三手只剩 0–17%。但只要官方原文在，走样就有上限：第三手仍有约 24–32%。真实社区里的传话不是一条链而是一张网，原文会不断把走样的版本拉回来。',
    },
    findings: [
      { text: '没有原文时，精确时段随手数衰减（演示：衰减速度是模型参数）', rule: '支持', jev: '支持' },
      { text: '有官方原文在，衰减平缓得多', rule: '支持', jev: '支持' },
      { text: '要停电的北区，人均转述是南区的约 2 倍（重要性）', rule: '支持', jev: '支持' },
      { text: '标题只写“下午”，信过走样版本的人多 3–5 个', rule: '支持', jev: '部分支持' },
      { text: 'Allport–Postman 的“重要性 × 模糊度”乘法', rule: '部分支持', jev: '不支持' },
    ],
    doc: CASES_DOC,
    figure: {
      kind: 'chain',
      hops: ['第 1 手', '第 2 手', '第 3 手'],
      rows: [
        { label: '没有官方原文', values: [75, 33, 0] },
        { label: '有官方原文', values: [38, 31, 24] },
      ],
      note: '带着准确时间的转述：没有原文时到第三手几乎为零，有原文时还剩约四分之一',
    },
    spec: R.base(42),
    branches: R.branches,
    predictions: [
      P('P1', '标题只写“下午”，信过走样版本的人更多', 'E1.distortedEver', 'B', 'A', 'higher'),
      P('P2', '不发通知时，“停一整天”的谣言更多', 'E1.allDayEver', 'D', 'B', 'higher'),
    ],
    seeds: SEEDS,
  },
  {
    id: 'headline',
    version: 1,
    title: '把通知写清楚，能让大家少折腾吗？',
    classic: '灾害预警研究：警报要具体（Mileti 与 Sorensen 1990）',
    question: '订推送的人多（70%）还是少（10%），通知标题写精确时段还是只写“下午”，两两组合。',
    guess: {
      prompt: '标题从“下午”改成“14:00–16:00”，白白挪走的安排会……',
      options: ['明显减少', '说不准', '反而增加'],
      answer: 1,
      explain: '推送让大家快得多（半数人相信从约 3.7 小时缩到几分钟），这在任何参数下都成立。但“写清楚能少折腾”取决于模型：规则心智下几乎没差别，Jev 下有所减少；敏感性分析里也只有一半多的参数组合成立。渠道管“多快知道”，却管不了“改得对不对”。',
    },
    findings: [
      { text: '推送让半数人相信从约 3.7 小时缩到几分钟', rule: '支持', jev: '支持' },
      { text: '推送多的镇措手不及略少，差距不到 2 人', rule: '支持', jev: '支持' },
      { text: '精确标题减少白挪的安排', rule: '部分支持', jev: '部分支持' },
      { text: '“推送会把模糊标题放大”', rule: '部分支持', jev: '不支持' },
    ],
    doc: SOCIAL_DOC,
    figure: {
      kind: 'robust',
      rows: [
        { label: '推送多的镇，半数人更早相信', rule: 100, jev: 100 },
        { label: '精确标题让白挪的安排更少', rule: 58, jev: 80 },
      ],
      note: '每一对重复里结论成立的比例：渠道的效果每一次都成立，措辞的效果时有时无',
    },
    spec: S1.base(42),
    branches: S1.branches,
    predictions: [
      P('P1', '推送多的镇，半数人更早相信', 'E1.t50', 'C', 'A', 'lower'),
      P('P2', '精确标题让白挪的安排更少', 'E1.overreactMin', 'B', 'A', 'lower'),
    ],
    seeds: SEEDS,
  },
  {
    id: 'trust',
    version: 1,
    title: '不信官方的镇，会更常去官网核实吗？',
    classic: '风险沟通中的制度信任；本项目的 Jev 信任面板',
    question: '对官方的平均信任 0.8 和 0.3 的两座镇，停电通知分别带或不带推送。',
    guess: {
      prompt: '在低信任的镇上，去官网查证的人会……',
      options: ['更多', '差不多', '更少'],
      answer: 2,
      explain: '两种心智在这里意见相反。规则心智按直觉写成“越不信越要查”，查证更多；Jev（以及信任面板）则是越不信越不去官网——查证的渠道本身就是官方的。模型里这一项的符号可能写反了，欢迎来检验。',
    },
    findings: [
      { text: '低信任的镇信得更慢', rule: '支持', jev: '支持' },
      { text: '但几乎没有人“不信”官方通知（可信度有下限）', rule: '支持', jev: '支持' },
      { text: '去官网查证的人：规则说更多，Jev 说更少', rule: '更多', jev: '更少' },
      { text: '推送在低信任的镇里提速', rule: '差不多', jev: '更多' },
    ],
    doc: SOCIAL_DOC,
    figure: {
      kind: 'diverge',
      unit: '低信任的镇去官网查证的人（与高信任的镇相比）',
      rows: [
        { label: '规则心智', value: 2, text: '多 2 人' },
        { label: 'Jev', value: -6, text: '少 6 人' },
      ],
      note: '两种心智意见相反：查证的渠道本身就是官方的',
    },
    spec: S2.base(42),
    branches: S2.branches,
    predictions: [
      P('P1', '低信任的镇，半数人更晚相信', 'E1.t50', 'C', 'A', 'higher'),
      P('P2', '低信任的镇，查证的人更多（规则心智的看法）', 'E1.verified', 'C', 'A', 'higher'),
    ],
    seeds: SEEDS,
  },
];

writeFileSync('docs/experiments/gallery.json', `${JSON.stringify({ version: 1, entries }, null, 1)}\n`);
console.log('gallery entries', entries.length);
