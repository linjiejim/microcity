import { hm } from '../core/time.ts';
import type { PlaceKind } from '../model/def.ts';
import type { AnchorKind } from '../world/interiors.ts';

/**
 * 数据表（D65）：活动、班次、职业、兴趣、物品。
 * 多社区与用户定制都靠换这些表，不靠改规则代码。
 */

export type ActKind =
  | 'sleep'
  | 'nap'
  | 'wash'
  | 'eat_home'
  | 'eat_out'
  | 'eat_work'
  | 'cook'
  | 'work'
  | 'school'
  | 'study'
  | 'shop'
  | 'hobby'
  | 'chores'
  | 'rest'
  | 'wait'
  | 'escort'
  | 'care'
  | 'clinic';

/** 时间利用的分桶（画像与每日小结用）；“歇着”单独一桶，调查里它和睡觉同属“睡觉休息”（D97） */
export type Bucket = 'sleep' | 'rest' | 'work' | 'study' | 'meal' | 'chores' | 'leisure' | 'travel' | 'other';

export const ACT_BUCKET: Record<ActKind, Bucket> = {
  sleep: 'sleep',
  nap: 'sleep',
  wash: 'other',
  eat_home: 'meal',
  eat_out: 'meal',
  eat_work: 'meal',
  cook: 'chores',
  work: 'work',
  school: 'study',
  study: 'study',
  shop: 'chores',
  hobby: 'leisure',
  chores: 'chores',
  rest: 'rest',
  wait: 'other',
  escort: 'chores',
  care: 'chores',
  clinic: 'other',
};

export const BUCKETS: Bucket[] = ['sleep', 'rest', 'work', 'study', 'meal', 'chores', 'leisure', 'travel', 'other'];
export const BUCKET_LABEL: Record<Bucket, string> = { sleep: '睡觉', rest: '歇着', work: '工作', study: '学习', meal: '吃饭', chores: '家务与采购', leisure: '休闲', travel: '路上', other: '其他' };

export const ACT_LABEL: Record<ActKind, string> = {
  sleep: '睡觉',
  nap: '午睡',
  wash: '洗漱',
  eat_home: '在家吃饭',
  eat_out: '在外面吃',
  eat_work: '吃自带的饭',
  cook: '做饭',
  work: '上班',
  school: '上课',
  study: '写作业',
  shop: '买菜',
  hobby: '消遣',
  chores: '做家务',
  rest: '歇着',
  wait: '等着',
  escort: '接送孩子',
  care: '陪孩子',
  clinic: '去卫生站',
};

// ───────────────────────── 班次与职业

export type RestRule = 'weekend' | 'sunday' | 'rotate' | 'none';

export interface Shift {
  id: string;
  label: string;
  /** 一天里的若干段（当天秒数） */
  segs: Array<[number, number]>;
  rest: RestRule;
  /** 去城里：整段时间不在社区 */
  away?: boolean;
}

export const SHIFTS: Record<string, Shift> = {
  office: { id: 'office', label: '朝九晚六', segs: [[hm(9), hm(12)], [hm(13), hm(18)]], rest: 'weekend' },
  school: { id: 'school', label: '学校作息', segs: [[hm(7, 40), hm(12)], [hm(13, 20), hm(16, 50)]], rest: 'weekend' },
  factory: { id: 'factory', label: '车间白班', segs: [[hm(8), hm(12)], [hm(13), hm(17)]], rest: 'sunday' },
  clinic: { id: 'clinic', label: '门诊', segs: [[hm(8), hm(12)], [hm(13, 30), hm(17, 30)]], rest: 'sunday' },
  market: { id: 'market', label: '早市', segs: [[hm(5, 40), hm(9, 30)], [hm(9, 50), hm(12, 50)]], rest: 'rotate' },
  market_b: { id: 'market_b', label: '早市', segs: [[hm(5, 40), hm(10, 20)], [hm(10, 40), hm(12, 50)]], rest: 'rotate' },
  breakfast: { id: 'breakfast', label: '早点铺', segs: [[hm(5, 20), hm(10, 20)], [hm(10, 50), hm(13, 50)]], rest: 'rotate' },
  breakfast_b: { id: 'breakfast_b', label: '早点铺', segs: [[hm(5, 20), hm(11, 10)], [hm(11, 40), hm(13, 50)]], rest: 'rotate' },
  eatery: { id: 'eatery', label: '饭馆', segs: [[hm(10, 15), hm(14)], [hm(16, 30), hm(21)]], rest: 'rotate' },
  eatery_b: { id: 'eatery_b', label: '饭馆', segs: [[hm(10, 15), hm(14, 30)], [hm(17), hm(21)]], rest: 'rotate' },
  noodle_am: { id: 'noodle_am', label: '面馆早班', segs: [[hm(6, 20), hm(10, 30)], [hm(11), hm(14)]], rest: 'rotate' },
  noodle_am_b: { id: 'noodle_am_b', label: '面馆早班', segs: [[hm(6, 20), hm(9, 50)], [hm(10, 20), hm(14)]], rest: 'rotate' },
  noodle_pm: { id: 'noodle_pm', label: '面馆晚班', segs: [[hm(13, 40), hm(17)], [hm(17, 30), hm(20, 40)]], rest: 'rotate' },
  noodle_pm_b: { id: 'noodle_pm_b', label: '面馆晚班', segs: [[hm(13, 40), hm(16, 20)], [hm(16, 50), hm(20, 40)]], rest: 'rotate' },
  shop_am: { id: 'shop_am', label: '看店早班', segs: [[hm(7, 20), hm(11, 30)], [hm(12), hm(14, 30)]], rest: 'rotate' },
  shop_mid: { id: 'shop_mid', label: '看店中班', segs: [[hm(10, 30), hm(14)], [hm(14, 30), hm(18, 30)]], rest: 'rotate' },
  shop_pm: { id: 'shop_pm', label: '看店晚班', segs: [[hm(14, 20), hm(18)], [hm(18, 30), hm(21, 30)]], rest: 'rotate' },
  tea_am: { id: 'tea_am', label: '茶馆早班', segs: [[hm(8, 50), hm(12)], [hm(12, 30), hm(17)]], rest: 'rotate' },
  tea_am_b: { id: 'tea_am_b', label: '茶馆早班', segs: [[hm(8, 50), hm(11, 30)], [hm(12), hm(17)]], rest: 'rotate' },
  tea_pm: { id: 'tea_pm', label: '茶馆晚班', segs: [[hm(13), hm(17, 30)], [hm(18), hm(21, 30)]], rest: 'rotate' },
  tea_pm_b: { id: 'tea_pm_b', label: '茶馆晚班', segs: [[hm(13), hm(18)], [hm(18, 30), hm(21, 30)]], rest: 'rotate' },
  center_day: { id: 'center_day', label: '活动中心白班', segs: [[hm(8, 30), hm(12)], [hm(13, 30), hm(17, 30)]], rest: 'rotate' },
  center_late: { id: 'center_late', label: '活动中心晚班', segs: [[hm(12), hm(17)], [hm(17, 30), hm(20, 30)]], rest: 'rotate' },
  city: { id: 'city', label: '城里上班', segs: [[hm(7, 50), hm(18, 40)]], rest: 'weekend', away: true },
  city_late: { id: 'city_late', label: '城里晚班', segs: [[hm(11, 30), hm(21, 20)]], rest: 'rotate', away: true },
};

export interface Occupation {
  id: string;
  label: string;
  /** 干活时的站位种类（按顺序找空位） */
  anchors: AnchorKind[];
  /** 日薪（元） */
  wage: number;
}

export const OCCUPATIONS: Record<string, Occupation> = {
  vendor: { id: 'vendor', label: '菜摊摊主', anchors: ['stall'], wage: 105 },
  cook: { id: 'cook', label: '厨师', anchors: ['kitchen'], wage: 155 },
  server: { id: 'server', label: '服务员', anchors: ['counter', 'kitchen'], wage: 110 },
  shopkeeper: { id: 'shopkeeper', label: '店员', anchors: ['counter'], wage: 108 },
  tea_staff: { id: 'tea_staff', label: '茶馆伙计', anchors: ['counter'], wage: 105 },
  center_staff: { id: 'center_staff', label: '活动中心工作人员', anchors: ['counter'], wage: 135 },
  doctor: { id: 'doctor', label: '医生', anchors: ['desk'], wage: 265 },
  nurse: { id: 'nurse', label: '护士', anchors: ['counter', 'desk'], wage: 172 },
  teacher: { id: 'teacher', label: '小学老师', anchors: ['podium', 'desk'], wage: 215 },
  school_staff: { id: 'school_staff', label: '学校职工', anchors: ['desk'], wage: 125 },
  clerk: { id: 'clerk', label: '街道办职员', anchors: ['desk', 'counter'], wage: 192 },
  worker: { id: 'worker', label: '车间工人', anchors: ['machine'], wage: 152 },
  foreman: { id: 'foreman', label: '车间主任', anchors: ['desk'], wage: 210 },
  city_office: { id: 'city_office', label: '公司职员（城里）', anchors: ['wait'], wage: 235 },
  city_service: { id: 'city_service', label: '商场店员（城里）', anchors: ['wait'], wage: 150 },
  city_driver: { id: 'city_driver', label: '网约车司机（城里）', anchors: ['wait'], wage: 185 },
  city_tech: { id: 'city_tech', label: '程序员（城里）', anchors: ['wait'], wage: 330 },
};

/** 每类单位的岗位：职业、班次、是不是店主 */
export interface Post {
  occupation: string;
  shift: string;
  owner?: boolean;
}

export interface FirmTemplate {
  kind: 'private' | 'public';
  posts: Post[];
  /** 卖什么：商品、售价、进货成本占比、每日补到多少 */
  offers: Array<{ item: string; price: number; cost: number; restockTo: number }>;
  cash: number;
  /** 每日外部流入（元） */
  externalDaily: number;
}

const rep = (n: number, post: Post): Post[] => Array.from({ length: n }, () => ({ ...post }));

/** 经营模板：先按地点的 biz 键，没有就按地点类型 */
export const FIRM_TEMPLATES: Record<string, FirmTemplate> = {
  market: {
    kind: 'private',
    posts: Array.from({ length: 6 }, (_, i) => ({ occupation: 'vendor', shift: i % 2 === 0 ? 'market' : 'market_b' })),
    offers: [{ item: 'food', price: 7, cost: 0.55, restockTo: 900 }],
    cash: 6000,
    externalDaily: 0,
  },
  grocery: {
    kind: 'private',
    posts: [{ occupation: 'shopkeeper', shift: 'shop_am', owner: true }, { occupation: 'shopkeeper', shift: 'shop_pm' }, { occupation: 'shopkeeper', shift: 'shop_mid' }],
    offers: [
      { item: 'food', price: 8.5, cost: 0.6, restockTo: 320 },
      { item: 'supplies', price: 4, cost: 0.6, restockTo: 400 },
    ],
    cash: 5000,
    externalDaily: 0,
  },
  eatery: {
    kind: 'private',
    posts: [{ occupation: 'cook', shift: 'eatery', owner: true }, { occupation: 'server', shift: 'eatery_b' }, { occupation: 'server', shift: 'eatery' }],
    offers: [{ item: 'meal', price: 22, cost: 0.42, restockTo: 120 }],
    cash: 6000,
    externalDaily: 0,
  },
  breakfast: {
    kind: 'private',
    posts: [{ occupation: 'cook', shift: 'breakfast', owner: true }, { occupation: 'server', shift: 'breakfast_b' }, { occupation: 'server', shift: 'breakfast' }],
    offers: [{ item: 'meal', price: 7, cost: 0.4, restockTo: 220 }],
    cash: 3000,
    externalDaily: 0,
  },
  noodle: {
    kind: 'private',
    posts: [{ occupation: 'cook', shift: 'noodle_am', owner: true }, { occupation: 'server', shift: 'noodle_am_b' }, { occupation: 'cook', shift: 'noodle_pm' }, { occupation: 'server', shift: 'noodle_pm_b' }],
    offers: [{ item: 'meal', price: 14, cost: 0.4, restockTo: 200 }],
    cash: 4000,
    externalDaily: 0,
  },
  teahouse: {
    kind: 'private',
    posts: [{ occupation: 'tea_staff', shift: 'tea_am', owner: true }, { occupation: 'tea_staff', shift: 'tea_pm' }, { occupation: 'tea_staff', shift: 'tea_am_b' }, { occupation: 'tea_staff', shift: 'tea_pm_b' }],
    offers: [{ item: 'tea', price: 8, cost: 0.2, restockTo: 300 }],
    cash: 4000,
    externalDaily: 0,
  },
  // 生鲜超市：新小区里代替菜市场
  supermarket: {
    kind: 'private',
    posts: [{ occupation: 'shopkeeper', shift: 'shop_am', owner: true }, { occupation: 'shopkeeper', shift: 'shop_pm' }, { occupation: 'shopkeeper', shift: 'shop_mid' }, { occupation: 'shopkeeper', shift: 'shop_am' }, { occupation: 'shopkeeper', shift: 'shop_pm' }],
    offers: [
      { item: 'food', price: 8, cost: 0.58, restockTo: 900 },
      { item: 'supplies', price: 4, cost: 0.6, restockTo: 500 },
    ],
    cash: 9000,
    externalDaily: 0,
  },
  fastfood: {
    kind: 'private',
    posts: [{ occupation: 'cook', shift: 'eatery', owner: true }, { occupation: 'server', shift: 'eatery_b' }, { occupation: 'server', shift: 'eatery' }],
    offers: [{ item: 'meal', price: 18, cost: 0.42, restockTo: 160 }],
    cash: 6000,
    externalDaily: 0,
  },
  // 职工食堂：便宜，厂里贴钱
  canteen: {
    kind: 'public',
    posts: [{ occupation: 'cook', shift: 'noodle_am' }, { occupation: 'server', shift: 'noodle_am_b' }, { occupation: 'cook', shift: 'noodle_pm' }, { occupation: 'server', shift: 'noodle_pm_b' }],
    offers: [{ item: 'meal', price: 9, cost: 0.6, restockTo: 320 }],
    cash: 5000,
    externalDaily: 420,
  },
  garment: { kind: 'private', posts: [{ occupation: 'foreman', shift: 'factory', owner: true }, ...rep(17, { occupation: 'worker', shift: 'factory' })], offers: [], cash: 22000, externalDaily: 3100 },
  plant: { kind: 'public', posts: [{ occupation: 'foreman', shift: 'factory' }, ...rep(23, { occupation: 'worker', shift: 'factory' })], offers: [], cash: 30000, externalDaily: 3700 },
  property: { kind: 'public', posts: rep(5, { occupation: 'clerk', shift: 'office' }), offers: [], cash: 8000, externalDaily: 1000 },
  center: { kind: 'public', posts: [{ occupation: 'center_staff', shift: 'center_day' }, { occupation: 'center_staff', shift: 'center_day' }, { occupation: 'center_staff', shift: 'center_late' }], offers: [], cash: 4000, externalDaily: 420 },
  clinic: { kind: 'public', posts: [...rep(2, { occupation: 'doctor', shift: 'clinic' }), ...rep(2, { occupation: 'nurse', shift: 'clinic' })], offers: [], cash: 8000, externalDaily: 900 },
  school: { kind: 'public', posts: [...rep(8, { occupation: 'teacher', shift: 'school' }), ...rep(2, { occupation: 'school_staff', shift: 'school' })], offers: [], cash: 15000, externalDaily: 2000 },
  office: { kind: 'public', posts: rep(12, { occupation: 'clerk', shift: 'office' }), offers: [], cash: 15000, externalDaily: 2350 },
  workshop: { kind: 'private', posts: [{ occupation: 'foreman', shift: 'factory', owner: true }, ...rep(13, { occupation: 'worker', shift: 'factory' })], offers: [], cash: 20000, externalDaily: 2500 },
};

export const firmTemplateFor = (kind: PlaceKind, biz?: string): FirmTemplate | undefined => (biz ? FIRM_TEMPLATES[biz] : undefined) ?? FIRM_TEMPLATES[kind];

/** 城里的工作：职业、班次、权重 */
export const CITY_JOBS: Array<{ occupation: string; shift: string; w: number }> = [
  { occupation: 'city_office', shift: 'city', w: 0.42 },
  { occupation: 'city_service', shift: 'city_late', w: 0.2 },
  { occupation: 'city_driver', shift: 'city', w: 0.16 },
  { occupation: 'city_tech', shift: 'city', w: 0.22 },
];

// ───────────────────────── 兴趣

export interface Hobby {
  id: string;
  label: string;
  /** 在哪类地点做；'home' 表示在自己家 */
  where: Array<PlaceKind | 'home'>;
  anchors: AnchorKind[];
  /** 习惯的时段（当天秒数），可以有几段 */
  windows: Array<[number, number]>;
  /** 一次多久（分钟） */
  dur: [number, number];
  /** 每小时带来的娱乐、社交、精力变化 */
  fun: number;
  social: number;
  energy: number;
  /** 每次花费（元）：按地点类型 */
  cost: Partial<Record<PlaceKind, number>>;
  /** 在该地点买的是哪种商品（收入记到店家） */
  item?: string;
  outdoor: boolean;
  ages: [number, number];
  /** 需要的物品（自己的或家里的） */
  needs?: string;
  /** 人人都会做，不需要列在兴趣里 */
  generic?: boolean;
}

export const HOBBIES: Record<string, Hobby> = {
  chess: { id: 'chess', label: '下棋', where: ['teahouse', 'center', 'park'], anchors: ['board'], windows: [[hm(8, 30), hm(11, 30)], [hm(14), hm(17, 30)]], dur: [50, 110], fun: 0.3, social: 0.22, energy: -0.02, cost: { teahouse: 6 }, item: 'tea', outdoor: false, ages: [14, 95] },
  cards: { id: 'cards', label: '打牌', where: ['teahouse', 'center'], anchors: ['board'], windows: [[hm(13, 30), hm(17, 30)], [hm(19), hm(21, 20)]], dur: [70, 140], fun: 0.32, social: 0.26, energy: -0.02, cost: { teahouse: 10 }, item: 'tea', outdoor: false, ages: [18, 95] },
  tea: { id: 'tea', label: '喝茶聊天', where: ['teahouse'], anchors: ['board'], windows: [[hm(9), hm(11, 30)], [hm(14), hm(17)]], dur: [40, 90], fun: 0.2, social: 0.36, energy: 0, cost: { teahouse: 8 }, item: 'tea', outdoor: false, ages: [30, 95] },
  dance: { id: 'dance', label: '跳广场舞', where: ['square'], anchors: ['dance'], windows: [[hm(19), hm(20, 45)], [hm(6, 40), hm(7, 50)]], dur: [50, 90], fun: 0.36, social: 0.22, energy: -0.09, cost: {}, outdoor: true, ages: [38, 82] },
  taichi: { id: 'taichi', label: '晨练', where: ['park'], anchors: ['free'], windows: [[hm(5, 50), hm(8)]], dur: [30, 60], fun: 0.24, social: 0.12, energy: -0.03, cost: {}, outdoor: true, ages: [45, 95] },
  ball: { id: 'ball', label: '打球', where: ['court'], anchors: ['hoop'], windows: [[hm(16, 30), hm(19, 30)], [hm(9), hm(11, 30)]], dur: [45, 90], fun: 0.42, social: 0.24, energy: -0.14, cost: {}, outdoor: true, ages: [10, 48] },
  play: { id: 'play', label: '玩耍', where: ['square', 'park'], anchors: ['play'], windows: [[hm(15), hm(18, 30)], [hm(9), hm(11, 30)]], dur: [35, 80], fun: 0.44, social: 0.26, energy: -0.1, cost: {}, outdoor: true, ages: [4, 13] },
  read: { id: 'read', label: '看书', where: ['center', 'home'], anchors: ['read', 'desk', 'sofa'], windows: [[hm(9), hm(11, 30)], [hm(14), hm(17)], [hm(19, 30), hm(21, 30)]], dur: [35, 80], fun: 0.24, social: 0.02, energy: -0.01, cost: {}, outdoor: false, ages: [8, 95] },
  game: { id: 'game', label: '打游戏', where: ['home'], anchors: ['desk', 'sofa'], windows: [[hm(19, 30), hm(23, 30)], [hm(14), hm(17)]], dur: [50, 140], fun: 0.42, social: 0.04, energy: -0.03, cost: {}, outdoor: false, ages: [8, 42], needs: 'phone' },
  walk: { id: 'walk', label: '散步', where: ['park'], anchors: ['stroll', 'bench'], windows: [[hm(6), hm(8)], [hm(18, 40), hm(20, 30)]], dur: [20, 45], fun: 0.2, social: 0.1, energy: -0.04, cost: {}, outdoor: true, ages: [16, 95], generic: true },
  bench: { id: 'bench', label: '晒太阳', where: ['park', 'square'], anchors: ['bench'], windows: [[hm(9), hm(11, 30)], [hm(14, 30), hm(17)]], dur: [25, 60], fun: 0.16, social: 0.16, energy: 0.02, cost: {}, outdoor: true, ages: [58, 95], generic: true },
  tv: { id: 'tv', label: '看电视', where: ['home'], anchors: ['sofa'], windows: [[hm(19), hm(22, 30)], [hm(12, 30), hm(14)]], dur: [35, 110], fun: 0.2, social: 0.02, energy: 0.01, cost: {}, outdoor: false, ages: [4, 95], needs: 'tv', generic: true },
  phone: { id: 'phone', label: '刷手机', where: ['home'], anchors: ['sofa', 'bed', 'dine'], windows: [[hm(12), hm(13, 30)], [hm(20), hm(23, 30)]], dur: [15, 50], fun: 0.17, social: 0.04, energy: -0.01, cost: {}, outdoor: false, ages: [12, 95], needs: 'phone', generic: true },
};

/** 兴趣在人群里的分布：按年龄段与性别的权重 */
export const INTEREST_WEIGHTS: Array<{ hobby: string; w: (age: number, female: boolean) => number }> = [
  { hobby: 'chess', w: (a, f) => (a >= 55 ? (f ? 0.12 : 0.6) : a >= 14 ? (f ? 0.05 : 0.16) : 0) },
  { hobby: 'cards', w: (a) => (a >= 50 ? 0.5 : a >= 25 ? 0.2 : 0) },
  { hobby: 'tea', w: (a) => (a >= 55 ? 0.45 : a >= 35 ? 0.18 : 0) },
  { hobby: 'dance', w: (a, f) => (a >= 45 && a <= 78 ? (f ? 0.62 : 0.12) : 0) },
  { hobby: 'taichi', w: (a) => (a >= 58 ? 0.45 : a >= 45 ? 0.15 : 0) },
  { hobby: 'ball', w: (a, f) => (a >= 10 && a <= 45 ? (f ? 0.14 : 0.42) : 0) },
  { hobby: 'play', w: (a) => (a <= 13 ? 1 : 0) },
  { hobby: 'read', w: (a) => (a >= 8 ? 0.26 : 0) },
  { hobby: 'game', w: (a, f) => (a >= 8 && a <= 40 ? (f ? 0.3 : 0.55) : 0) },
];

// ───────────────────────── 物品

export interface ItemInfo {
  id: string;
  label: string;
  /** 属于个人还是家庭 */
  of: 'person' | 'household';
}

export const ITEMS: Record<string, ItemInfo> = {
  phone: { id: 'phone', label: '手机', of: 'person' },
  ebike: { id: 'ebike', label: '电动车', of: 'person' },
  bike: { id: 'bike', label: '自行车', of: 'person' },
  chess_set: { id: 'chess_set', label: '象棋', of: 'person' },
  fan: { id: 'fan', label: '舞扇', of: 'person' },
  ball: { id: 'ball', label: '篮球', of: 'person' },
  books: { id: 'books', label: '几本书', of: 'person' },
  thermos: { id: 'thermos', label: '保温杯', of: 'person' },
  schoolbag: { id: 'schoolbag', label: '书包', of: 'person' },
  cart: { id: 'cart', label: '买菜小拉车', of: 'person' },
  laptop: { id: 'laptop', label: '笔记本电脑', of: 'person' },
  tv: { id: 'tv', label: '电视', of: 'household' },
  fridge: { id: 'fridge', label: '冰箱', of: 'household' },
  washer: { id: 'washer', label: '洗衣机', of: 'household' },
  aircon: { id: 'aircon', label: '空调', of: 'household' },
  car: { id: 'car', label: '小汽车', of: 'household' },
};

export const GOODS_LABEL: Record<string, string> = { food: '菜和粮', supplies: '日用品', meal: '一顿饭', tea: '茶位' };
