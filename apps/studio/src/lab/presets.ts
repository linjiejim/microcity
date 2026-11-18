import { FACTORY, OLDTOWN, VILLAGE, type Experiment } from '@microcity/society';

/**
 * 影响案例（D95）：实验清单的预设，现场运行，不存预先算好的数字。
 * 每个案例的预测就是预注册的假设，写在 docs/experiments 的实验记录里；改这里要同步改记录。
 */
export interface Case {
  id: string;
  title: string;
  /** 一两句背景：现实里这件事是什么样的 */
  story: string;
  experiment: Experiment;
}

const SEEDS = [1, 2, 3, 4, 5];

export const CASES: Case[] = [
  {
    id: 'market-closed',
    title: '菜市场关了',
    story: '老城改造，菜市场说关就关。买菜的人去哪儿？原本在菜市场碰面的人，还碰得上吗？',
    experiment: {
      name: '菜市场关了',
      question: '菜市场关门以后，老人的日子会怎样？',
      spec: OLDTOWN,
      seeds: SEEDS,
      days: 14,
      interventions: [{ kind: 'close', place: 'market', from: 4 }],
      predictions: [
        { id: 'P1', text: '小超市的生意更好', metric: 'revenue.grocery', expect: 'higher' },
        { id: 'P2', text: '白跑一趟的次数更多', metric: 'stockout', expect: 'higher' },
        { id: 'P3', text: '老人聊天更少', metric: 'chats.elder', expect: 'lower' },
        { id: 'P4', text: '在外面吃的顿数更多', metric: 'eat.out', expect: 'higher' },
      ],
    },
  },
  {
    id: 'canteen',
    title: '活动中心办起了食堂',
    story: '一顿九块钱的社区食堂。它是帮了独居老人，还是抢了小饭馆的生意？',
    experiment: {
      name: '活动中心办起了食堂',
      question: '社区食堂会让老人少一些“一整天没说上话”的日子吗？',
      spec: OLDTOWN,
      seeds: SEEDS,
      days: 14,
      interventions: [{ kind: 'canteen', place: 'center', price: 9, from: 4 }],
      predictions: [
        { id: 'P1', text: '一整天没和人聊过的老人更少', metric: 'alone.elder', expect: 'lower' },
        { id: 'P2', text: '饭馆的营业额更低', metric: 'revenue.eatery', expect: 'lower' },
        { id: 'P3', text: '在家吃的顿数更少', metric: 'eat.home', expect: 'lower' },
        { id: 'P4', text: '老人的心情更好', metric: 'mood.elder', expect: 'higher' },
      ],
    },
  },
  {
    id: 'rumor',
    title: '“听说菜要涨价了”',
    story: '一句没有来由的话，从六个人嘴里传开。货架会不会真的空？',
    experiment: {
      name: '菜要涨价的传言',
      question: '一条涨价的传言，能不能自己把菜买空？',
      spec: OLDTOWN,
      seeds: SEEDS,
      days: 12,
      interventions: [{ kind: 'rumor', topic: 'price_up', seeds: 6, day: 4 }],
      from: 4,
      predictions: [
        { id: 'P1', text: '白跑一趟的次数更多', metric: 'stockout', expect: 'higher' },
        { id: 'P2', text: '人均存粮更多', metric: 'pantry', expect: 'higher' },
        { id: 'P3', text: '菜市场的营业额更高', metric: 'revenue.market', expect: 'higher' },
      ],
    },
  },
  {
    id: 'rain',
    title: '连下一周雨',
    story: '公园和广场没法待了。老人的社交是搬进了茶馆，还是就此少了？',
    experiment: {
      name: '连下一周雨',
      question: '一周的雨，会让老人更孤单吗？',
      spec: OLDTOWN,
      seeds: SEEDS,
      days: 12,
      interventions: [{ kind: 'weather', weather: 'rain', from: 4, to: 10 }],
      predictions: [
        { id: 'P1', text: '去公园的人次更少', metric: 'visits.park', expect: 'lower' },
        { id: 'P2', text: '去茶馆的人次更多', metric: 'visits.teahouse', expect: 'higher' },
        { id: 'P3', text: '老人聊天更少', metric: 'chats.elder', expect: 'lower' },
        { id: 'P4', text: '老人的心情更差', metric: 'mood.elder', expect: 'lower' },
      ],
    },
  },
  {
    id: 'layoff',
    title: '车间裁掉一半人',
    story: '工厂镇的一个车间裁员一半。少掉的工资，会不会传到饭馆和小店？',
    experiment: {
      name: '车间裁掉一半人',
      question: '一个车间裁员，镇上的小店会跟着冷清吗？',
      spec: FACTORY,
      seeds: SEEDS,
      days: 21,
      interventions: [{ kind: 'layoff', place: 'workshop', fraction: 0.5, day: 4 }],
      predictions: [
        { id: 'P1', text: '个人花销更少', metric: 'spend', expect: 'lower' },
        { id: 'P2', text: '饭馆的营业额更低', metric: 'revenue.eatery', expect: 'lower' },
        { id: 'P3', text: '家庭账户的中位数更低', metric: 'hh.balance', expect: 'lower' },
        { id: 'P4', text: '上班的人心情更差', metric: 'mood.worker', expect: 'lower' },
      ],
    },
  },
  {
    id: 'voucher',
    title: '每户发 500 元',
    story: '城中村里手头最紧的一群人，每户收到 500 元。钱会花在哪儿？',
    experiment: {
      name: '每户发 500 元',
      question: '发钱之后，人们会多下馆子吗？',
      spec: VILLAGE,
      seeds: SEEDS,
      days: 14,
      interventions: [{ kind: 'grant', amount: 500, day: 4 }],
      predictions: [
        { id: 'P1', text: '在外面吃的顿数更多', metric: 'eat.out', expect: 'higher' },
        { id: 'P2', text: '饭馆的营业额更高', metric: 'revenue.eatery', expect: 'higher' },
        { id: 'P3', text: '个人花销更多', metric: 'spend', expect: 'higher' },
      ],
    },
  },
  {
    id: 'rent',
    title: '房租涨三成',
    story: '城中村八成的人租房。房东一涨价，先被挤掉的是哪一笔开销？',
    experiment: {
      name: '房租涨三成',
      question: '房租涨了，租客会少下馆子吗？',
      spec: VILLAGE,
      seeds: SEEDS,
      days: 21,
      interventions: [{ kind: 'rent', factor: 1.3, from: 1 }],
      from: 8,
      predictions: [
        { id: 'P1', text: '家庭账户的中位数更低', metric: 'hh.balance', expect: 'lower' },
        { id: 'P2', text: '在外面吃的顿数更少', metric: 'eat.out', expect: 'lower' },
        { id: 'P3', text: '饭馆的营业额更低', metric: 'revenue.eatery', expect: 'lower' },
      ],
    },
  },
];
