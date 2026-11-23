import { CELL, FLOOR_H, hash53, interiorOf, type ActState, type Anchor, type CommunityDef, type Interior, type MoveState, type PersonDef, type PlaceDef, type WorldState } from '@microcity/society';
import type { ActorLook, ActorPose, Anim } from '../world3d/types.ts';
import type { LastSpot } from './cursor.ts';

/**
 * 站位与走位（D77）：把内核的状态（在哪个站位做什么、沿哪条路线走到哪）变成每个人此刻的姿态。
 * 只读状态；插值、靠右走、进屋时走到座位这些都只是画面，不回写内核。
 */

/** 行人靠右走，离路中线多远（米） */
const SIDE = 1.15;
/** 进屋或换座位时走过去用的时间（模拟秒） */
const TWEEN = 24;
/** 聊完天后头顶的图标留多久（模拟秒） */
const CHAT_SHOW = 420;

interface Path {
  /** 世界坐标折线 [x0, y0, x1, y1, …] */
  pts: number[];
  /** 累计长度 */
  cum: number[];
}

export interface Stage {
  def: CommunityDef;
  people: PersonDef[];
  places: Record<string, PlaceDef>;
  interiors: Record<string, Interior>;
  looks: ActorLook[];
  paths: Map<string, Path>;
  /** 各公园里散步的环线（站位序号） */
  strolls: Record<string, Anchor[]>;
}

export function lookOf(p: PersonDef): ActorLook {
  const scale = p.age < 7 ? 0.62 : p.age < 10 ? 0.72 : p.age < 13 ? 0.82 : p.age < 16 ? 0.92 : p.age >= 76 ? 0.96 : 1;
  return { ...p.look, id: p.id, scale, elder: p.age >= 65, gender: p.gender };
}

export function makeStage(def: CommunityDef): Stage {
  const places = Object.fromEntries(def.map.places.map((p) => [p.id, p]));
  const interiors = Object.fromEntries(def.map.places.map((p) => [p.id, interiorOf(p)]));
  const strolls: Record<string, Anchor[]> = {};
  for (const p of def.map.places) {
    const s = interiors[p.id]!.anchors.filter((a) => a.kind === 'stroll');
    if (s.length > 2) strolls[p.id] = s;
  }
  return { def, people: def.people, places, interiors, looks: def.people.map(lookOf), paths: new Map(), strolls };
}

export function blankPose(): ActorPose {
  return { visible: false, x: 0, y: 0, h: 0, face: 0, anim: 'idle', place: null, floor: 0, unit: -1, carry: false, emote: null };
}

const doorWorld = (stage: Stage, place: string): [number, number] => {
  const p = stage.places[place]!;
  const d = stage.interiors[place]!.door;
  return [p.x * CELL + d.x, p.y * CELL + d.y];
};

/** 路线（格心折线）→ 世界折线：两头接上建筑的门，中间靠右偏移 */
function pathOf(stage: Stage, move: MoveState): Path {
  const hit = stage.paths.get(move.id);
  if (hit) return hit;
  const n = move.pts.length / 2;
  const pts: number[] = [...doorWorld(stage, move.from)];
  const normal = (i: number): [number, number] => {
    // 第 i 段（顶点 i → i+1）的右手法线
    const dx = Math.sign(move.pts[i * 2 + 2]! - move.pts[i * 2]!);
    const dy = Math.sign(move.pts[i * 2 + 3]! - move.pts[i * 2 + 1]!);
    return [-dy, dx];
  };
  for (let i = 0; i < n; i++) {
    let ox = 0;
    let oy = 0;
    if (n > 1) {
      if (i > 0) {
        const [a, b] = normal(i - 1);
        ox += a;
        oy += b;
      }
      if (i < n - 1) {
        const [a, b] = normal(i);
        ox += a;
        oy += b;
      }
      // 直行处两段法线相同，只算一次
      if (i > 0 && i < n - 1 && Math.abs(ox) + Math.abs(oy) > 1.5 && (ox === 0 || oy === 0)) {
        ox /= 2;
        oy /= 2;
      }
    }
    pts.push(move.pts[i * 2]! * CELL + ox * SIDE, move.pts[i * 2 + 1]! * CELL + oy * SIDE);
  }
  pts.push(...doorWorld(stage, move.to));
  const cum = [0];
  for (let i = 1; i < pts.length / 2; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i * 2]! - pts[i * 2 - 2]!, pts[i * 2 + 1]! - pts[i * 2 - 1]!));
  const path = { pts, cum };
  if (stage.paths.size > 3000) stage.paths.clear();
  stage.paths.set(move.id, path);
  return path;
}

function along(path: Path, f: number, out: ActorPose): void {
  const total = path.cum[path.cum.length - 1]!;
  const d = Math.max(0, Math.min(1, f)) * total;
  let i = 1;
  while (i < path.cum.length - 1 && path.cum[i]! < d) i++;
  const a = path.cum[i - 1]!;
  const b = path.cum[i]!;
  const k = b > a ? (d - a) / (b - a) : 0;
  const x0 = path.pts[i * 2 - 2]!;
  const y0 = path.pts[i * 2 - 1]!;
  const x1 = path.pts[i * 2]!;
  const y1 = path.pts[i * 2 + 1]!;
  out.x = x0 + (x1 - x0) * k;
  out.y = y0 + (y1 - y0) * k;
  if (b > a) out.face = Math.atan2(x1 - x0, y1 - y0);
}

const jitter = (key: string, salt: number): number => (hash53(key, salt) % 10000) / 10000 - 0.5;

/** 没占到站位时站在哪：住家在自己那套房里，别处在场地中间一带 */
function looseSpot(stage: Stage, place: PlaceDef, unit: number, key: string): { x: number; y: number; h: number; face: number; floor: number } {
  const it = stage.interiors[place.id]!;
  const ox = place.x * CELL;
  const oy = place.y * CELL;
  const rect = unit >= 0 ? it.units.find((u) => u.unit === unit) : undefined;
  const jx = jitter(key, 1);
  const jy = jitter(key, 2);
  const face = jitter(key, 3) * Math.PI * 2;
  if (rect) return { x: ox + rect.x + rect.w * (0.5 + jx * 0.5), y: oy + rect.y + rect.h * (0.42 + jy * 0.4), h: rect.floor * FLOOR_H, face, floor: rect.floor };
  const spread = place.open ? 0.7 : 0.45;
  return { x: ox + place.w * CELL * (0.5 + jx * spread), y: oy + place.h * CELL * (0.5 + jy * spread), h: 0, face, floor: 0 };
}

export function animFor(act: ActState, anchor: Anchor | undefined, chatting: boolean): Anim {
  const pose = anchor?.pose ?? 'stand';
  if (pose === 'lie') return 'lie';
  const sit = pose === 'sit';
  switch (act.kind) {
    case 'sleep':
    case 'nap':
      return sit ? 'sit' : 'idle';
    case 'eat_home':
    case 'eat_out':
    case 'eat_work':
      return sit ? 'sit_eat' : 'idle';
    case 'cook':
      return 'cook';
    case 'work':
      switch (anchor?.kind) {
        case 'counter':
        case 'stall':
          return 'serve';
        case 'kitchen':
          return 'cook';
        case 'machine':
          return 'stand_work';
        case 'podium':
          return 'teach';
        default:
          return sit ? 'sit_work' : 'stand_work';
      }
    case 'school':
    case 'study':
      return sit ? 'sit_study' : 'idle';
    case 'shop':
      return 'browse';
    case 'chores':
      return 'chores';
    case 'wait':
    case 'escort':
      return chatting ? 'stand_talk' : 'wait';
    case 'clinic':
      return sit ? 'sit' : 'wait';
    case 'care':
      return sit ? 'sit_talk' : 'stand_talk';
    case 'rest':
      return sit ? (chatting ? 'sit_talk' : 'sit') : 'idle';
    case 'hobby':
      switch (act.hobby) {
        case 'chess':
        case 'cards':
          return sit ? 'sit_play' : 'stand_talk';
        case 'tea':
          return sit ? 'sit_talk' : 'stand_talk';
        case 'dance':
          return 'dance';
        case 'taichi':
          return 'exercise';
        case 'ball':
          return 'ball';
        case 'play':
          return 'play';
        case 'read':
          return sit ? 'sit_read' : 'idle';
        case 'tv':
          return sit ? 'sit_tv' : 'idle';
        case 'game':
        case 'phone':
          return sit ? 'sit_phone' : 'phone';
        case 'walk':
          return sit ? 'sit' : 'walk';
        default:
          return sit ? (chatting ? 'sit_talk' : 'sit') : 'idle';
      }
    default:
      return 'idle';
  }
}

const smooth = (k: number): number => k * k * (3 - 2 * k);

/** 算出每个人在 t 时刻的姿态，写进 out（与 stage.people 一一对应） */
export function computePoses(stage: Stage, state: WorldState, t: number, lastChat: Map<string, { t: number; with: string }>, lastSpot: Map<string, LastSpot>, out: ActorPose[]): void {
  const people = stage.people;
  for (let i = 0; i < people.length; i++) {
    const pd = people[i]!;
    const ps = state.people[pd.id]!;
    const o = (out[i] ??= blankPose());
    o.visible = true;
    o.carry = false;
    o.emote = null;
    o.h = 0;
    o.floor = 0;
    o.unit = -1;
    const chat = lastChat.get(pd.id);
    const chatting = !!chat && t - chat.t < CHAT_SHOW && t >= chat.t;

    if (ps.loc.k === 'move') {
      const m = ps.loc.move;
      along(pathOf(stage, m), (t - m.t0) / Math.max(1, m.t1 - m.t0), o);
      o.anim = m.mode === 'ebike' ? 'ride' : 'walk';
      o.place = null;
      o.carry = ps.carrying;
      continue;
    }

    const place = stage.places[ps.loc.place]!;
    const it = stage.interiors[place.id]!;
    o.place = place.id;
    const act = ps.act;
    if (!act) {
      // 两件事之间的一瞬：站在门口
      const [dx, dy] = doorWorld(stage, place.id);
      o.x = dx;
      o.y = dy;
      o.anim = 'idle';
      continue;
    }
    if (act.away) {
      o.visible = false;
      continue;
    }
    const anchor = act.anchor >= 0 ? it.anchors[act.anchor] : undefined;
    let tx: number;
    let ty: number;
    let th: number;
    let tf: number;
    if (anchor) {
      tx = place.x * CELL + anchor.x;
      ty = place.y * CELL + anchor.y;
      th = anchor.floor * FLOOR_H;
      tf = anchor.face;
      o.floor = anchor.floor;
      o.unit = anchor.unit;
    } else {
      const s = looseSpot(stage, place, act.unit, `${pd.id}:${act.id}`);
      tx = s.x;
      ty = s.y;
      th = s.h;
      tf = s.face;
      o.floor = s.floor;
      o.unit = act.unit;
    }
    o.anim = animFor(act, anchor, chatting);

    // 在公园散步：沿环线慢慢走
    const loop = stage.strolls[place.id];
    if (act.kind === 'hobby' && act.hobby === 'walk' && anchor?.kind === 'stroll' && loop) {
      const period = 38;
      const pos = (t - act.t0) / period + loop.indexOf(anchor);
      const a = loop[Math.floor(pos) % loop.length]!;
      const b = loop[(Math.floor(pos) + 1) % loop.length]!;
      const k = pos - Math.floor(pos);
      o.x = place.x * CELL + a.x + (b.x - a.x) * k;
      o.y = place.y * CELL + a.y + (b.y - a.y) * k;
      o.face = Math.atan2(b.x - a.x, b.y - a.y);
      o.anim = 'walk';
      continue;
    }

    // 刚进门或刚换地方：从上一处走到站位
    const from = lastSpot.get(pd.id);
    const dt = t - act.t0;
    if (from && from.place === place.id && dt >= 0 && dt < TWEEN && act.t0 - from.t < 6) {
      let fx: number;
      let fy: number;
      let fh = 0;
      const fa = from.anchor >= 0 ? it.anchors[from.anchor] : undefined;
      if (fa) {
        fx = place.x * CELL + fa.x;
        fy = place.y * CELL + fa.y;
        fh = fa.floor * FLOOR_H;
      } else if (from.anchor === -2) [fx, fy] = doorWorld(stage, place.id);
      else {
        const s = looseSpot(stage, place, from.unit, `${pd.id}:prev`);
        fx = s.x;
        fy = s.y;
        fh = s.h;
      }
      const k = smooth(dt / TWEEN);
      o.x = fx + (tx - fx) * k;
      o.y = fy + (ty - fy) * k;
      o.h = fh + (th - fh) * k;
      if (Math.hypot(tx - fx, ty - fy) > 0.3) {
        o.face = Math.atan2(tx - fx, ty - fy);
        o.anim = 'walk';
      } else o.face = tf;
      continue;
    }

    o.x = tx;
    o.y = ty;
    o.h = th;
    o.face = tf;
    if (act.kind === 'sleep' || act.kind === 'nap') o.emote = 'sleep';
    else if (chatting) o.emote = 'chat';
    else if (act.kind === 'eat_home' || act.kind === 'eat_out' || act.kind === 'eat_work') o.emote = 'eat';
  }
}
