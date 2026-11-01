import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Engine, type Agent, type TownMap } from '@microcity/sim';
import { displayTime, focusFamily, useApp, viewState } from '../store.ts';
import { iconSprite } from './textures.ts';
import { agentPos } from './overlay.tsx';
import type { IconName } from '../ui/icons.ts';
import { PAL, STATE_HEX, soft, type KnowState } from '../theme/palette.ts';
import { knowState } from '../lib/know.ts';

/** 圆润的“棋子”小人：裤装底座 + 胶囊上身 + 球形头；脚下的圆盘表示知情三态 */
const G = {
  base: new THREE.CylinderGeometry(0.1, 0.13, 0.26, 16),
  body: new THREE.CapsuleGeometry(0.115, 0.1, 6, 14),
  head: new THREE.SphereGeometry(0.12, 18, 14),
  hair: new THREE.SphereGeometry(0.128, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
  bun: new THREE.SphereGeometry(0.055, 12, 10),
  tail: new THREE.CapsuleGeometry(0.035, 0.12, 4, 8),
  long: new THREE.CapsuleGeometry(0.1, 0.08, 4, 12),
  brim: new THREE.CylinderGeometry(0.15, 0.15, 0.02, 18),
  disc: new THREE.CylinderGeometry(0.24, 0.24, 0.035, 28),
  ring: new THREE.TorusGeometry(0.31, 0.022, 8, 40),
  eye: new THREE.SphereGeometry(0.014, 6, 6),
};
const matCache = new Map<string, THREE.MeshStandardMaterial>();
const mat = (c: string, rough = 0.75) => {
  const k = `${c}:${rough}`;
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: c, roughness: rough });
    matCache.set(k, m);
  }
  return m;
};
const STATE_MAT: Record<KnowState, THREE.MeshStandardMaterial> = {
  unaware: new THREE.MeshStandardMaterial({ color: STATE_HEX.unaware, roughness: 0.6 }),
  heard: new THREE.MeshStandardMaterial({ color: STATE_HEX.heard, roughness: 0.5, emissive: STATE_HEX.heard, emissiveIntensity: 0.15 }),
  believe: new THREE.MeshStandardMaterial({ color: STATE_HEX.believe, roughness: 0.5, emissive: STATE_HEX.believe, emissiveIntensity: 0.12 }),
};
const RING_MAT = new THREE.MeshBasicMaterial({ color: PAL.teal2 });

export function People({ map }: { map: TownMap }) {
  const idList = useApp((s) => {
    const st = viewState(s);
    return st ? Object.keys(st.agents).join(',') : '';
  });
  const ids = useMemo(() => (idList ? idList.split(',') : []), [idList]);
  return (
    <group>
      {ids.map((id) => (
        <Person key={id} id={id} map={map} />
      ))}
    </group>
  );
}

const ACT_ICON: Partial<Record<string, IconName>> = { read_board: 'board', wait: 'boltOff' };
/** 人物放大一点，默认缩放下也看得清 */
const PERSON_SCALE = 1.35;
const ICON_COLOR: Partial<Record<IconName, string>> = { boltOff: PAL.bad, rumor: PAL.rumor, exclaim: PAL.warn, question: PAL.info };

function interiorSlot(map: TownMap, place: string, occupants: string[], id: string): { x: number; z: number } {
  const p = map.places[place]!;
  const cols = Math.max(1, p.rect.w - 1);
  const i = Math.max(0, occupants.indexOf(id));
  const col = i % cols;
  const row = Math.floor(i / cols) % Math.max(1, p.rect.h - 1);
  return { x: p.rect.x + 0.75 + col, z: p.rect.y + 0.7 + row * 0.9 };
}

function Person({ id, map }: { id: string; map: TownMap }) {
  const look = useApp((s) => viewState(s)?.agents[id]?.look);
  const selected = useApp((s) => s.selectedAgent === id);
  const root = useRef<THREE.Group>(null);
  const figure = useRef<THREE.Group>(null);
  const disc = useRef<THREE.Mesh>(null);
  const icon = useRef<THREE.Sprite>(null);
  const phase = useRef(0);
  const last = useRef({ x: 0, z: 0, icon: '', state: '' });
  const hovered = useRef(false);

  useFrame(() => {
    const st = useApp.getState();
    const s = viewState(st);
    const a: Agent | undefined = s?.agents[id];
    const g = root.current;
    if (!a || !g) return;
    const t = st.history ? st.history.t : displayTime(st.clock);
    let visible = true;
    let x = 0;
    let z = 0;
    let walking = false;
    if (a.loc.k === 'walk') {
      const p = Engine.positionAt(a, t);
      x = p.x + 0.5;
      z = p.y + 0.5;
      walking = t < a.loc.walk.t1;
    } else if (a.loc.k === 'street') {
      x = a.loc.tile.x + 0.5;
      z = a.loc.tile.y + 0.5;
    } else {
      const pl = map.places[a.loc.place];
      if (pl?.open) {
        x = a.loc.tile.x + 0.5;
        z = a.loc.tile.y + 0.5;
      } else if (pl && (!st.roofs || st.selectedPlace === pl.id)) {
        const p = interiorSlot(map, pl.id, s!.places[pl.id]?.occupants ?? [], id);
        x = p.x;
        z = p.z;
      } else visible = false;
      if (a.act?.kind === 'sleep' && pl && !pl.open && st.roofs && st.selectedPlace !== pl.id) visible = false;
    }
    g.visible = visible;
    const prevPos = agentPos.get(id);
    if (prevPos) {
      prevPos.x = x;
      prevPos.y = 0.06;
      prevPos.z = z;
      prevPos.visible = visible;
    } else agentPos.set(id, { x, y: 0.06, z, visible });
    if (!visible) return;
    const dx = x - last.current.x;
    const dz = z - last.current.z;
    const moved = Math.hypot(dx, dz);
    if (moved > 0.0005 && moved < 3 && figure.current) figure.current.rotation.y = Math.atan2(dx, dz);
    last.current.x = x;
    last.current.z = z;
    g.position.set(x, 0.06, z);
    // 走路：轻轻上下颠、左右晃
    if (walking && moved > 0) phase.current += moved * 11;
    if (figure.current) {
      figure.current.position.y = walking ? Math.abs(Math.sin(phase.current)) * 0.045 : 0;
      figure.current.rotation.z = walking ? Math.sin(phase.current) * 0.06 : 0;
    }
    // 脚下圆盘：知情三态
    const ks = knowState(a, focusFamily(st));
    if (disc.current && ks !== last.current.state) {
      last.current.state = ks;
      disc.current.material = STATE_MAT[ks];
    }
    // 头顶图标
    const now = performance.now();
    const tr = st.transient[id];
    let ic: IconName | '' = tr && tr.until > now ? tr.icon : '';
    if (!ic && a.act) ic = ACT_ICON[a.act.kind] ?? '';
    if (!ic && Object.values(s!.pending).some((p) => p.agent === id)) ic = 'question';
    if (icon.current) {
      if (ic !== last.current.icon) {
        last.current.icon = ic;
        if (ic) {
          (icon.current.material as THREE.SpriteMaterial).map = iconSprite(ic, ICON_COLOR[ic] ?? PAL.ink2);
          (icon.current.material as THREE.SpriteMaterial).needsUpdate = true;
        }
      }
      icon.current.visible = !!ic;
      icon.current.position.y = 1.08 + Math.sin(now / 320) * 0.025;
    }
    g.scale.setScalar((hovered.current || selected ? 1.1 : 1) * PERSON_SCALE);
  });

  if (!look) return null;
  const hair = mat(soft(look.hair), 0.85);
  const skin = mat(soft(look.skin), 0.7);
  const shirt = mat(soft(look.shirt));
  const pants = mat(soft(look.pants));

  const onClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    const st = useApp.getState();
    st.set({ selectedAgent: st.selectedAgent === id ? undefined : id, inspectorTab: 'overview' });
  };

  return (
    <group
      ref={root}
      onClick={onClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        hovered.current = true;
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        hovered.current = false;
        document.body.style.cursor = '';
      }}
    >
      <mesh ref={disc} position={[0, 0.018, 0]} geometry={G.disc} material={STATE_MAT.unaware} receiveShadow />
      {selected && <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} geometry={G.ring} material={RING_MAT} />}
      <group ref={figure}>
        <mesh position={[0, 0.17, 0]} geometry={G.base} material={pants} castShadow />
        <mesh position={[0, 0.39, 0]} geometry={G.body} material={shirt} castShadow />
        <mesh position={[0, 0.66, 0]} geometry={G.head} material={skin} castShadow />
        <mesh position={[-0.042, 0.665, 0.112]} geometry={G.eye} material={mat('#3a3740', 0.4)} />
        <mesh position={[0.042, 0.665, 0.112]} geometry={G.eye} material={mat('#3a3740', 0.4)} />
        <Hair style={look.hairStyle} hair={hair} cap={shirt} />
        {look.accessory === 'glasses' && (
          <mesh position={[0, 0.668, 0.116]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.03, 0.006, 6, 16]} />
            <meshStandardMaterial color="#3a3740" />
          </mesh>
        )}
        {look.accessory === 'scarf' && (
          <mesh position={[0, 0.53, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.09, 0.028, 8, 20]} />
            <meshStandardMaterial color="#d6716a" roughness={0.8} />
          </mesh>
        )}
        {look.accessory === 'apron' && (
          <mesh position={[0, 0.34, 0.1]}>
            <boxGeometry args={[0.16, 0.2, 0.02]} />
            <meshStandardMaterial color="#f7efe1" roughness={0.9} />
          </mesh>
        )}
      </group>
      <sprite ref={icon} position={[0, 1.08, 0]} scale={[0.4, 0.45, 1]} visible={false}>
        <spriteMaterial transparent depthTest={false} />
      </sprite>
    </group>
  );
}

function Hair({ style, hair, cap }: { style: string; hair: THREE.Material; cap: THREE.Material }) {
  const top = <mesh position={[0, 0.672, -0.006]} rotation={[-0.25, 0, 0]} geometry={G.hair} material={hair} />;
  switch (style) {
    case 'bun':
      return (
        <>
          {top}
          <mesh position={[0, 0.8, -0.05]} geometry={G.bun} material={hair} />
        </>
      );
    case 'ponytail':
      return (
        <>
          {top}
          <mesh position={[0, 0.62, -0.14]} rotation={[0.35, 0, 0]} geometry={G.tail} material={hair} />
        </>
      );
    case 'long':
      return (
        <>
          {top}
          <mesh position={[0, 0.6, -0.07]} geometry={G.long} material={hair} />
        </>
      );
    case 'cap':
      return (
        <>
          <mesh position={[0, 0.69, -0.004]} geometry={G.hair} material={cap} />
          <mesh position={[0, 0.72, 0.05]} geometry={G.brim} material={cap} />
        </>
      );
    default:
      return top;
  }
}
