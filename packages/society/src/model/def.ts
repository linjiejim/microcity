/**
 * 社区定义：生成器的输出，运行期间不变。
 * 一切会变的东西都在 state.ts，并且只由事件改变。
 */

/** 一格的边长（米）。世界坐标：x 向东，y 向南，单位米。 */
export const CELL = 4;

export interface Cell {
  x: number;
  y: number;
}

/** 地面：0 空地（不可走）、1 街道、2 小路、3 广场铺地、4 绿地（公园、球场，可走） */
export type Ground = 0 | 1 | 2 | 3 | 4;
export const G_LOT = 0;
export const G_STREET = 1;
export const G_LANE = 2;
export const G_PLAZA = 3;
export const G_GREEN = 4;

/** 门朝向：门外那一格在这个方向 */
export type Facing = 'n' | 's' | 'e' | 'w';

export type PlaceKind =
  | 'house'
  | 'apartment'
  | 'market'
  | 'grocery'
  | 'eatery'
  | 'teahouse'
  | 'center'
  | 'clinic'
  | 'school'
  | 'office'
  | 'workshop'
  | 'park'
  | 'square'
  | 'court'
  | 'busstop';

export interface PlaceStyle {
  wall: string;
  roof: string;
  trim: string;
  /** 外观变体序号（招牌、屋顶形状等由三维层解释） */
  variant: number;
}

export interface PlaceDef {
  id: string;
  kind: PlaceKind;
  name: string;
  /** 占地（格） */
  x: number;
  y: number;
  w: number;
  h: number;
  facing: Facing;
  /** 门外的可步行格；开放空间是入口参考格 */
  door: Cell;
  /** 楼层数；开放空间为 0 */
  floors: number;
  /** 住户单元数；非住宅为 0 */
  units: number;
  /** 开放空间（公园、广场、球场、公交站） */
  open: boolean;
  /** 营业时段（当天秒数）；null 表示全天可进 */
  hours: [number, number] | null;
  capacity: number;
  style: PlaceStyle;
  /** 经营它的单位 */
  firm?: string;
}

export interface PropDef {
  kind: 'tree' | 'lamp' | 'bush' | 'bike' | 'bin' | 'plot';
  /** 世界坐标（米） */
  x: number;
  y: number;
  /** 大小系数与朝向，只影响外观 */
  s: number;
  r: number;
}

export interface MapDef {
  /** 宽高（格） */
  w: number;
  h: number;
  ground: Ground[];
  places: PlaceDef[];
  props: PropDef[];
}

export type Gender = 'f' | 'm';
export type Stage = 'child' | 'student' | 'worker' | 'homemaker' | 'retired' | 'jobless';

/** 0–1 的连续权重，是模型参数，不宣称完整刻画人格 */
export interface Traits {
  /** 外向：更想见人，聊天更主动 */
  social: number;
  /** 自律：更准时，更愿意做家务、写作业 */
  order: number;
  /** 节俭：对花费更敏感 */
  thrift: number;
  /** 好动：更愿意出门 */
  active: number;
  /** 夜猫子：睡得晚、起得晚 */
  owl: number;
}

export interface Look {
  skin: string;
  hair: string;
  hairStyle: 'short' | 'long' | 'bun' | 'bob' | 'cap' | 'ponytail' | 'bald';
  top: string;
  bottom: string;
  accent?: 'glasses' | 'apron' | 'scarf' | 'bag' | 'hat';
}

export interface JobDef {
  occupation: string;
  /** 雇主（单位 id）；城里的工作是 'city' */
  firm: string;
  /** 上班地点；城里的工作是公交站 */
  place: string;
  shift: string;
  /** 日薪（元） */
  wage: number;
  /** 轮休日（0 = 周一 … 6 = 周日）；按周末休息的班次为空 */
  restDays: number[];
  /** 店主：每周提走利润 */
  owner?: boolean;
}

export interface PersonDef {
  id: string;
  name: string;
  age: number;
  gender: Gender;
  stage: Stage;
  household: string;
  /** 在家庭里的次序（床位、座位的稳定偏好） */
  slot: number;
  home: string;
  unit: number;
  job?: JobDef;
  /** 上学的地方：本社区的小学，或经公交站去城里的中学 */
  school?: { place: string; away: boolean };
  traits: Traits;
  interests: string[];
  /** 耐用品与随身物（物品表的 id） */
  belongings: string[];
  /** 月养老金或补助（元） */
  pension: number;
  /** 期初现金（元） */
  cash: number;
  look: Look;
  bio: string;
}

export type HouseholdType = 'elder_couple' | 'elder_single' | 'three_gen' | 'nuclear' | 'couple' | 'single' | 'single_parent' | 'sharers';

export interface HouseholdDef {
  id: string;
  type: HouseholdType;
  label: string;
  home: string;
  unit: number;
  members: string[];
  /** 负责买菜的人、负责做饭的人（可以是同一个） */
  shopper: string;
  cook: string;
  /** 接送孩子的人（没有就是孩子自己走或上托管） */
  escort?: string;
  /** 租房：每周房租（元）；自有住房为 0 */
  rentWeekly: number;
  /** 家里的耐用品 */
  belongings: string[];
  /** 期初：家庭账户（元）、存粮（份）、日用品（份） */
  cash: number;
  food: number;
  supplies: number;
  /** 晚饭开饭时刻（当天秒数） */
  dinnerAt: number;
}

export interface OfferDef {
  item: string;
  price: number;
  /** 进货成本占售价的比例 */
  cost: number;
  stock: number;
  restockTo: number;
}

export interface FirmDef {
  id: string;
  name: string;
  place: string;
  /** private：靠营业收入；public：由外部（财政）按日拨款 */
  kind: 'private' | 'public';
  owner?: string;
  staff: string[];
  offers: OfferDef[];
  /** 期初资金（元） */
  cash: number;
  /** 每日外部流入（元）：财政拨款、外地货款 */
  externalDaily: number;
}

export type TieKind = 'family' | 'partner' | 'friend' | 'coworker' | 'classmate' | 'neighbor' | 'acquaintance';

export interface TieDef {
  a: string;
  b: string;
  kind: TieKind;
  closeness: number;
  trust: number;
}

export interface CommunityDef {
  id: string;
  name: string;
  /** 规格的内容哈希 */
  spec: string;
  blurb: string;
  map: MapDef;
  people: PersonDef[];
  households: HouseholdDef[];
  firms: FirmDef[];
  ties: TieDef[];
}

/** 关系的键：两个 id 按字典序 */
export const tieKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** 外部账户：城里的雇主、批发商、财政、不住在这里的房东 */
export const EXT = 'ext';
export const householdAccount = (id: string): string => `hh:${id}`;
