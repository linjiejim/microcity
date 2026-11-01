import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { TownMap } from '@microcity/sim';
import { useApp, viewState } from '../store.ts';
import { posterTexture } from './textures.ts';
import { darkDistricts } from './districts.ts';

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function Instanced({ items, geo, color, colors, castShadow = true, emissive, rough = 0.85 }: { items: Array<[number, number, number, number?]>; geo: THREE.BufferGeometry; color?: string; colors?: string[]; castShadow?: boolean; emissive?: React.MutableRefObject<number>; rough?: number }) {
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: colors ? '#ffffff' : color, roughness: rough, flatShading: geo.type === 'IcosahedronGeometry' });
    if (emissive) {
      m.emissive = new THREE.Color(color ?? '#ffe3a3');
      m.emissiveIntensity = 0;
    }
    return m;
  }, [color, colors, emissive, rough, geo]);
  const set = (m: THREE.InstancedMesh | null) => {
    if (!m) return;
    const o = new THREE.Object3D();
    items.forEach(([x, y, z, s], i) => {
      o.position.set(x, y, z);
      o.scale.setScalar(s ?? 1);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (colors) m.setColorAt(i, new THREE.Color(colors[i % colors.length]!));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  };
  useFrame(() => {
    if (emissive) mat.emissiveIntensity = emissive.current;
  });
  return <instancedMesh ref={set} args={[geo, mat, items.length]} castShadow={castShadow} receiveShadow />;
}

const LEAF = ['#8fb27a', '#7ea56d', '#9dbf86', '#86ac74'];
const BLOOM = ['#e9a09d', '#efd98a', '#f4f1ea', '#d9867d'];

export function Props({ map, night }: { map: TownMap; night: React.MutableRefObject<number> }) {
  const trees = useMemo(() => map.props.filter((p) => p.kind === 'tree'), [map]);
  const lamps = useMemo(() => map.props.filter((p) => p.kind === 'lamp'), [map]);
  const benches = useMemo(() => map.props.filter((p) => p.kind === 'bench'), [map]);
  const flowers = useMemo(() => map.props.filter((p) => p.kind === 'flower'), [map]);
  const geos = useMemo(
    () => ({
      trunk: new THREE.CylinderGeometry(0.06, 0.09, 0.5, 8),
      crown: new THREE.IcosahedronGeometry(0.42, 1),
      crownTop: new THREE.IcosahedronGeometry(0.28, 1),
      pole: new THREE.CylinderGeometry(0.035, 0.045, 1.15, 8),
      lampHead: new THREE.SphereGeometry(0.11, 14, 10),
      bench: new THREE.BoxGeometry(0.7, 0.08, 0.26),
      benchLeg: new THREE.BoxGeometry(0.06, 0.2, 0.2),
      bloom: new THREE.SphereGeometry(0.075, 10, 8),
    }),
    [],
  );
  // 哪个区停电，哪个区的路灯就熄灭
  const northLamp = useRef(0);
  const southLamp = useRef(0);
  useFrame(() => {
    const s = viewState(useApp.getState());
    const n = night.current;
    const dark = darkDistricts(map, s);
    northLamp.current = dark.includes('north') ? 0 : n * 1.6;
    southLamp.current = dark.includes('south') ? 0 : n * 1.6;
  });
  const lampN = useMemo(() => lamps.filter((l) => map.districtOf(l) === 'north'), [lamps, map]);
  const lampS = useMemo(() => lamps.filter((l) => map.districtOf(l) === 'south'), [lamps, map]);

  return (
    <group>
      <Instanced items={trees.map((t) => [t.x + 0.5, 0.31, t.y + 0.5])} geo={geos.trunk} color="#9c7b5f" />
      <Instanced items={trees.map((t) => [t.x + 0.5, 0.86, t.y + 0.5, 0.9 + hash(t.x, t.y) * 0.25])} geo={geos.crown} colors={trees.map((t) => LEAF[Math.floor(hash(t.y, t.x) * 4)]!)} />
      <Instanced items={trees.map((t) => [t.x + 0.5 + (hash(t.x, t.y) - 0.5) * 0.12, 1.22 + hash(t.x, t.y) * 0.1, t.y + 0.5])} geo={geos.crownTop} colors={trees.map((t) => LEAF[Math.floor(hash(t.x + 1, t.y) * 4)]!)} />
      <Instanced items={lamps.map((l) => [l.x + 0.15, 0.63, l.y + 0.15])} geo={geos.pole} color="#6b675f" rough={0.5} />
      <Instanced items={lampN.map((l) => [l.x + 0.15, 1.25, l.y + 0.15])} geo={geos.lampHead} color="#ffe3a3" emissive={northLamp} castShadow={false} rough={0.3} />
      <Instanced items={lampS.map((l) => [l.x + 0.15, 1.25, l.y + 0.15])} geo={geos.lampHead} color="#ffe3a3" emissive={southLamp} castShadow={false} rough={0.3} />
      <Instanced items={benches.map((b) => [b.x + 0.5, 0.26, b.y + 0.5])} geo={geos.bench} color="#c49a74" />
      <Instanced items={benches.flatMap((b) => [[b.x + 0.22, 0.12, b.y + 0.5], [b.x + 0.78, 0.12, b.y + 0.5]] as Array<[number, number, number]>)} geo={geos.benchLeg} color="#6b5a4c" />
      <Instanced
        items={flowers.flatMap((f) => [0, 1, 2, 3].map((i) => [f.x + 0.25 + (i % 2) * 0.5, 0.18, f.y + 0.25 + Math.floor(i / 2) * 0.5] as [number, number, number]))}
        geo={geos.bloom}
        colors={BLOOM}
        castShadow={false}
      />
      <Fountain map={map} />
      {map.props
        .filter((p) => p.kind === 'board')
        .map((b) => (
          <Board key={b.ref} id={b.ref!} x={b.x} y={b.y} />
        ))}
    </group>
  );
}

function Fountain({ map }: { map: TownMap }) {
  const f = map.props.find((p) => p.kind === 'fountain');
  const water = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (water.current) water.current.scale.y = 1 + Math.sin(clock.elapsedTime * 3) * 0.08;
  });
  if (!f) return null;
  return (
    <group position={[f.x + 0.5, 0, f.y + 0.5]}>
      <mesh position={[0, 0.14, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.46, 0.5, 0.24, 24]} />
        <meshStandardMaterial color="#e6e0d6" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.27, 0]}>
        <cylinderGeometry args={[0.38, 0.38, 0.03, 24]} />
        <meshStandardMaterial color="#9cc7d8" roughness={0.25} />
      </mesh>
      <mesh ref={water} position={[0, 0.42, 0]}>
        <cylinderGeometry args={[0.05, 0.08, 0.32, 12]} />
        <meshStandardMaterial color="#c9e4ee" roughness={0.2} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

function Board({ id, x, y }: { id: string; x: number; y: number }) {
  const n = useApp((s) => viewState(s)?.boards[id]?.posters.length ?? 0);
  const t = posterTexture(n);
  return (
    <group position={[x + 0.5, 0, y + 0.5]}>
      {[-0.36, 0.36].map((px) => (
        <mesh key={px} position={[px, 0.45, 0]} castShadow>
          <cylinderGeometry args={[0.035, 0.035, 0.9, 8]} />
          <meshStandardMaterial color="#8a6356" roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[0, 0.78, 0.02]} castShadow>
        <boxGeometry args={[0.9, 0.6, 0.06]} />
        <meshStandardMaterial attach="material-0" color="#b08a6a" />
        <meshStandardMaterial attach="material-1" color="#b08a6a" />
        <meshStandardMaterial attach="material-2" color="#b08a6a" />
        <meshStandardMaterial attach="material-3" color="#b08a6a" />
        <meshStandardMaterial attach="material-4" map={t} roughness={0.9} />
        <meshStandardMaterial attach="material-5" color="#b08a6a" />
      </mesh>
      <mesh position={[0, 1.12, 0.02]} castShadow>
        <boxGeometry args={[1.0, 0.07, 0.16]} />
        <meshStandardMaterial color="#c8775b" roughness={0.7} />
      </mesh>
    </group>
  );
}
