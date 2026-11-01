/**
 * town30：30 人、12 户、10 个组织、16 处地点的微缩小镇。
 * 河把小镇分成北区（y ≤ 14）与南区（y ≥ 17），两座桥相连。
 * 所有人物为合成设定，不对应真实个人。
 */
import { at, hm } from '../core/time.ts';
import type { PlaceDef, Prop, TileKind } from '../world/map.ts';
import type { NewsDraft } from '../info/types.ts';
import type { HouseholdDef, OfferDef, OrgDef, PersonDef, RelationDef, ScenarioDef } from './types.ts';
import { clarifyDraft, noticeDraft, scriptFromEvents, truthOf, type OutageEventSpec } from './events.ts';

// ---------- 地图 ----------
const W = 44;
const H = 32;

function buildTiles(): TileKind[] {
  const t: TileKind[] = Array.from({ length: W * H }, () => 'grass' as TileKind);
  const fill = (x0: number, y0: number, x1: number, y1: number, k: TileKind) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x >= 0 && y >= 0 && x < W && y < H) t[y * W + x] = k;
  };
  fill(0, 0, 13, 5, 'park'); // 北岸公园
  // 人行道
  fill(16, 5, 29, 5, 'path');
  fill(32, 5, 43, 5, 'path');
  fill(0, 13, 43, 13, 'path');
  fill(0, 14, 43, 14, 'path'); // 北岸河滨步道
  fill(0, 17, 43, 17, 'path'); // 南岸河滨步道
  fill(0, 23, 43, 23, 'path');
  fill(0, 31, 43, 31, 'path');
  // 道路
  fill(0, 6, 43, 7, 'road'); // 北街
  fill(0, 24, 43, 25, 'road'); // 南街
  fill(14, 0, 15, 31, 'road');
  fill(30, 0, 31, 31, 'road');
  // 河与桥
  fill(0, 15, 43, 16, 'water');
  fill(14, 15, 15, 16, 'bridge');
  fill(30, 15, 31, 16, 'bridge');
  // 广场
  fill(16, 18, 21, 22, 'plaza'); // P01 中央广场
  fill(10, 8, 13, 12, 'plaza'); // P03 北街路口
  // 建筑占地
  for (const p of PLACES) if (!p.open) fill(p.rect.x, p.rect.y, p.rect.x + p.rect.w - 1, p.rect.y + p.rect.h - 1, 'lot');
  for (const [x, y] of TREES) t[y * W + x] = 'tree';
  for (const [x, y] of FLOWERS) t[y * W + x] = 'flower';
  return t;
}

const TREES: Array<[number, number]> = [
  [1, 1], [4, 0], [9, 0], [12, 1], [2, 4], [11, 4], [6, 1],
  [26, 1], [28, 3], [27, 0], [16, 1],
  [41, 1], [42, 3], [33, 2],
  [40, 9], [42, 11], [39, 12], [43, 8],
  [11, 19], [12, 21], [10, 22],
  [41, 27], [42, 29],
  [26, 27], [28, 29], [27, 26],
  [11, 27], [12, 29], [0, 28],
  [0, 9], [1, 12],
];
const FLOWERS: Array<[number, number]> = [
  [29, 19], [29, 21], [22, 12], [16, 12], [9, 29], [39, 21],
];

const hours = (...pairs: Array<[number, number, number, number]>): Array<[number, number]> =>
  pairs.map(([h0, m0, h1, m1]) => [hm(h0, m0), hm(h1, m1)]);

export const PLACES: PlaceDef[] = [
  { id: 'R01', name: '北岸公寓 A', short: '北公寓A', district: 'north', kind: 'residence', rect: { x: 2, y: 8, w: 7, h: 5 }, door: { x: 5, y: 13 }, open: false, hours: null, needsPower: true, capacity: 99, units: 4, style: { wall: '#ead4aa', roof: '#be4a2f', trim: '#733e39', floors: 3 } },
  { id: 'R02', name: '北岸公寓 B', short: '北公寓B', district: 'north', kind: 'residence', rect: { x: 34, y: 0, w: 7, h: 5 }, door: { x: 37, y: 5 }, open: false, hours: null, needsPower: true, capacity: 99, units: 4, style: { wall: '#e4a672', roof: '#a22633', trim: '#733e39', floors: 3 } },
  { id: 'R03', name: '南街住宅', short: '南住宅', district: 'south', kind: 'residence', rect: { x: 2, y: 26, w: 7, h: 5 }, door: { x: 5, y: 31 }, open: false, hours: null, needsPower: true, capacity: 99, units: 4, style: { wall: '#c0cbdc', roof: '#3a4466', trim: '#5a6988', floors: 3 } },
  { id: 'W01', name: '镇政务中心', short: '政务中心', district: 'south', kind: 'gov', rect: { x: 23, y: 18, w: 6, h: 5 }, door: { x: 25, y: 23 }, open: false, hours: hours([8, 30, 17, 30]), needsPower: true, capacity: 15, style: { wall: '#c0cbdc', roof: '#124e89', trim: '#ffffff', floors: 3, sign: '政' } },
  { id: 'W02', name: '社区诊所', short: '诊所', district: 'south', kind: 'clinic', rect: { x: 33, y: 18, w: 6, h: 5 }, door: { x: 35, y: 23 }, open: false, hours: hours([8, 0, 18, 0]), needsPower: true, capacity: 12, style: { wall: '#ffffff', roof: '#e43b44', trim: '#e43b44', floors: 2, sign: '+' } },
  { id: 'W03', name: '图书馆·成人学校', short: '图书馆', district: 'south', kind: 'library', rect: { x: 17, y: 26, w: 8, h: 5 }, door: { x: 20, y: 31 }, open: false, hours: hours([8, 0, 21, 0]), needsPower: true, capacity: 30, style: { wall: '#b86f50', roof: '#3e8948', trim: '#ead4aa', floors: 2, sign: '书' } },
  { id: 'W04', name: '公用事业维护站', short: '维护站', district: 'south', kind: 'utility', rect: { x: 33, y: 26, w: 6, h: 5 }, door: { x: 35, y: 31 }, open: false, hours: hours([8, 0, 17, 0]), needsPower: true, capacity: 8, style: { wall: '#8b9bb4', roof: '#feae34', trim: '#3a4466', floors: 1, sign: '⚡' } },
  { id: 'W05', name: '社区报编辑部', short: '编辑部', district: 'south', kind: 'newsroom', rect: { x: 40, y: 19, w: 4, h: 4 }, door: { x: 41, y: 23 }, open: false, hours: hours([9, 0, 18, 0]), needsPower: true, capacity: 6, style: { wall: '#ead4aa', roof: '#68386c', trim: '#262b44', floors: 2, sign: '报' } },
  { id: 'W06', name: '南街超市', short: '超市', district: 'south', kind: 'supermarket', rect: { x: 2, y: 18, w: 8, h: 5 }, door: { x: 5, y: 23 }, open: false, hours: hours([8, 0, 21, 0]), needsPower: true, capacity: 20, style: { wall: '#ffffff', roof: '#63c74d', trim: '#3e8948', floors: 1, sign: '市' } },
  { id: 'W07', name: '北岸咖啡馆', short: '咖啡馆', district: 'north', kind: 'cafe', rect: { x: 17, y: 8, w: 5, h: 5 }, door: { x: 19, y: 13 }, open: false, hours: hours([7, 0, 19, 0]), needsPower: true, capacity: 16, style: { wall: '#e4a672', roof: '#733e39', trim: '#fee761', floors: 1, sign: '咖' } },
  { id: 'W08', name: '河畔小馆', short: '小馆', district: 'north', kind: 'restaurant', rect: { x: 23, y: 8, w: 6, h: 5 }, door: { x: 25, y: 13 }, open: false, hours: hours([11, 0, 14, 30], [17, 0, 21, 0]), needsPower: true, capacity: 20, style: { wall: '#be4a2f', roof: '#3e2731', trim: '#feae34', floors: 1, sign: '食' } },
  { id: 'W09', name: '北街便利店', short: '便利店', district: 'north', kind: 'convenience', rect: { x: 33, y: 9, w: 5, h: 4 }, door: { x: 35, y: 13 }, open: false, hours: hours([7, 0, 22, 0]), needsPower: true, capacity: 6, style: { wall: '#ffffff', roof: '#0099db', trim: '#f77622', floors: 1, sign: '便' } },
  { id: 'W10', name: '像素设计工作室', short: '工作室', district: 'north', kind: 'studio', rect: { x: 17, y: 0, w: 8, h: 5 }, door: { x: 20, y: 5 }, open: false, hours: hours([9, 0, 19, 0]), needsPower: true, capacity: 10, style: { wall: '#5a6988', roof: '#262b44', trim: '#2ce8f5', floors: 2, sign: '设' } },
  { id: 'P01', name: '中央广场', short: '中央广场', district: 'south', kind: 'plaza', rect: { x: 16, y: 18, w: 6, h: 5 }, door: { x: 18, y: 23 }, open: true, hours: null, needsPower: false, capacity: 30, style: { wall: '#c0cbdc', roof: '#c0cbdc', trim: '#8b9bb4', floors: 0 }, board: { id: 'BA', tile: { x: 16, y: 18 } } },
  { id: 'P02', name: '北岸公园', short: '北岸公园', district: 'north', kind: 'park', rect: { x: 0, y: 0, w: 14, h: 6 }, door: { x: 7, y: 5 }, open: true, hours: null, needsPower: false, capacity: 30, style: { wall: '#63c74d', roof: '#63c74d', trim: '#3e8948', floors: 0 } },
  { id: 'P03', name: '北街路口', short: '北街路口', district: 'north', kind: 'plaza', rect: { x: 10, y: 8, w: 4, h: 5 }, door: { x: 12, y: 13 }, open: true, hours: null, needsPower: false, capacity: 12, style: { wall: '#c0cbdc', roof: '#c0cbdc', trim: '#8b9bb4', floors: 0 }, board: { id: 'BB', tile: { x: 13, y: 8 } } },
];

const PROPS: Prop[] = [
  ...TREES.map(([x, y]) => ({ kind: 'tree' as const, x, y })),
  ...FLOWERS.map(([x, y]) => ({ kind: 'flower' as const, x, y })),
  { kind: 'board', x: 16, y: 18, ref: 'BA' },
  { kind: 'board', x: 13, y: 8, ref: 'BB' },
  { kind: 'fountain', x: 19, y: 20 },
  { kind: 'bench', x: 5, y: 3 },
  { kind: 'bench', x: 8, y: 2 },
  { kind: 'bench', x: 21, y: 22 },
  { kind: 'bench', x: 11, y: 11 },
  ...[
    [3, 13], [11, 13], [23, 13], [29, 13], [39, 13], [3, 17], [11, 17], [23, 17], [29, 17], [39, 17],
    [3, 23], [12, 23], [29, 23], [38, 23], [3, 31], [12, 31], [27, 31], [40, 31], [22, 5], [38, 5],
  ].map(([x, y]) => ({ kind: 'lamp' as const, x: x!, y: y! })),
];

// ---------- 人口 ----------
type P = Omit<PersonDef, 'traits' | 'habits' | 'look'> & {
  t: [number, number, number, number, number, number, number, number, number];
  h: PersonDef['habits'];
  look: PersonDef['look'];
};
const traits = (t: P['t']) => ({
  anxiety: t[0], riskAversion: t[1], sociability: t[2], order: t[3], curiosity: t[4],
  altruism: t[5], commitment: t[6], trustOfficial: t[7], detail: t[8],
});

const SK1 = '#e8b796';
const SK2 = '#c28569';
const SK3 = '#e4a672';

const RAW: P[] = [
  // ---- R01 北岸公寓 A（北）----
  { id: 'a01', name: '周旻', age: 67, gender: 'm', household: 'h01', role: 'retiree', roleLabel: '退休工程师', bio: '退休工程师，作息规律，爱去图书馆，关心公共设施；独居，女儿住在南区。', speech: '慢条斯理，爱用具体数字', wallet: 3200,
    t: [0.3, 0.6, 0.45, 0.85, 0.7, 0.6, 0.8, 0.7, 0.85], h: { website: ['wake'], push: false, phone: 'mid', readDepth: 0.9, drain: 4, lunch: 'home', leisure: ['W03', 'P02'] },
    look: { skin: SK1, hair: '#c0cbdc', hairStyle: 'short', shirt: '#124e89', pants: '#3a4466', accessory: 'glasses' } },
  { id: 'a02', name: '林澄', age: 34, gender: 'f', household: 'h02', role: 'cafe_manager', roleLabel: '咖啡馆值班经理', org: 'cafe', workplace: 'W07', bio: '咖啡馆早班经理，时间紧，看重承诺；主要听同事转述，对地方通知中等信任但有查证习惯。', speech: '干脆利落，常带工作口吻', wallet: 4200,
    t: [0.45, 0.55, 0.6, 0.75, 0.5, 0.55, 0.9, 0.55, 0.7], h: { website: [], push: false, phone: 'mid', readDepth: 0.7, drain: 6, lunch: 'workplace', leisure: ['P02'] },
    look: { skin: SK1, hair: '#3e2731', hairStyle: 'bun', shirt: '#feae34', pants: '#262b44', accessory: 'apron' } },
  { id: 'a03', name: '何远', age: 36, gender: 'm', household: 'h02', role: 'studio_lead', roleLabel: '设计工作室主管', org: 'studio', workplace: 'W10', bio: '设计工作室合伙人，项目截止压力大，习惯看消息推送、在群里对齐安排。', speech: '语速快，爱说“先对齐一下”', wallet: 6000,
    t: [0.35, 0.4, 0.55, 0.6, 0.6, 0.5, 0.75, 0.6, 0.6], h: { website: [], push: false, phone: 'high', readDepth: 0.75, drain: 8, lunch: 'cafe', leisure: ['W07'] },
    look: { skin: SK1, hair: '#181425', hairStyle: 'short', shirt: '#5a6988', pants: '#262b44', accessory: 'glasses' } },
  { id: 'a04', name: '陈建国', age: 58, gender: 'm', household: 'h03', role: 'technician', roleLabel: '维护站技术员', org: 'utility', workplace: 'W04', bio: '维护站老技术员，北区这次线路检修就是他们班组负责。', speech: '朴实，爱说“没事，按计划来”', wallet: 3500,
    t: [0.2, 0.5, 0.5, 0.8, 0.4, 0.6, 0.85, 0.8, 0.8], h: { website: [], push: false, phone: 'low', readDepth: 0.6, drain: 3, lunch: 'bring', leisure: ['P01'] },
    look: { skin: SK2, hair: '#3e2731', hairStyle: 'cap', shirt: '#f77622', pants: '#3a4466' } },
  { id: 'a05', name: '王秀兰', age: 56, gender: 'f', household: 'h03', role: 'caregiver', roleLabel: '全职操持家务', bio: '操持一家人的饮食起居，消息多来自邻居和家人，凡事爱往细处想。', speech: '热心肠，爱叮嘱家人', wallet: 1800,
    t: [0.65, 0.7, 0.7, 0.7, 0.45, 0.75, 0.7, 0.6, 0.45], h: { website: [], push: false, phone: 'low', readDepth: 0.5, drain: 3, lunch: 'home', leisure: ['W06', 'P02'] },
    look: { skin: SK1, hair: '#3e2731', hairStyle: 'curly', shirt: '#b55088', pants: '#733e39' } },
  { id: 'a06', name: '陈一鸣', age: 26, gender: 'm', household: 'h03', role: 'wfh', roleLabel: '在家接单的插画师', bio: '在家接单的插画师，白天窝在家里赶稿，全靠电脑和网络。', speech: '话少，网感重', wallet: 2600,
    t: [0.4, 0.45, 0.3, 0.4, 0.65, 0.4, 0.6, 0.5, 0.55], h: { website: [], push: false, phone: 'high', readDepth: 0.6, drain: 9, lunch: 'home', leisure: ['W07'] },
    look: { skin: SK1, hair: '#181425', hairStyle: 'long', shirt: '#63c74d', pants: '#262b44' } },
  { id: 'a07', name: '赵国庆', age: 45, gender: 'm', household: 'h04', role: 'chef_owner', roleLabel: '小馆主厨兼老板', org: 'restaurant', workplace: 'W08', bio: '河畔小馆的主厨兼老板，心思都在灶台上，店里的事他说了算。', speech: '嗓门大，爽快', wallet: 5200,
    t: [0.35, 0.4, 0.55, 0.65, 0.3, 0.5, 0.8, 0.5, 0.5], h: { website: [], push: true, phone: 'mid', readDepth: 0.4, drain: 5, lunch: 'workplace', leisure: [] },
    look: { skin: SK2, hair: '#181425', hairStyle: 'short', shirt: '#ffffff', pants: '#3a4466', accessory: 'apron' } },
  { id: 'a08', name: '刘梅', age: 43, gender: 'f', household: 'h04', role: 'market_manager', roleLabel: '超市店长', org: 'market', workplace: 'W06', bio: '南街超市店长，精打细算，库存和排班都装在脑子里。', speech: '条理清楚，爱算账', wallet: 4800,
    t: [0.5, 0.65, 0.6, 0.8, 0.5, 0.55, 0.85, 0.65, 0.75], h: { website: [], push: true, phone: 'mid', readDepth: 0.7, drain: 5, lunch: 'workplace', leisure: [] },
    look: { skin: SK1, hair: '#733e39', hairStyle: 'bun', shirt: '#63c74d', pants: '#262b44' } },
  { id: 'a09', name: '赵子涵', age: 20, gender: 'f', household: 'h04', role: 'student', roleLabel: '成年学生', bio: '成人学校的学生，在图书馆上课自习，朋友圈活跃。', speech: '活泼，爱用网络用语', wallet: 900,
    t: [0.45, 0.35, 0.8, 0.4, 0.7, 0.5, 0.5, 0.45, 0.4], h: { website: [], push: true, phone: 'high', readDepth: 0.5, drain: 10, lunch: 'cafe', leisure: ['W07', 'P01'] },
    look: { skin: SK1, hair: '#3e2731', hairStyle: 'long', shirt: '#f6757a', pants: '#124e89' } },
  { id: 'a10', name: '刘桂芳', age: 72, gender: 'f', household: 'h04', role: 'retiree', roleLabel: '退休', bio: '刘梅的母亲，腿脚不太利索，下午爱在家看电视。', speech: '絮絮叨叨，爱念叨“注意安全”', wallet: 2200,
    t: [0.6, 0.75, 0.5, 0.85, 0.3, 0.6, 0.6, 0.75, 0.35], h: { website: [], push: false, phone: 'low', readDepth: 0.3, drain: 2, lunch: 'home', leisure: ['P02'] },
    look: { skin: SK3, hair: '#c0cbdc', hairStyle: 'bun', shirt: '#a22633', pants: '#3e2731', accessory: 'scarf' } },
  // ---- R02 北岸公寓 B（北）----
  { id: 'a11', name: '夏晴', age: 23, gender: 'f', household: 'h05', role: 'student', roleLabel: '成年学生', bio: '成年学生，社交活跃，预算紧，常看推送，但对耸动标题保持怀疑。', speech: '轻快，爱反问“真的假的？”', wallet: 800,
    t: [0.3, 0.35, 0.85, 0.35, 0.75, 0.55, 0.5, 0.45, 0.6], h: { website: [], push: true, phone: 'high', readDepth: 0.65, drain: 10, lunch: 'cafe', leisure: ['W07', 'P01', 'P02'] },
    look: { skin: SK1, hair: '#181425', hairStyle: 'bob', shirt: '#0099db', pants: '#3a4466' } },
  { id: 'a12', name: '孙浩', age: 29, gender: 'm', household: 'h06', role: 'designer', roleLabel: '设计师', org: 'studio', workplace: 'W10', bio: '工作室设计师，下班爱去咖啡馆续杯，消息主要来自同事。', speech: '随和，爱开玩笑', wallet: 3100,
    t: [0.3, 0.4, 0.6, 0.5, 0.55, 0.45, 0.6, 0.5, 0.5], h: { website: [], push: false, phone: 'high', readDepth: 0.5, drain: 8, lunch: 'restaurant', leisure: ['W07'] },
    look: { skin: SK1, hair: '#733e39', hairStyle: 'short', shirt: '#ead4aa', pants: '#262b44' } },
  { id: 'a13', name: '李想', age: 28, gender: 'f', household: 'h06', role: 'reporter', roleLabel: '社区报记者', org: 'press', workplace: 'W05', bio: '社区报记者，习惯核对原始公告，一天看好几次镇网站。', speech: '清楚准确，爱追问来源', wallet: 2900,
    t: [0.35, 0.45, 0.7, 0.6, 0.9, 0.6, 0.7, 0.55, 0.9], h: { website: ['wake', 'lunch', 'evening'], push: true, phone: 'high', readDepth: 0.95, drain: 8, lunch: 'cafe', leisure: ['P01'] },
    look: { skin: SK1, hair: '#3e2731', hairStyle: 'long', shirt: '#68386c', pants: '#3a4466', accessory: 'glasses' } },
  { id: 'a14', name: '冯磊', age: 44, gender: 'm', household: 'h07', role: 'clerk', roleLabel: '便利店店长', org: 'convenience', workplace: 'W09', bio: '北街便利店店长，午后守店到打烊，街坊消息的中转站。', speech: '街坊味重，爱聊家常', wallet: 2700,
    t: [0.5, 0.5, 0.75, 0.55, 0.5, 0.5, 0.6, 0.5, 0.35], h: { website: [], push: false, phone: 'mid', readDepth: 0.4, drain: 5, lunch: 'home', leisure: [] },
    look: { skin: SK2, hair: '#181425', hairStyle: 'cap', shirt: '#0099db', pants: '#3a4466' } },
  { id: 'a15', name: '马芳', age: 42, gender: 'f', household: 'h07', role: 'caregiver', roleLabel: '全职照顾家人', bio: '全职照顾家人，心细也容易往坏处想，街坊里消息传得最快的一位。', speech: '语气急，爱说“你可得当心”', wallet: 1500,
    t: [0.85, 0.8, 0.8, 0.6, 0.55, 0.7, 0.65, 0.5, 0.3], h: { website: [], push: false, phone: 'mid', readDepth: 0.45, drain: 5, lunch: 'home', leisure: ['P02', 'W06'] },
    look: { skin: SK1, hair: '#733e39', hairStyle: 'long', shirt: '#b55088', pants: '#262b44' } },
  { id: 'a16', name: '冯骁', age: 20, gender: 'm', household: 'h07', role: 'student', roleLabel: '成年学生', bio: '成年学生，打游戏到深夜，手机电量常年告急。', speech: '懒洋洋，爱说“无所谓”', wallet: 600,
    t: [0.25, 0.3, 0.6, 0.25, 0.5, 0.4, 0.4, 0.4, 0.35], h: { website: [], push: true, phone: 'high', readDepth: 0.35, drain: 12, lunch: 'cafe', leisure: ['W07', 'P01'] },
    look: { skin: SK1, hair: '#181425', hairStyle: 'short', shirt: '#3e8948', pants: '#124e89' } },
  { id: 'a17', name: '吴德明', age: 66, gender: 'm', household: 'h08', role: 'retiree', roleLabel: '退休语文教师', bio: '退休语文教师，早上遛弯、下午读报，爱给年轻人讲道理。', speech: '字斟句酌，爱引用老话', wallet: 3400,
    t: [0.35, 0.55, 0.65, 0.8, 0.6, 0.65, 0.75, 0.7, 0.75], h: { website: ['wake'], push: false, phone: 'low', readDepth: 0.85, drain: 3, lunch: 'home', leisure: ['P02', 'W03', 'P03'] },
    look: { skin: SK3, hair: '#c0cbdc', hairStyle: 'short', shirt: '#3e8948', pants: '#733e39', accessory: 'glasses' } },
  { id: 'a18', name: '吴洁', age: 35, gender: 'f', household: 'h08', role: 'nurse', roleLabel: '诊所护士', org: 'clinic', workplace: 'W02', bio: '诊所护士，吴德明的女儿，排班紧，下班只想回家。', speech: '温和但简短', wallet: 3000,
    t: [0.4, 0.6, 0.5, 0.7, 0.45, 0.7, 0.8, 0.65, 0.65], h: { website: [], push: false, phone: 'mid', readDepth: 0.65, drain: 6, lunch: 'workplace', leisure: [] },
    look: { skin: SK1, hair: '#3e2731', hairStyle: 'bun', shirt: '#ffffff', pants: '#8b9bb4' } },
  { id: 'a19', name: '唐诚', age: 40, gender: 'm', household: 'h08', role: 'gov_liaison', roleLabel: '社区联络员', org: 'gov', workplace: 'W01', bio: '政务中心社区联络员，吴洁的丈夫，习惯把通知带给街坊。', speech: '正式，爱说“按通知来”', wallet: 3600,
    t: [0.3, 0.5, 0.75, 0.7, 0.5, 0.7, 0.8, 0.85, 0.7], h: { website: ['lunch'], push: true, phone: 'mid', readDepth: 0.8, drain: 6, lunch: 'workplace', leisure: ['P01'] },
    look: { skin: SK1, hair: '#181425', hairStyle: 'short', shirt: '#124e89', pants: '#262b44' } },
  { id: 'a20', name: '吴悠', age: 31, gender: 'f', household: 'h08', role: 'server', roleLabel: '小馆服务员', org: 'restaurant', workplace: 'W08', bio: '河畔小馆服务员，吴德明的小女儿，爱热闹也爱传话。', speech: '爽朗，句句带感叹号', wallet: 1900,
    t: [0.45, 0.4, 0.85, 0.45, 0.6, 0.55, 0.55, 0.45, 0.4], h: { website: [], push: false, phone: 'high', readDepth: 0.45, drain: 9, lunch: 'workplace', leisure: ['P02', 'W07'] },
    look: { skin: SK1, hair: '#733e39', hairStyle: 'ponytail', shirt: '#be4a2f', pants: '#262b44', accessory: 'apron' } },
  // ---- R03 南街住宅（南）----
  { id: 'a21', name: '韩雪', age: 26, gender: 'f', household: 'h09', role: 'designer', roleLabel: '设计师', org: 'studio', workplace: 'W10', bio: '工作室设计师，每天过桥去北区上班，独居。', speech: '安静，打字比说话多', wallet: 2800,
    t: [0.4, 0.45, 0.5, 0.6, 0.6, 0.45, 0.65, 0.55, 0.6], h: { website: [], push: false, phone: 'high', readDepth: 0.6, drain: 8, lunch: 'cafe', leisure: ['W03'] },
    look: { skin: SK1, hair: '#181425', hairStyle: 'long', shirt: '#2ce8f5', pants: '#3a4466' } },
  { id: 'a22', name: '苏文', age: 47, gender: 'f', household: 'h10', role: 'doctor', roleLabel: '诊所医生', org: 'clinic', workplace: 'W02', bio: '诊所医生，冷静务实，只信有来源的消息。', speech: '冷静，句子短', wallet: 6500,
    t: [0.25, 0.6, 0.45, 0.8, 0.5, 0.7, 0.85, 0.7, 0.85], h: { website: ['wake'], push: false, phone: 'mid', readDepth: 0.85, drain: 5, lunch: 'workplace', leisure: ['W03'] },
    look: { skin: SK1, hair: '#3e2731', hairStyle: 'short', shirt: '#ffffff', pants: '#5a6988', accessory: 'glasses' } },
  { id: 'a23', name: '罗晓', age: 45, gender: 'm', household: 'h10', role: 'librarian', roleLabel: '图书馆管理员', org: 'library', workplace: 'W03', bio: '图书馆管理员兼成人学校老师，熟悉镇上每个常来的读者。', speech: '耐心，爱推荐书', wallet: 3300,
    t: [0.3, 0.5, 0.6, 0.75, 0.7, 0.65, 0.75, 0.65, 0.75], h: { website: [], push: false, phone: 'mid', readDepth: 0.85, drain: 5, lunch: 'workplace', leisure: [] },
    look: { skin: SK1, hair: '#733e39', hairStyle: 'short', shirt: '#b86f50', pants: '#3a4466', accessory: 'glasses' } },
  { id: 'a24', name: '郭敏', age: 41, gender: 'f', household: 'h11', role: 'gov_clerk', roleLabel: '政务中心办事员', org: 'gov', workplace: 'W01', bio: '政务中心办事员，负责起草和发布镇上的公告。', speech: '规范，像在念通知', wallet: 3900,
    t: [0.35, 0.55, 0.55, 0.85, 0.5, 0.6, 0.85, 0.9, 0.9], h: { website: ['wake'], push: true, phone: 'mid', readDepth: 0.9, drain: 5, lunch: 'workplace', leisure: [] },
    look: { skin: SK1, hair: '#3e2731', hairStyle: 'bun', shirt: '#124e89', pants: '#262b44' } },
  { id: 'a25', name: '蒋涛', age: 43, gender: 'm', household: 'h11', role: 'technician', roleLabel: '维护站技术员', org: 'utility', workplace: 'W04', bio: '维护站技术员，郭敏的丈夫，和陈建国一个班组。', speech: '惜字如金', wallet: 3400,
    t: [0.25, 0.45, 0.55, 0.7, 0.4, 0.55, 0.8, 0.75, 0.7], h: { website: [], push: false, phone: 'low', readDepth: 0.55, drain: 4, lunch: 'bring', leisure: ['P01'] },
    look: { skin: SK2, hair: '#181425', hairStyle: 'cap', shirt: '#f77622', pants: '#3a4466' } },
  { id: 'a26', name: '郑淑珍', age: 70, gender: 'f', household: 'h11', role: 'retiree', roleLabel: '退休', bio: '郭敏的母亲，每天去广场跳操，南区的家长里短她都知道。', speech: '热闹，爱拉家常', wallet: 2100,
    t: [0.5, 0.65, 0.9, 0.7, 0.6, 0.7, 0.6, 0.6, 0.35], h: { website: [], push: false, phone: 'low', readDepth: 0.3, drain: 2, lunch: 'home', leisure: ['P01', 'W06'] },
    look: { skin: SK3, hair: '#c0cbdc', hairStyle: 'curly', shirt: '#e43b44', pants: '#3e2731' } },
  { id: 'a27', name: '高宇', age: 24, gender: 'm', household: 'h12', role: 'barista', roleLabel: '咖啡师', org: 'cafe', workplace: 'W07', bio: '北岸咖啡馆的咖啡师，每天从南区过桥上班，和林澄搭班。', speech: '爽快，爱接话', wallet: 1700,
    t: [0.3, 0.35, 0.7, 0.45, 0.55, 0.5, 0.6, 0.45, 0.45], h: { website: [], push: false, phone: 'high', readDepth: 0.45, drain: 9, lunch: 'workplace', leisure: ['P01'] },
    look: { skin: SK1, hair: '#3e2731', hairStyle: 'short', shirt: '#733e39', pants: '#262b44', accessory: 'apron' } },
  { id: 'a28', name: '杨帆', age: 27, gender: 'f', household: 'h12', role: 'cashier', roleLabel: '超市收银员', org: 'market', workplace: 'W06', bio: '超市收银员，下午到晚上当班，爱刷手机。', speech: '快言快语', wallet: 1600,
    t: [0.45, 0.45, 0.65, 0.5, 0.55, 0.5, 0.6, 0.5, 0.45], h: { website: [], push: false, phone: 'high', readDepth: 0.5, drain: 9, lunch: 'home', leisure: ['P01'] },
    look: { skin: SK1, hair: '#181425', hairStyle: 'long', shirt: '#63c74d', pants: '#3a4466' } },
  { id: 'a29', name: '田亮', age: 41, gender: 'm', household: 'h12', role: 'wfh', roleLabel: '自由译者', bio: '在家做翻译的自由职业者，南区合租房里的“老大哥”。', speech: '稳重，爱讲道理', wallet: 3000,
    t: [0.3, 0.5, 0.45, 0.65, 0.6, 0.55, 0.7, 0.6, 0.75], h: { website: ['evening'], push: false, phone: 'mid', readDepth: 0.8, drain: 6, lunch: 'home', leisure: ['W03'] },
    look: { skin: SK1, hair: '#3e2731', hairStyle: 'short', shirt: '#8b9bb4', pants: '#262b44', accessory: 'glasses' } },
  { id: 'a30', name: '周蕾', age: 39, gender: 'f', household: 'h12', role: 'jobseeker', roleLabel: '求职中', bio: '周旻的女儿，正在找工作，常去图书馆投简历，放心不下独居的父亲。', speech: '关切，爱追问细节', wallet: 2400,
    t: [0.6, 0.6, 0.6, 0.6, 0.6, 0.85, 0.7, 0.65, 0.6], h: { website: ['wake'], push: true, phone: 'high', readDepth: 0.7, drain: 7, lunch: 'home', leisure: ['W03', 'P01'] },
    look: { skin: SK1, hair: '#3e2731', hairStyle: 'long', shirt: '#d77643', pants: '#3a4466' } },
];

const PEOPLE: PersonDef[] = RAW.map(({ t, h, ...rest }) => ({ ...rest, traits: traits(t), habits: h }));

const HOUSEHOLDS: HouseholdDef[] = [
  { id: 'h01', label: '周家', place: 'R01', unit: 1, members: ['a01'], food: 6 },
  { id: 'h02', label: '林何家', place: 'R01', unit: 2, members: ['a02', 'a03'], food: 8 },
  { id: 'h03', label: '陈家', place: 'R01', unit: 3, members: ['a04', 'a05', 'a06'], food: 14 },
  { id: 'h04', label: '赵家', place: 'R01', unit: 4, members: ['a07', 'a08', 'a09', 'a10'], food: 16 },
  { id: 'h05', label: '夏晴', place: 'R02', unit: 1, members: ['a11'], food: 4 },
  { id: 'h06', label: '孙李家', place: 'R02', unit: 2, members: ['a12', 'a13'], food: 8 },
  { id: 'h07', label: '冯家', place: 'R02', unit: 3, members: ['a14', 'a15', 'a16'], food: 12 },
  { id: 'h08', label: '吴家', place: 'R02', unit: 4, members: ['a17', 'a18', 'a19', 'a20'], food: 16 },
  { id: 'h09', label: '韩雪', place: 'R03', unit: 1, members: ['a21'], food: 4 },
  { id: 'h10', label: '苏罗家', place: 'R03', unit: 2, members: ['a22', 'a23'], food: 8 },
  { id: 'h11', label: '郭蒋家', place: 'R03', unit: 3, members: ['a24', 'a25', 'a26'], food: 12 },
  { id: 'h12', label: '南街合租', place: 'R03', unit: 4, members: ['a27', 'a28', 'a29', 'a30'], food: 12 },
];

const ORGS: OrgDef[] = [
  { id: 'cafe', name: '北岸咖啡馆', place: 'W07', manager: 'a02', staff: ['a02', 'a27'], capital: 20000, externalDaily: 900, externalSource: 'ext:visitors', wages: { a02: 420, a27: 300 } },
  { id: 'restaurant', name: '河畔小馆', place: 'W08', manager: 'a07', staff: ['a07', 'a20'], capital: 24000, externalDaily: 1100, externalSource: 'ext:visitors', wages: { a07: 450, a20: 280 } },
  { id: 'convenience', name: '北街便利店', place: 'W09', manager: 'a14', staff: ['a14'], capital: 12000, externalDaily: 500, externalSource: 'ext:visitors', wages: { a14: 300 } },
  { id: 'market', name: '南街超市', place: 'W06', manager: 'a08', staff: ['a08', 'a28'], capital: 40000, externalDaily: 1400, externalSource: 'ext:visitors', wages: { a08: 400, a28: 260 } },
  { id: 'studio', name: '像素设计工作室', place: 'W10', manager: 'a03', staff: ['a03', 'a12', 'a21'], capital: 60000, externalDaily: 1600, externalSource: 'ext:clients', wages: { a03: 520, a12: 420, a21: 420 } },
  { id: 'gov', name: '镇政务中心', place: 'W01', manager: 'a24', staff: ['a24', 'a19'], capital: 80000, externalDaily: 800, externalSource: 'ext:town_budget', wages: { a24: 380, a19: 360 } },
  { id: 'clinic', name: '社区诊所', place: 'W02', manager: 'a22', staff: ['a22', 'a18'], capital: 50000, externalDaily: 1100, externalSource: 'ext:town_budget', wages: { a22: 600, a18: 400 } },
  { id: 'library', name: '图书馆·成人学校', place: 'W03', manager: 'a23', staff: ['a23'], capital: 30000, externalDaily: 400, externalSource: 'ext:town_budget', wages: { a23: 340 } },
  { id: 'utility', name: '公用事业维护站', place: 'W04', manager: 'a04', staff: ['a04', 'a25'], capital: 50000, externalDaily: 800, externalSource: 'ext:town_budget', wages: { a04: 380, a25: 380 } },
  { id: 'press', name: '社区报编辑部', place: 'W05', manager: 'a13', staff: ['a13'], capital: 15000, externalDaily: 400, externalSource: 'ext:town_budget', wages: { a13: 360 } },
];

const RELATIONS: RelationDef[] = [
  { a: 'a01', b: 'a30', kind: 'family', strength: 0.9, trust: 0.9, note: '父女' },
  { a: 'a02', b: 'a13', kind: 'friend', strength: 0.6, trust: 0.65 },
  { a: 'a02', b: 'a08', kind: 'friend', strength: 0.5, trust: 0.6 },
  { a: 'a11', b: 'a09', kind: 'friend', strength: 0.7, trust: 0.65 },
  { a: 'a11', b: 'a16', kind: 'friend', strength: 0.5, trust: 0.5 },
  { a: 'a11', b: 'a27', kind: 'friend', strength: 0.5, trust: 0.55 },
  { a: 'a11', b: 'a13', kind: 'friend', strength: 0.4, trust: 0.6 },
  { a: 'a06', b: 'a21', kind: 'friend', strength: 0.5, trust: 0.55 },
  { a: 'a06', b: 'a16', kind: 'friend', strength: 0.5, trust: 0.5 },
  { a: 'a15', b: 'a05', kind: 'friend', strength: 0.7, trust: 0.65 },
  { a: 'a15', b: 'a10', kind: 'friend', strength: 0.5, trust: 0.55 },
  { a: 'a15', b: 'a26', kind: 'friend', strength: 0.5, trust: 0.5 },
  { a: 'a17', b: 'a01', kind: 'friend', strength: 0.7, trust: 0.75, note: '棋友' },
  { a: 'a17', b: 'a23', kind: 'friend', strength: 0.5, trust: 0.6 },
  { a: 'a26', b: 'a10', kind: 'friend', strength: 0.5, trust: 0.55 },
  { a: 'a26', b: 'a05', kind: 'friend', strength: 0.4, trust: 0.5 },
  { a: 'a19', b: 'a04', kind: 'friend', strength: 0.4, trust: 0.6 },
  { a: 'a29', b: 'a23', kind: 'friend', strength: 0.4, trust: 0.55 },
  { a: 'a03', b: 'a07', kind: 'friend', strength: 0.4, trust: 0.5 },
  { a: 'a14', b: 'a07', kind: 'friend', strength: 0.4, trust: 0.5 },
  { a: 'a20', b: 'a12', kind: 'friend', strength: 0.5, trust: 0.55 },
  { a: 'a20', b: 'a09', kind: 'friend', strength: 0.4, trust: 0.5 },
  { a: 'a30', b: 'a23', kind: 'friend', strength: 0.4, trust: 0.55 },
  { a: 'a28', b: 'a11', kind: 'friend', strength: 0.4, trust: 0.5 },
  { a: 'a14', b: 'a15', kind: 'family', strength: 0.85, trust: 0.8, note: '夫妻' },
];

const OFFERS: OfferDef[] = [
  { place: 'W07', item: 'coffee', price: 18, stock: 200, restockTo: 200 },
  { place: 'W07', item: 'cafe_meal', price: 32, stock: 40, restockTo: 40 },
  { place: 'W07', item: 'pastry', price: 15, stock: 50, restockTo: 50 },
  { place: 'W08', item: 'meal', price: 38, stock: 80, restockTo: 80 },
  { place: 'W06', item: 'groceries', price: 16, stock: 300, restockTo: 300 },
  { place: 'W06', item: 'power_bank', price: 69, stock: 6, restockTo: 6 },
  { place: 'W09', item: 'groceries', price: 20, stock: 40, restockTo: 40 },
  { place: 'W09', item: 'snack', price: 8, stock: 100, restockTo: 100 },
  { place: 'W09', item: 'power_bank', price: 79, stock: 4, restockTo: 4 },
];

const STIPENDS = [
  { agent: 'a01', amount: 180, source: 'ext:pension' },
  { agent: 'a10', amount: 150, source: 'ext:pension' },
  { agent: 'a17', amount: 190, source: 'ext:pension' },
  { agent: 'a26', amount: 150, source: 'ext:pension' },
  { agent: 'a09', amount: 70, source: 'ext:family' },
  { agent: 'a11', amount: 70, source: 'ext:family' },
  { agent: 'a16', amount: 60, source: 'ext:family' },
  { agent: 'a06', amount: 380, source: 'ext:clients' },
  { agent: 'a29', amount: 400, source: 'ext:clients' },
  { agent: 'a30', amount: 90, source: 'ext:benefit' },
];

// ---------- 场景剧本：停电（事件规格 → 剧本，见 events.ts） ----------
export const OUTAGE_FAMILY = 'F_OUTAGE';
export const OUTAGE_DAY = 4;
export const OUTAGE_FROM = hm(14, 0);
export const OUTAGE_TO = hm(16, 0);
export const OUTAGE_PUBLISH_AT = at(3, 8, 5);
export const CLARIFY_AT = at(3, 16, 0);

/** 经典剧本：D03 08:05 政务中心发通知（标题只写“下午”），D04 14:00–16:00 北区停电 */
export const CLASSIC_EVENTS: OutageEventSpec[] = [
  {
    id: 'E1',
    family: OUTAGE_FAMILY,
    ids: { notice: 'N001', clarify: 'N002', workOrder: 'WO01' },
    texts: { body: '因线路检修，北区（北岸公寓 A/B、咖啡馆、小馆、便利店、设计工作室一带）将于周四（D04）14:00–16:00 停电。请提前为手机等设备充电，需用电办公者请另行安排。南区不受影响。' },
    area: 'north',
    day: OUTAGE_DAY,
    from: OUTAGE_FROM,
    to: OUTAGE_TO,
    notice: { at: OUTAGE_PUBLISH_AT, channels: ['website', 'push', 'board'], headline: 'coarse', advice: ['charge_devices', 'plan_elsewhere'] },
    clarify: null,
    workOrder: true,
  },
];

const CTX = { places: PLACES, orgs: ORGS };
export const N001: NewsDraft = noticeDraft(CLASSIC_EVENTS[0]!, CTX);
export const N002: NewsDraft = clarifyDraft(CLASSIC_EVENTS[0]!, CTX);

export function town30(): ScenarioDef {
  return {
    id: 'town30',
    name: '河岸小镇 · 30 人',
    version: 'town30@1',
    start: at(1, 6, 0),
    map: { w: W, h: H, tiles: buildTiles(), places: PLACES, props: PROPS },
    people: PEOPLE,
    households: HOUSEHOLDS,
    orgs: ORGS,
    relations: RELATIONS,
    items: [
      { id: 'coffee', name: '咖啡' },
      { id: 'cafe_meal', name: '简餐' },
      { id: 'pastry', name: '点心' },
      { id: 'meal', name: '套餐' },
      { id: 'groceries', name: '食材' },
      { id: 'snack', name: '零食' },
      { id: 'power_bank', name: '充电宝' },
    ],
    offers: OFFERS,
    stipends: STIPENDS,
    script: scriptFromEvents(CLASSIC_EVENTS, CTX),
    events: structuredClone(CLASSIC_EVENTS),
    outages: CLASSIC_EVENTS.map(truthOf),
  };
}
