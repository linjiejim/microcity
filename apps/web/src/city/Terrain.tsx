import { useMemo } from 'react';
import * as THREE from 'three';
import type { TileKind, TownMap } from '@microcity/sim';
import { mix, tone } from '../theme/palette.ts';

const TOP: Record<TileKind, number> = { grass: 0.06, park: 0.06, road: 0, path: 0.03, plaza: 0.03, water: -0.22, bridge: 0.06, lot: 0.02, tree: 0.06, flower: 0.08 };
/** 顶面颜色：低饱和的暖色系 */
const COLOR: Record<TileKind, string> = {
  grass: '#b7cf9b',
  park: '#a9c98f',
  road: '#ddd5c8',
  path: '#ebe3d4',
  plaza: '#ecdcc2',
  water: '#9cc7d8',
  bridge: '#c9aa88',
  lot: '#d9d2c6',
  tree: '#b7cf9b',
  flower: '#b2cc96',
};
/** 草地类瓦片按坐标轻微起伏，避免一整片死平 */
const JITTER = new Set<TileKind>(['grass', 'park', 'tree', 'flower']);

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 地形：每种瓦片一个实例化网格；纯色顶面，侧面略暗；底下是土色的“浮空台” */
export function Terrain({ map, onGround }: { map: TownMap; onGround: (tile: { x: number; y: number }) => void }) {
  const groups = useMemo(() => {
    const byKind = new Map<TileKind, Array<[number, number]>>();
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) {
        const k = map.kind(x, y)!;
        (byKind.get(k) ?? byKind.set(k, []).get(k)!).push([x, y]);
      }
    return [...byKind.entries()];
  }, [map]);

  return (
    <group>
      {groups.map(([kind, tiles]) => (
        <TileSet key={kind} kind={kind} tiles={tiles} onGround={onGround} />
      ))}
      <mesh position={[map.w / 2, -0.62, map.h / 2]} receiveShadow>
        <boxGeometry args={[map.w + 0.4, 1.0, map.h + 0.4]} />
        <meshStandardMaterial color="#c2a888" roughness={0.95} />
      </mesh>
      <mesh position={[map.w / 2, -1.34, map.h / 2]}>
        <boxGeometry args={[map.w + 0.1, 0.5, map.h + 0.1]} />
        <meshStandardMaterial color="#a38a6c" roughness={1} />
      </mesh>
    </group>
  );
}

function TileSet({ kind, tiles, onGround }: { kind: TileKind; tiles: Array<[number, number]>; onGround: (t: { x: number; y: number }) => void }) {
  const top = TOP[kind];
  const height = top + 0.5;
  const { geo, mat } = useMemo(() => {
    const g = new THREE.BoxGeometry(1, height, 1);
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: kind === 'water' ? 0.35 : 0.92, metalness: 0 });
    return { geo: g, mat: m };
  }, [kind, height]);

  const setMatrices = (m: THREE.InstancedMesh | null) => {
    if (!m) return;
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    const base = COLOR[kind];
    tiles.forEach(([x, y], i) => {
      o.position.set(x + 0.5, top - height / 2, y + 0.5);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      const j = JITTER.has(kind) ? (hash(x, y) - 0.5) * 0.08 : 0;
      c.set(j >= 0 ? mix(base, '#f4f0e0', j) : tone(base, j * 0.8));
      m.setColorAt(i, c);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  };

  return (
    <instancedMesh
      ref={setMatrices}
      args={[geo, mat, tiles.length]}
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        const p = e.point;
        onGround({ x: Math.floor(p.x), y: Math.floor(p.z) });
      }}
    />
  );
}
