import { useEffect, useRef, useState } from 'react';
import { CELL, OLDTOWN, WorldMap, alongRoute, anchorWorld, interiorOf, layoutFor, type AnchorKind, type CommunityDef, type PlaceDef, type PlaceKind } from '@microcity/society';
import { createWorld3D } from '../world3d/index.ts';
import type { ActorLook, ActorPose, Anim, CameraMode, Weather, World3DApi } from '../world3d/types.ts';

/**
 * M0 样片（/?demo=1）：不依赖内核的引擎。
 * 一个按剧本过日子的主角 + 一批按时段摆在各处的居民 + 街上来回走的路人，
 * 用来验收画面：日夜、天气、三档镜头、跟随、室内剖面。
 */

const H = 3600;
const hm = (h: number, m = 0) => h * H + m * 60;

const SKIN = ['#F2D2B6', '#EBC4A2', '#E0B08A', '#F6DCC6'];
const HAIR = ['#2B2623', '#3A2E28', '#4A3A30', '#2B2623', '#8A8580', '#D9D5CF'];
const TOPS = ['#C2553A', '#4B7EAD', '#5C9E6E', '#E3A13A', '#8A6A9A', '#F4EDE0', '#3F6D7A', '#D9776A', '#7C8C7A', '#B5654A', '#E8D8B8', '#6F8FB8'];
const BOTTOMS = ['#3E4A5C', '#5E5A52', '#2F3A44', '#8F7B62', '#4B5D52', '#6B5B4D'];
const STYLES: ActorLook['hairStyle'][] = ['short', 'long', 'bun', 'bob', 'short', 'ponytail', 'cap', 'short', 'bald'];

function rnd(...key: Array<string | number>): number {
  let h = 2166136261;
  const s = key.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const pickR = <T,>(arr: readonly T[], ...key: Array<string | number>): T => arr[Math.floor(rnd(...key) * arr.length) % arr.length]!;

function look(id: string, o: { child?: boolean; elder?: boolean } = {}): ActorLook {
  const elder = o.elder ?? rnd(id, 'elder') < 0.3;
  const gender = rnd(id, 'g') < 0.5 ? 'f' : 'm';
  let hairStyle = pickR(STYLES, id, 'hs');
  if (gender === 'm' && (hairStyle === 'long' || hairStyle === 'bun' || hairStyle === 'ponytail' || hairStyle === 'bob')) hairStyle = 'short';
  if (gender === 'f' && hairStyle === 'bald') hairStyle = 'bob';
  if (hairStyle === 'bald' && !elder) hairStyle = 'short';
  return {
    id,
    scale: o.child ? 0.62 + rnd(id, 'sc') * 0.2 : 0.94 + rnd(id, 'sc') * 0.1,
    elder: !o.child && elder,
    gender,
    skin: pickR(SKIN, id, 'skin'),
    hair: elder && !o.child ? pickR(['#8A8580', '#D9D5CF', '#5A5552'], id, 'hair') : pickR(HAIR.slice(0, 4), id, 'hair'),
    hairStyle,
    top: pickR(TOPS, id, 'top'),
    bottom: pickR(BOTTOMS, id, 'bottom'),
  };
}

/** 一段停留：从 t0 起待在某个站位上 */
interface Stay {
  t0: number;
  place: string;
  anchor: number;
  anim: Anim;
  emote?: ActorPose['emote'];
  carryTo?: boolean;
}

interface Person {
  look: ActorLook;
  pose: (t: number, out: ActorPose) => void;
}

const blank = (): ActorPose => ({ visible: false, x: 0, y: 0, h: 0, face: 0, anim: 'idle', place: null, floor: 0, unit: -1, carry: false, emote: null });

function buildWorld(extra: number) {
  const { map, homes } = layoutFor(OLDTOWN, 72);
  const def: CommunityDef = { id: 'demo', name: OLDTOWN.name, spec: 'demo', blurb: OLDTOWN.blurb, map, people: [], households: [], firms: [], ties: [] };
  const wm = new WorldMap(map);
  const used = new Map<string, number>();

  /** 取某地点某类站位里的下一个空位 */
  const take = (place: PlaceDef, kind: AnchorKind, unit = -1): number => {
    const list = interiorOf(place).anchors.filter((a) => a.kind === kind && (unit < 0 || a.unit === unit));
    if (list.length === 0) return interiorOf(place).anchors[0]?.id ?? 0;
    const key = `${place.id}:${kind}:${unit}`;
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    return list[n % list.length]!.id;
  };
  const first = (kind: PlaceKind, n = 0): PlaceDef => wm.ofKind(kind)[n] ?? wm.ofKind(kind)[0]!;

  const doorWorld = (p: PlaceDef) => {
    if (p.open) return { x: (p.door.x + 0.5) * CELL, y: (p.door.y + 0.5) * CELL };
    const d = interiorOf(p).door;
    return { x: p.x * CELL + d.x, y: p.y * CELL + d.y };
  };

  const setAt = (out: ActorPose, p: PlaceDef, anchorId: number, anim: Anim) => {
    const a = interiorOf(p).anchors[anchorId]!;
    const w = anchorWorld(p, a);
    out.visible = true;
    out.x = w.x;
    out.y = w.y;
    out.h = w.h;
    out.face = a.face;
    out.anim = anim;
    out.place = p.id;
    out.floor = a.floor;
    out.unit = a.unit;
    out.carry = false;
    out.emote = null;
  };

  /** 按剧本过一天的人：停留之间自动走过去 */
  const scripted = (id: string, lk: ActorLook, stays: Stay[], speed = 1.3): Person => {
    const moves = stays.map((s, i) => {
      const prev = stays[(i + stays.length - 1) % stays.length]!;
      if (prev.place === s.place) return null;
      const r = wm.route(prev.place, s.place);
      if (!r) return null;
      return { route: r, dur: Math.max(20, (r.len * CELL) / speed), from: wm.place(prev.place), to: wm.place(s.place), carry: !!s.carryTo };
    });
    const ENTER = 7;
    return {
      look: lk,
      pose(t, out) {
        let i = stays.length - 1;
        for (let k = 0; k < stays.length; k++) if (stays[k]!.t0 <= t) i = k;
        const cur = stays[i]!;
        const ni = (i + 1) % stays.length;
        const next = stays[ni]!;
        const mv = moves[ni];
        const nextT = next.t0 > cur.t0 ? next.t0 : next.t0 + 86400;
        const tt = t >= cur.t0 ? t : t + 86400;
        const p = wm.place(cur.place);
        if (mv && tt >= nextT - mv.dur) {
          // 在路上：靠右走
          const f = (tt - (nextT - mv.dur)) / mv.dur;
          const a = alongRoute(mv.route.pts, f);
          out.visible = true;
          out.x = a.x * CELL - Math.cos(a.face) * 0.9;
          out.y = a.y * CELL + Math.sin(a.face) * 0.9;
          out.h = 0;
          out.face = a.face;
          out.anim = speed > 3 ? 'ride' : 'walk';
          out.place = null;
          out.floor = 0;
          out.unit = -1;
          out.carry = mv.carry;
          out.emote = null;
          return;
        }
        setAt(out, p, cur.anchor, cur.anim);
        out.emote = cur.emote ?? null;
        // 进门、出门：在门口与站位之间走几步
        const curMove = moves[i];
        const since = tt - cur.t0;
        const until = mv ? nextT - mv.dur - tt : Infinity;
        const k = curMove && since < ENTER ? since / ENTER : until < ENTER ? until / ENTER : 1;
        if (k < 1) {
          const d = doorWorld(p);
          const ax = out.x;
          const ay = out.y;
          out.x = d.x + (ax - d.x) * k;
          out.y = d.y + (ay - d.y) * k;
          out.h *= k;
          const dx = (ax - d.x) * (since < ENTER ? 1 : -1);
          const dy = (ay - d.y) * (since < ENTER ? 1 : -1);
          out.face = Math.atan2(dx, dy);
          out.anim = 'walk';
          out.emote = null;
        }
      },
    };
  };

  const people: Person[] = [];

  // 主角：住在离面馆七八十米的一户人家
  const noodle = first('eatery', 2);
  const houses = wm.ofKind('house');
  const home = [...houses].sort((a, b) => Math.abs(wm.meters(a.id, noodle.id) - 84) - Math.abs(wm.meters(b.id, noodle.id) - 84))[0]!;
  const park = first('park');
  const market = first('market');
  const tea = first('teahouse');
  const square = first('square');
  const hBed = take(home, 'bed', 0);
  const hDine = take(home, 'dine', 0);
  const hSofa = take(home, 'sofa', 0);
  const hStove = take(home, 'stove', 0);
  const hFree = take(home, 'free', 0);
  const heroLook: ActorLook = { ...look('hero', { elder: true }), top: '#C2553A', bottom: '#3E4A5C', hair: '#D9D5CF', hairStyle: 'bun', gender: 'f', scale: 0.98 };
  people.push(
    scripted('hero', heroLook, [
      { t0: hm(0), place: home.id, anchor: hBed, anim: 'lie', emote: 'sleep' },
      { t0: hm(6, 10), place: home.id, anchor: hFree, anim: 'chores' },
      { t0: hm(6, 45), place: noodle.id, anchor: take(noodle, 'table'), anim: 'sit_eat', emote: 'eat' },
      { t0: hm(7, 30), place: park.id, anchor: take(park, 'free'), anim: 'exercise' },
      { t0: hm(8, 40), place: market.id, anchor: take(market, 'browse'), anim: 'browse', emote: 'pay' },
      { t0: hm(9, 25), place: home.id, anchor: hSofa, anim: 'sit_tv', carryTo: true },
      { t0: hm(11, 15), place: home.id, anchor: hStove, anim: 'cook' },
      { t0: hm(11, 50), place: home.id, anchor: hDine, anim: 'sit_eat', emote: 'eat' },
      { t0: hm(12, 30), place: home.id, anchor: hBed, anim: 'lie', emote: 'sleep' },
      { t0: hm(14, 20), place: tea.id, anchor: take(tea, 'board'), anim: 'sit_play', emote: 'chat' },
      { t0: hm(17, 15), place: home.id, anchor: hStove, anim: 'cook' },
      { t0: hm(18, 0), place: home.id, anchor: hDine, anim: 'sit_eat', emote: 'eat' },
      { t0: hm(19, 0), place: square.id, anchor: take(square, 'dance'), anim: 'dance' },
      { t0: hm(20, 40), place: home.id, anchor: hSofa, anim: 'sit_tv' },
      { t0: hm(22, 10), place: home.id, anchor: hBed, anim: 'lie', emote: 'sleep' },
    ]),
  );

  // 白天的去处：地点、站位、动作、时段、人数
  type Job = [PlaceDef, AnchorKind, Anim, number, number, number, ActorPose['emote']?, boolean?];
  const jobs: Job[] = [
    [market, 'stall', 'stand_work', hm(5, 30), hm(12, 40), 6, 'work'],
    [market, 'browse', 'browse', hm(7), hm(10, 30), 7],
    [park, 'free', 'exercise', hm(6), hm(8, 30), 7],
    [park, 'bench', 'sit_talk', hm(9), hm(11, 30), 4, 'chat'],
    [park, 'board', 'sit_play', hm(9), hm(17), 6],
    [tea, 'board', 'sit_play', hm(13), hm(17, 30), 9, 'chat'],
    [tea, 'counter', 'serve', hm(9), hm(21), 1],
    [first('eatery', 0), 'table', 'sit_eat', hm(11, 30), hm(13, 10), 6, 'eat'],
    [noodle, 'table', 'sit_eat', hm(6, 30), hm(8, 30), 5, 'eat'],
    [noodle, 'kitchen', 'cook', hm(6), hm(20), 2],
    [first('grocery', 0), 'counter', 'stand_work', hm(7, 30), hm(21), 1],
    [first('school'), 'class', 'sit_study', hm(8), hm(16, 30), 10, null, true],
    [first('school'), 'podium', 'teach', hm(8), hm(16, 30), 2],
    [first('office'), 'desk', 'sit_work', hm(9), hm(18), 6, 'work'],
    [first('workshop'), 'machine', 'stand_work', hm(8), hm(17), 6, 'work'],
    [first('center'), 'read', 'sit_read', hm(9), hm(16), 4],
    [first('busstop'), 'wait', 'wait', hm(7), hm(8), 5],
  ];
  const evening: Job[] = [
    [square, 'dance', 'dance', hm(19), hm(20, 30), 17],
    [first('court'), 'hoop', 'ball', hm(16, 40), hm(18, 40), 6],
    [square, 'play', 'play', hm(16, 40), hm(18, 20), 5, null, true],
    [square, 'bench', 'sit_phone', hm(16), hm(20, 30), 4],
  ];
  const queue: Job[] = [];
  for (const j of jobs) for (let k = 0; k < j[5]; k++) queue.push(j);
  const eq: Job[] = [];
  for (const j of evening) for (let k = 0; k < j[5]; k++) eq.push(j);

  let qi = 0;
  let ei = 0;
  const slots = homes.filter((s) => s.place !== home.id);
  const residents = Math.min(slots.length, 66);
  for (let r = 0; r < residents; r++) {
    const slot = slots[r]!;
    const hp = wm.place(slot.place);
    const n = rnd('hh', r) < 0.55 ? 2 : 1;
    for (let m = 0; m < n; m++) {
      const id = `r${r}_${m}`;
      const day = queue[qi % queue.length]!;
      qi++;
      const eve = ei < eq.length && (m === 0 || rnd(id, 'eve') < 0.5) ? eq[ei++] : undefined;
      const child = !!(day[7] || eve?.[7]);
      const lk = look(id, { child });
      const wake = hm(5, 30) + Math.floor(rnd(id, 'wake') * 100) * 60;
      const bed = hm(21, 30) + Math.floor(rnd(id, 'bed') * 110) * 60;
      const stays: Stay[] = [{ t0: 0, place: hp.id, anchor: take(hp, 'bed', slot.unit), anim: 'lie' }];
      const homeAnims: Array<[AnchorKind, Anim]> = [
        ['dine', 'sit_eat'],
        ['sofa', 'sit_tv'],
        ['free', 'chores'],
        ['desk', 'sit_work'],
        ['sofa', 'sit_phone'],
        ['dine', 'sit_talk'],
      ];
      const atHome = (t0: number, k: number) => {
        const [ak, an] = homeAnims[Math.floor(rnd(id, 'h', k) * homeAnims.length)]!;
        stays.push({ t0, place: hp.id, anchor: take(hp, ak, slot.unit), anim: an });
      };
      atHome(Math.min(wake, day[3] - 900), 0);
      stays.push({ t0: day[3] + Math.floor(rnd(id, 'j') * 20) * 60, place: day[0].id, anchor: take(day[0], day[1]), anim: day[2], emote: rnd(id, 'em') < 0.35 ? (day[6] ?? null) : null });
      atHome(day[4] + Math.floor(rnd(id, 'jb') * 30) * 60, 1);
      if (stays[stays.length - 1]!.t0 < hm(17, 30)) stays.push({ t0: hm(17, 30) + r * 20, place: hp.id, anchor: take(hp, m === 0 ? 'stove' : 'sofa', slot.unit), anim: m === 0 ? 'cook' : 'sit_tv' });
      if (eve && eve[3] > stays[stays.length - 1]!.t0 + 600) {
        stays.push({ t0: eve[3] + Math.floor(rnd(id, 'e') * 10) * 60, place: eve[0].id, anchor: take(eve[0], eve[1]), anim: eve[2] });
        atHome(eve[4] + Math.floor(rnd(id, 'eb') * 15) * 60, 2);
      } else if (stays[stays.length - 1]!.t0 < hm(18, 15)) stays.push({ t0: hm(18, 15) + r * 15, place: hp.id, anchor: take(hp, 'dine', slot.unit), anim: 'sit_eat' });
      if (stays[stays.length - 1]!.t0 < hm(19, 30)) atHome(hm(19, 30) + r * 10, 3);
      stays.push({ t0: Math.max(bed, stays[stays.length - 1]!.t0 + 600), place: hp.id, anchor: stays[0]!.anchor, anim: 'lie' });
      stays.sort((a, b) => a.t0 - b.t0);
      people.push(scripted(id, lk, stays, rnd(id, 'ride') < 0.12 ? 4.2 : lk.elder ? 1.05 : 1.3));
    }
  }

  // 路人：在两个地点之间来回走，撑起街上的人气
  const spots = map.places.filter((p) => p.kind !== 'house');
  const walkers = Math.max(24, extra - people.length);
  for (let w = 0; w < walkers; w++) {
    const id = `w${w}`;
    const a = pickR(map.places, id, 'a');
    let b = pickR(spots, id, 'b');
    if (b.id === a.id) b = spots[(spots.indexOf(b) + 1) % spots.length]!;
    const route = wm.route(a.id, b.id);
    const lk = look(id, { child: rnd(id, 'kid') < 0.12 });
    const ride = rnd(id, 'ride') < 0.14;
    const speed = ride ? 4.2 : lk.elder ? 1.0 : 1.3;
    const dur = route ? Math.max(30, (route.len * CELL) / speed) : 60;
    const offset = rnd(id, 'off') * dur * 2;
    const from = hm(5, 40) + rnd(id, 'from') * 2 * H;
    const to = hm(20) + rnd(id, 'to') * 2.5 * H;
    people.push({
      look: lk,
      pose(t, out) {
        if (!route || route.pts.length < 4 || t < from || t > to) {
          out.visible = false;
          return;
        }
        const ph = ((t + offset) % (dur * 2)) / dur;
        const fwd = ph < 1;
        const f = fwd ? ph : 2 - ph;
        const p = alongRoute(route.pts, f);
        const face = fwd ? p.face : p.face + Math.PI;
        out.visible = true;
        out.x = p.x * CELL - Math.cos(face) * 0.9;
        out.y = p.y * CELL + Math.sin(face) * 0.9;
        out.h = 0;
        out.face = face;
        out.anim = ride ? 'ride' : 'walk';
        out.place = null;
        out.floor = 0;
        out.unit = -1;
        out.carry = !ride && rnd(id, 'carry') < 0.2;
        out.emote = null;
      },
    });
  }

  return { def, people, heroHome: home.id };
}

type DemoWorld = World3DApi & { debugLockQuality?: (on: boolean) => void } & { debugOrbit?: (o: { yaw?: number; pitch?: number; dist?: number; x?: number; z?: number; snap?: boolean }) => void };

export function Demo() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const world = useRef<DemoWorld | null>(null);
  const sim = useRef({ t: hm(8, 50), speed: 60, playing: true, weather: 'sun' as Weather, follow: false, orbit: null as null | Record<string, number | boolean>, mode: 'overview' as CameraMode });
  const [, force] = useState(0);
  const [mode, setMode] = useState<CameraMode>('overview');
  const [picked, setPicked] = useState('');
  const [fps, setFps] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const cv = canvas.current!;
    const q = new URLSearchParams(location.search);
    const { def, people } = buildWorld(Number(q.get('n') ?? 0));
    setCount(people.length);
    const w: DemoWorld = createWorld3D({
      canvas: cv,
      def,
      looks: people.map((p) => p.look),
      quality: q.get('q') === 'low' ? 'low' : 'high',
      onPick: (hit) => setPicked(hit ? `${hit.kind === 'actor' ? '人' : '地点'}：${hit.kind === 'place' ? (def.map.places.find((p) => p.id === hit.id)?.name ?? hit.id) : hit.id}` : ''),
      onCameraMode: setMode,
    });
    world.current = w;
    // 热更新会重建世界：把跟随状态接回去
    if (sim.current.follow) {
      w.setFollow('hero');
      w.setCameraMode(sim.current.mode === 'pov' ? 'pov' : 'follow');
    } else w.setCameraMode(sim.current.mode ?? 'overview');
    if (sim.current.orbit) w.debugOrbit?.({ ...sim.current.orbit, snap: true });
    const poses = people.map(blank);
    const resize = () => w.resize(cv.clientWidth, cv.clientHeight, window.devicePixelRatio || 1);
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    resize();

    let raf = 0;
    let last = performance.now();
    let frames = 0;
    let acc = 0;
    let uiAcc = 0;
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const s = sim.current;
      if (s.playing) s.t = (s.t + (dt / 1000) * s.speed) % 86400;
      w.setEnvironment(s.t, s.weather);
      for (let i = 0; i < people.length; i++) people[i]!.pose(s.t, poses[i]!);
      w.setPoses(poses);
      w.render(dt);
      frames++;
      acc += dt;
      uiAcc += dt;
      if (acc >= 1000) {
        setFps(Math.round((frames * 1000) / acc));
        frames = 0;
        acc = 0;
      }
      if (uiAcc > 200) {
        uiAcc = 0;
        force((n) => n + 1);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // 验收用的把手：在控制台里直接摆时间、天气、镜头
    (window as unknown as { __demo: unknown }).__demo = {
      world: w,
      sim: sim.current,
      setTime: (h: number, m = 0) => (sim.current.t = hm(h, m)),
      /** 一次摆好：时间、天气、镜头（热更新重建世界后会自动恢复） */
      shot: (o: { h?: number; m?: number; weather?: Weather; mode?: CameraMode; follow?: boolean; orbit?: Record<string, number | boolean>; play?: boolean; speed?: number }) => {
        const s = sim.current;
        w.debugLockQuality?.(true);
        if (o.h !== undefined) s.t = hm(o.h, o.m ?? 0);
        if (o.weather) s.weather = o.weather;
        if (o.play !== undefined) s.playing = o.play;
        if (o.speed !== undefined) s.speed = o.speed;
        if (o.follow !== undefined) {
          s.follow = o.follow;
          w.setFollow(o.follow ? 'hero' : null);
          w.setCameraMode(o.follow ? (o.mode === 'pov' ? 'pov' : 'follow') : (o.mode ?? 'street'));
        } else if (o.mode) w.setCameraMode(o.mode);
        if (o.mode) s.mode = o.mode;
        s.orbit = o.orbit ?? null;
        if (o.orbit) w.debugOrbit?.({ ...o.orbit, snap: true });
        setMode(w.getCameraMode());
      },
      follow: (on: boolean) => {
        sim.current.follow = on;
        w.setFollow(on ? 'hero' : null);
        w.setCameraMode(on ? 'follow' : 'street');
        setMode(on ? 'follow' : 'street');
      },
    };
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      w.dispose();
      world.current = null;
    };
  }, []);

  const s = sim.current;
  const hh = String(Math.floor(s.t / H)).padStart(2, '0');
  const mm = String(Math.floor((s.t % H) / 60)).padStart(2, '0');
  const cam = (m: CameraMode) => {
    const w = world.current;
    if (!w) return;
    if (m === 'follow' || m === 'pov') {
      s.follow = true;
      w.setFollow('hero');
    } else {
      s.follow = false;
      w.setFollow(null);
    }
    w.setCameraMode(m);
    setMode(m);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, fontFamily: "-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif", color: '#26241f' }}>
      <canvas ref={canvas} data-testid="demo-canvas" style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }} />
      <div style={panel} data-testid="demo-panel">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: "'Songti SC', serif", fontSize: 24, fontWeight: 700 }} data-testid="demo-clock">
            {hh}:{mm}
          </span>
          <span style={{ fontSize: 12, color: '#8f897e' }}>
            {count} 人 · {fps} 帧/秒
          </span>
        </div>
        <input
          data-testid="demo-time"
          type="range"
          min={0}
          max={86399}
          step={60}
          value={Math.floor(s.t)}
          onChange={(e) => {
            s.t = Number(e.target.value);
            force((n) => n + 1);
          }}
          style={{ width: '100%', accentColor: '#1f5f63' }}
        />
        <Row>
          <Btn on={s.playing} onClick={() => ((s.playing = !s.playing), force((n) => n + 1))} id="demo-play">
            {s.playing ? '暂停' : '播放'}
          </Btn>
          {[1, 60, 600].map((v) => (
            <Btn key={v} on={s.speed === v} onClick={() => ((s.speed = v), force((n) => n + 1))} id={`demo-speed-${v}`}>
              {v}×
            </Btn>
          ))}
        </Row>
        <Row>
          {(['sun', 'cloud', 'rain'] as Weather[]).map((v) => (
            <Btn key={v} on={s.weather === v} onClick={() => ((s.weather = v), force((n) => n + 1))} id={`demo-weather-${v}`}>
              {v === 'sun' ? '晴' : v === 'cloud' ? '阴' : '雨'}
            </Btn>
          ))}
        </Row>
        <Row>
          {(['overview', 'street', 'follow', 'pov'] as CameraMode[]).map((v) => (
            <Btn key={v} on={mode === v} onClick={() => cam(v)} id={`demo-cam-${v}`}>
              {v === 'overview' ? '俯瞰' : v === 'street' ? '街道' : '跟随主角'}
            </Btn>
          ))}
        </Row>
        <div style={{ fontSize: 12, color: '#5e5a52', minHeight: 16 }}>{picked || '拖动平移 · 滚轮缩放 · 右键或 Shift 拖动旋转'}</div>
      </div>
    </div>
  );
}

const panel: React.CSSProperties = {
  position: 'absolute',
  left: 16,
  top: 16,
  width: 250,
  padding: '12px 14px',
  display: 'grid',
  gap: 8,
  background: 'rgba(250,247,242,0.9)',
  backdropFilter: 'blur(10px)',
  border: '1px solid #e7e0d5',
  borderRadius: 14,
  boxShadow: '0 8px 30px rgba(60,45,30,0.14)',
};

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 6 }}>{children}</div>;
}

function Btn({ on, onClick, id, children }: { on: boolean; onClick: () => void; id: string; children: React.ReactNode }) {
  return (
    <button
      data-testid={id}
      onClick={onClick}
      style={{
        flex: 1,
        padding: '5px 0',
        fontSize: 13,
        borderRadius: 6,
        cursor: 'pointer',
        border: `1px solid ${on ? '#1f5f63' : '#d8cfc1'}`,
        background: on ? '#1f5f63' : '#fff',
        color: on ? '#fff' : '#26241f',
      }}
    >
      {children}
    </button>
  );
}
