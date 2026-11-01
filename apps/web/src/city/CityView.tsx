import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { timeOfDay, type District, type TownMap } from '@microcity/sim';
import { displayTime, useApp, viewState } from '../store.ts';
import { Button, Icon, Segmented } from '../ui/kit.tsx';
import { Terrain } from './Terrain.tsx';
import { Buildings } from './Buildings.tsx';
import { Props } from './Props.tsx';
import { People } from './People.tsx';
import { Links } from './Links.tsx';
import { daylight } from './daylight.ts';
import { darkDistricts } from './districts.ts';
import { OverlayProjector } from './overlay.tsx';
import { AgentLabelsLayer, OutageBanner, PlaceLabelsLayer } from './Labels.tsx';
import { FlatMap } from './FlatMap.tsx';
import { CH_HEX, STATE_HEX } from '../theme/palette.ts';
import { KNOW_LABEL } from '../lib/know.ts';

const DIR = new THREE.Vector3(0.6124, 0.5, 0.6124).normalize();
const RIGHT = new THREE.Vector3(1, 0, -1).normalize();
const UPG = new THREE.Vector3(-1, 0, -1).normalize();
export const ZOOMS = [8, 10, 12, 14, 16, 18, 21, 24, 28, 32, 40, 48] as const;
const CH_LABEL = { website: '网站', push: '推送', board: '公告栏', talk: '交谈', dm: '私信', org: '单位' } as const;

interface CamState {
  target: THREE.Vector3;
  zoom: number;
}

function Rig({ cam, follow }: { cam: React.MutableRefObject<CamState>; follow: boolean }) {
  const { camera } = useThree();
  useFrame(() => {
    const st = useApp.getState();
    if (follow && st.selectedAgent) {
      const s = viewState(st);
      const a = s?.agents[st.selectedAgent];
      if (a) {
        const t = st.history ? st.history.t : displayTime(st.clock);
        const p =
          a.loc.k === 'walk'
            ? (() => {
                const w = a.loc.walk;
                const f = Math.max(0, Math.min(1, (t - w.t0) / Math.max(1, w.t1 - w.t0)));
                const i = Math.min(w.path.length - 1, Math.floor(f * (w.path.length - 1)));
                return w.path[i]!;
              })()
            : a.loc.tile;
        cam.current.target.lerp(new THREE.Vector3(p.x + 0.5, 0, p.y + 0.5), 0.08);
      }
    }
    const c = cam.current;
    camera.position.copy(c.target).addScaledVector(DIR, 80);
    camera.lookAt(c.target);
    const ortho = camera as THREE.OrthographicCamera;
    if (ortho.zoom !== c.zoom) {
      ortho.zoom = c.zoom;
      ortho.updateProjectionMatrix();
    }
  });
  return null;
}

function Lights({ night, map }: { night: React.MutableRefObject<number>; map: TownMap }) {
  const amb = useRef<THREE.AmbientLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const { scene } = useThree();
  const bg = useMemo(() => new THREE.Color(), []);
  const cx = map.w / 2;
  const cz = map.h / 2;
  useEffect(() => {
    if (sun.current) {
      sun.current.target.position.set(cx, 0, cz);
      scene.add(sun.current.target);
    }
  }, [scene, cx, cz]);
  useFrame(() => {
    const st = useApp.getState();
    const t = st.history ? st.history.t : displayTime(st.clock);
    const d = daylight(timeOfDay(t) / 3600);
    if (amb.current) {
      amb.current.color.copy(d.ambient);
      amb.current.intensity = d.ambientI;
    }
    if (sun.current) {
      sun.current.color.copy(d.sun);
      sun.current.intensity = d.sunI;
      sun.current.position.set(cx + d.sunDir.x * 40, d.sunDir.y * 40, cz + d.sunDir.z * 40);
    }
    bg.copy(d.sky);
    scene.background = bg;
    night.current = d.night;
  });
  const S = Math.max(34, map.w * 0.75);
  return (
    <>
      <ambientLight ref={amb} intensity={1} />
      <hemisphereLight args={['#fff8ec', '#b8a488', 0.35]} />
      <directionalLight
        ref={sun}
        castShadow
        intensity={2}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-S}
        shadow-camera-right={S}
        shadow-camera-top={S}
        shadow-camera-bottom={-S}
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
        shadow-radius={3}
      />
    </>
  );
}

function OutageOverlay({ map }: { map: TownMap }) {
  const dark = useApp((s) => darkDistricts(map, viewState(s)).join(','));
  if (!dark) return null;
  return (
    <>
      {dark.split(',').map((d) => {
        const r = map.districtBounds(d as District);
        return (
          <mesh key={d} position={[r.x + r.w / 2, 0.14, r.y + r.h / 2]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[r.w, r.h]} />
            <meshBasicMaterial color="#2e3445" transparent opacity={0.22} depthWrite={false} />
          </mesh>
        );
      })}
    </>
  );
}

/** 城市：3D 微缩小镇或平面地图；外层是两种视图共用的切换、图例与提示 */
export function CityView({ active = true }: { active?: boolean }) {
  const map = useApp((s) => s.map);
  const mode = useApp((s) => s.cityMode);
  const overlay = useApp((s) => s.overlay);
  const history = useApp((s) => s.history);
  const blocked = useApp((s) => s.clock.blocked && !s.clock.paused);
  const loaded = useApp((s) => !!s.state);
  const set = useApp((s) => s.set);
  return (
    <div className={`city surface mode-${mode}`} data-testid="city">
      {map && (mode === '3d' ? <City3D key={`${map.w}x${map.h}:${Object.keys(map.places).length}:${map.props.length}`} map={map} active={active} /> : <FlatMap map={map} />)}
      <div className="city-hud tl">
        <Segmented
          testId="city-mode"
          value={mode}
          onChange={(v) => set({ cityMode: v })}
          options={[
            { value: '3d', label: '小镇', icon: 'cube', title: '3D 微缩小镇' },
            { value: 'map', label: '地图', icon: 'map', title: '平面地图：更清楚，也更省电' },
          ]}
        />
      </div>
      <div className="city-hud bl legend" data-testid="city-legend">
        <div className="legend-row">
          {(['unaware', 'heard', 'believe'] as const).map((k) => (
            <span key={k}>
              <i style={{ background: STATE_HEX[k] }} />
              {KNOW_LABEL[k]}
            </span>
          ))}
        </div>
        {overlay === 'spread' && (
          <div className="legend-row sub">
            {(['website', 'push', 'board', 'talk', 'dm', 'org'] as const).map((c) => (
              <span key={c}>
                <i className="line" style={{ background: CH_HEX[c] }} />
                {CH_LABEL[c]}
              </span>
            ))}
          </div>
        )}
      </div>
      {history && (
        <div className="city-hud tc history-banner" data-testid="history-banner">
          <Icon name="history" size={16} /> 正在回看历史时刻（只读）
          <Button size="sm" variant="primary" onClick={() => set({ history: undefined })} testId="back-live">
            返回实时
          </Button>
        </div>
      )}
      {(!map || !loaded) && (
        <div className="city-loading" data-testid="city-loading">
          <span className="blink">载入小镇…</span>
        </div>
      )}
      {!history && blocked && (
        <div className="city-hud tc wait-banner">
          <Icon name="question" size={16} /> 居民在想，世界放慢一点
        </div>
      )}
    </div>
  );
}

function City3D({ map, active }: { map: TownMap; active: boolean }) {
  const night = useRef(0);
  const cam = useRef<CamState>({ target: new THREE.Vector3(map.w / 2, 0, map.h / 2), zoom: 18 });
  const [zoom, setZoom] = useState(18);
  const [follow, setFollow] = useState(false);
  const roofs = useApp((s) => s.roofs);
  const labels = useApp((s) => s.labels);
  const overlay = useApp((s) => s.overlay);
  const set = useApp((s) => s.set);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null);
  const suppressClick = useRef(false);

  // 自适应缩放：把整座小镇放进视野；用户手动缩放后不再自动适配
  const userZoomed = useRef(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fitNow = () => {
      if (userZoomed.current) return;
      const fit = Math.min(el.clientWidth / (map.w * 0.9 + 16), el.clientHeight / (map.h * 0.55 + 16));
      const z = [...ZOOMS].reverse().find((x) => x <= fit) ?? ZOOMS[0];
      cam.current.zoom = z;
      setZoom(z);
    };
    fitNow();
    const ro = new ResizeObserver(fitNow);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoomBy = (d: number) => {
    userZoomed.current = true;
    const i = ZOOMS.indexOf(cam.current.zoom as (typeof ZOOMS)[number]);
    const ni = Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 2 : i) + d));
    cam.current.zoom = ZOOMS[ni]!;
    setZoom(ZOOMS[ni]!);
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      const step = 3;
      const c = cam.current.target;
      if (e.key === 'ArrowLeft' || e.key === 'a') c.addScaledVector(RIGHT, -step);
      else if (e.key === 'ArrowRight' || e.key === 'd') c.addScaledVector(RIGHT, step);
      else if (e.key === 'ArrowUp' || e.key === 'w') c.addScaledVector(UPG, step);
      else if (e.key === 'ArrowDown' || e.key === 's') c.addScaledVector(UPG, -step);
      else if (e.key === '[') zoomBy(-1);
      else if (e.key === ']') zoomBy(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div
      ref={wrap}
      className="city-stage"
      onWheel={(e) => {
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? 1 : -1);
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('.city-hud')) return;
        drag.current = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 5) return;
        d.moved = true;
        d.x = e.clientX;
        d.y = e.clientY;
        const z = cam.current.zoom;
        cam.current.target.addScaledVector(RIGHT, -dx / z).addScaledVector(UPG, dy / z / 0.5);
        cam.current.target.x = Math.max(-4, Math.min(map.w + 4, cam.current.target.x));
        cam.current.target.z = Math.max(-4, Math.min(map.h + 4, cam.current.target.z));
        setFollow(false);
      }}
      onPointerUp={() => {
        suppressClick.current = !!drag.current?.moved;
        drag.current = null;
      }}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          e.stopPropagation();
          suppressClick.current = false;
        }
      }}
    >
      <Canvas
        frameloop={active ? 'always' : 'never'}
        orthographic
        shadows="percentage"
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
        camera={{ zoom: 18, near: -200, far: 400, position: [70, 50, 70] }}
        onPointerMissed={() => set({ selectedAgent: undefined, selectedPlace: undefined })}
      >
        <Rig cam={cam} follow={follow} />
        <Lights night={night} map={map} />
        <Terrain map={map} onGround={() => set({ selectedPlace: undefined })} />
        <Buildings map={map} night={night} />
        <Props map={map} night={night} />
        <People map={map} />
        <Links map={map} />
        <OutageOverlay map={map} />
        <OverlayProjector />
      </Canvas>
      <div className="city-overlay">
        <PlaceLabelsLayer map={map} />
        <OutageBanner map={map} />
        <AgentLabelsLayer />
      </div>
      <div className="city-hud tr tools">
        <Button size="sm" icon="roof" on={!roofs} title="掀开屋顶，看室内的人" onClick={() => set({ roofs: !roofs })} testId="toggle-roofs" />
        <Button size="sm" icon="tag" on={labels} title="地点标签" onClick={() => set({ labels: !labels })} testId="toggle-labels" />
        <Button size="sm" icon="layers" on={overlay === 'spread'} title="传播连线" onClick={() => set({ overlay: overlay === 'spread' ? 'none' : 'spread' })} testId="toggle-spread" />
        <Button size="sm" icon="eye" on={follow} title="镜头跟随选中的居民" onClick={() => setFollow(!follow)} testId="toggle-follow" />
      </div>
      <div className="city-hud br zoom-ctl">
        <Button size="sm" icon="minus" variant="ghost" title="缩小 [" onClick={() => zoomBy(-1)} testId="zoom-out" />
        <span className="zoom num">{Math.round((zoom / 18) * 100)}%</span>
        <Button size="sm" icon="plus" variant="ghost" title="放大 ]" onClick={() => zoomBy(1)} testId="zoom-in" />
      </div>
    </div>
  );
}
