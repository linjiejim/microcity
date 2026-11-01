import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Engine, HOUR, type Agent, type TownMap, type WorldState } from '@microcity/sim';
import { displayTime, focusFamily, useApp, viewState } from '../store.ts';
import { CH_HEX } from '../lib/format.ts';

const MAX = 4000;
const WHITE = new THREE.Color('#faf7f2');

/** 居民在地图上的锚点（在楼里时取门口） */
export function anchorOf(a: Agent, t: number, map: TownMap): { x: number; z: number } {
  if (a.loc.k === 'walk') {
    const p = Engine.positionAt(a, t);
    return { x: p.x + 0.5, z: p.y + 0.5 };
  }
  if (a.loc.k === 'street') return { x: a.loc.tile.x + 0.5, z: a.loc.tile.y + 0.5 };
  const pl = map.places[a.loc.place];
  const tile = pl?.open ? a.loc.tile : (pl?.door ?? a.loc.tile);
  return { x: tile.x + 0.5, z: tile.y + 0.5 };
}

/** 传播连线：小圆点连成的弧线，颜色 = 渠道；选中居民时只显示他收到 / 告诉别人的 */
export function Links({ map }: { map: TownMap }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { geo, mat } = useMemo(() => ({ geo: new THREE.SphereGeometry(0.055, 10, 8), mat: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 }) }), []);
  const color = useMemo(() => new THREE.Color(), []);
  const o = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const st = useApp.getState();
    const s: WorldState | undefined = viewState(st);
    if (!s || st.overlay === 'none') {
      m.count = 0;
      return;
    }
    const t = st.history ? st.history.t : displayTime(st.clock);
    const fam = focusFamily(st);
    const sel = st.selectedAgent;
    let n = 0;
    const tick = Math.floor(clock.elapsedTime * 6);
    for (let i = st.timeline.length - 1; i >= 0 && n < MAX; i--) {
      const e = st.timeline[i]!;
      if (e.type !== 'transmission') continue;
      if (e.t > t) continue;
      const tr = e.tr;
      if (tr.familyId !== fam) continue;
      const mine = sel && (tr.from === sel || tr.to === sel);
      if (sel && !mine) continue;
      if (!sel && t - e.t > 4 * HOUR) break;
      const a = s.agents[tr.from];
      const b = s.agents[tr.to];
      if (!a || !b) continue;
      const pa = anchorOf(a, t, map);
      const pb = anchorOf(b, t, map);
      const dist = Math.hypot(pb.x - pa.x, pb.z - pa.z);
      const steps = Math.max(3, Math.min(60, Math.floor(dist / 0.45)));
      const age = Math.max(0, (t - e.t) / (4 * HOUR));
      color.set(CH_HEX[tr.channel]);
      if (!sel) color.lerp(WHITE, age * 0.55);
      for (let k = 0; k <= steps && n < MAX; k++) {
        // 虚线流动：每隔一个点亮一次，随时间推进
        if ((k + tick) % 3 === 0 && k !== steps) continue;
        const f = k / steps;
        o.position.set(pa.x + (pb.x - pa.x) * f, 0.9 + Math.sin(Math.PI * f) * Math.min(2.5, 0.4 + dist * 0.12), pa.z + (pb.z - pa.z) * f);
        o.scale.setScalar(k === steps ? 2 : 1);
        o.updateMatrix();
        m.setMatrixAt(n, o.matrix);
        m.setColorAt(n, color);
        n++;
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geo, mat, MAX]} frustumCulled={false} />;
}
