import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlaceDef, PlaceKind, TownMap } from '@microcity/sim';
import { useApp, viewState } from '../store.ts';
import { awningTexture, doorX, signTexture, wallTexture } from './textures.ts';
import { PAL, soft, tone } from '../theme/palette.ts';

export const FLOOR_H = 0.8;
export const buildingHeight = (p: PlaceDef) => Math.max(1, p.style.floors) * FLOOR_H + 0.3;

/** 坡屋顶的建筑类型；其余是平屋顶加女儿墙 */
const GABLE = new Set<PlaceKind>(['residence', 'cafe', 'restaurant', 'convenience', 'clinic', 'newsroom']);
const SHOPS = new Set<PlaceKind>(['cafe', 'restaurant', 'convenience', 'supermarket']);

export function Buildings({ map, night }: { map: TownMap; night: React.MutableRefObject<number> }) {
  const places = useMemo(() => Object.values(map.places).filter((p) => !p.open), [map]);
  return (
    <group>
      {places.map((p) => (
        <Building key={p.id} p={p} night={night} />
      ))}
    </group>
  );
}

/** 坡屋顶：三角截面沿长边拉伸；屋脊顺着长边 */
function gableGeometry(w: number, d: number): { geo: THREE.BufferGeometry; h: number } {
  const over = 0.22;
  const along = w >= d;
  const short = (along ? d : w) + over;
  const long = (along ? w : d) + over;
  const h = Math.min(1.1, short * 0.36);
  const shape = new THREE.Shape();
  shape.moveTo(-short / 2, 0);
  shape.lineTo(short / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: long, bevelEnabled: false });
  geo.translate(0, 0, -long / 2);
  if (along) geo.rotateY(Math.PI / 2);
  geo.computeVertexNormals();
  return { geo, h };
}

function Building({ p, night }: { p: PlaceDef; night: React.MutableRefObject<number> }) {
  const roofs = useApp((s) => s.roofs);
  const selected = useApp((s) => s.selectedPlace === p.id);
  const H = buildingHeight(p);
  const cut = !roofs || selected;
  const wallH = cut ? 0.5 : H;
  const w = p.rect.w - 0.16;
  const d = p.rect.h - 0.16;
  const cx = p.rect.x + p.rect.w / 2;
  const cz = p.rect.y + p.rect.h / 2;
  const gable = GABLE.has(p.kind);
  const roofColor = soft(p.style.roof);
  const trim = soft(p.style.trim);

  const mats = useMemo(() => {
    const mk = (face: 'south' | 'north' | 'east' | 'west') =>
      new THREE.MeshStandardMaterial({ map: wallTexture(p, face, false), emissiveMap: wallTexture(p, face, true), emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, roughness: 0.9 });
    const top = new THREE.MeshStandardMaterial({ color: tone(soft(p.style.wall), 0.05), roughness: 0.9 });
    return [mk('east'), mk('west'), top, top, mk('south'), mk('north')];
  }, [p]);
  const cutMats = useMemo(() => {
    const side = new THREE.MeshStandardMaterial({ color: tone(soft(p.style.wall), 0.15), roughness: 0.9 });
    const floor = new THREE.MeshStandardMaterial({ color: '#e7d8c1', roughness: 0.95 });
    return [side, side, floor, side, side, side];
  }, [p]);
  const roof = useMemo(() => (gable ? gableGeometry(w, d) : null), [gable, w, d]);
  const roofMat = useMemo(() => new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.8, flatShading: true }), [roofColor]);
  const lastLit = useRef(-1);

  useFrame(() => {
    const st = useApp.getState();
    const s = viewState(st);
    const powered = s?.places[p.id]?.powered ?? true;
    const lit = cut ? 0 : night.current * (powered ? 1 : 0);
    const v = Math.round(lit * 10) / 10;
    if (v !== lastLit.current) {
      lastLit.current = v;
      for (const i of [0, 1, 4, 5]) (mats[i] as THREE.MeshStandardMaterial).emissiveIntensity = v * 1.1;
    }
  });

  const select = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    const st = useApp.getState();
    st.set({ selectedPlace: st.selectedPlace === p.id ? undefined : p.id });
  };

  const dx = p.rect.x + doorX(p) + 0.5;
  const details = useMemo(() => roofDetails(p), [p]);

  return (
    <group>
      <mesh position={[cx, wallH / 2, cz]} castShadow receiveShadow material={cut ? cutMats : mats} onClick={select}>
        <boxGeometry args={[w, wallH, d]} />
      </mesh>
      {!cut && (
        <>
          {roof ? (
            <mesh position={[cx, H, cz]} geometry={roof.geo} material={roofMat} castShadow receiveShadow onClick={select} />
          ) : (
            <>
              <mesh position={[cx, H + 0.06, cz]} castShadow receiveShadow onClick={select}>
                <boxGeometry args={[w + 0.1, 0.12, d + 0.1]} />
                <meshStandardMaterial color={tone(roofColor, 0.25)} roughness={0.9} />
              </mesh>
              <mesh position={[cx, H + 0.1, cz]}>
                <boxGeometry args={[w - 0.3, 0.06, d - 0.3]} />
                <meshStandardMaterial color={tone(roofColor, 0.05)} roughness={0.95} />
              </mesh>
              {details.map((b, i) => (
                <mesh key={i} position={[cx + b.x, H + 0.13 + b.h / 2, cz + b.z]} castShadow>
                  <boxGeometry args={[b.w, b.h, b.d]} />
                  <meshStandardMaterial color={b.color} roughness={0.8} />
                </mesh>
              ))}
            </>
          )}
          {p.style.sign && (
            <mesh position={[dx, Math.min(H - 0.25, 1.05), p.rect.y + p.rect.h - 0.06]}>
              <boxGeometry args={[0.56, 0.56, 0.05]} />
              <meshStandardMaterial attach="material-0" color={trim} />
              <meshStandardMaterial attach="material-1" color={trim} />
              <meshStandardMaterial attach="material-2" color={trim} />
              <meshStandardMaterial attach="material-3" color={trim} />
              <meshStandardMaterial attach="material-4" map={signTexture(p.style.sign, tone(trim, 0.55), PAL.ink)} roughness={0.8} />
              <meshStandardMaterial attach="material-5" color={trim} />
            </mesh>
          )}
          {SHOPS.has(p.kind) && <Awning p={p} color={soft(p.style.trim)} />}
        </>
      )}
      {selected && <Outline x={cx} y={wallH / 2} z={cz} w={w + 0.2} h={wallH + 0.2} d={d + 0.2} />}
    </group>
  );
}

function Awning({ p, color }: { p: PlaceDef; color: string }) {
  const t = useMemo(() => {
    const tx = awningTexture(color).clone();
    tx.repeat.set(p.rect.w * 0.8, 1);
    tx.needsUpdate = true;
    return tx;
  }, [p, color]);
  return (
    <mesh position={[p.rect.x + p.rect.w / 2, 0.98, p.rect.y + p.rect.h + 0.14]} rotation={[0.42, 0, 0]} castShadow>
      <boxGeometry args={[p.rect.w - 0.4, 0.04, 0.52]} />
      <meshStandardMaterial map={t} roughness={0.85} />
    </mesh>
  );
}

function Outline({ x, y, z, w, h, d }: { x: number; y: number; z: number; w: number; h: number; d: number }) {
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), [w, h, d]);
  return (
    <lineSegments position={[x, y, z]} geometry={geo}>
      <lineBasicMaterial color={PAL.teal2} />
    </lineSegments>
  );
}

function roofDetails(p: PlaceDef): Array<{ x: number; z: number; w: number; h: number; d: number; color: string }> {
  const seed = p.id.charCodeAt(1) + p.id.charCodeAt(2) * 7;
  const out: Array<{ x: number; z: number; w: number; h: number; d: number; color: string }> = [];
  if (p.kind === 'utility') {
    out.push({ x: 0, z: 0, w: 1.2, h: 0.36, d: 0.8, color: '#b9bec4' }, { x: 1.4, z: 0.5, w: 0.14, h: 1.1, d: 0.14, color: '#e8b460' });
  } else if (p.kind === 'studio' || p.kind === 'gov' || p.kind === 'library') {
    out.push({ x: (seed % 3) - 1, z: -0.5, w: 0.8, h: 0.3, d: 0.6, color: '#d8d4cd' });
  } else if (p.kind === 'supermarket') {
    out.push({ x: -1, z: 0, w: 0.9, h: 0.3, d: 0.6, color: '#d8d4cd' }, { x: 1, z: 0, w: 0.9, h: 0.3, d: 0.6, color: '#d8d4cd' });
  }
  return out;
}
