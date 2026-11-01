import { useEffect, useMemo, useState } from 'react';
import { Engine, HOUR, type Agent, type TileKind, type TownMap, type WorldState } from '@microcity/sim';
import { displayTime, focusFamily, useApp, viewState } from '../store.ts';
import { darkDistricts } from './districts.ts';
import { knowState } from '../lib/know.ts';
import { CH_HEX, PAL, STATE_HEX, mix, soft, tone } from '../theme/palette.ts';

/** 平面地图的地块颜色：比 3D 更浅，让圆点最显眼 */
const FLAT: Record<TileKind, string> = {
  grass: '#e7ecd9',
  park: '#dbe7cb',
  road: '#e4ddd1',
  path: '#eee8dc',
  plaza: '#f0e6d4',
  water: '#cfe3ec',
  bridge: '#dccab1',
  lot: '#ebe6dd',
  tree: '#e7ecd9',
  flower: '#e3ead3',
};

/** 居民在地图上的位置：路上按行走插值，在楼里时排进楼内的格子 */
function spot(a: Agent, t: number, map: TownMap, s: WorldState): { x: number; y: number } {
  if (a.loc.k === 'walk') {
    const p = Engine.positionAt(a, t);
    return { x: p.x + 0.5, y: p.y + 0.5 };
  }
  if (a.loc.k === 'street') return { x: a.loc.tile.x + 0.5, y: a.loc.tile.y + 0.5 };
  const pl = map.places[a.loc.place];
  if (!pl) return { x: a.loc.tile.x + 0.5, y: a.loc.tile.y + 0.5 };
  if (pl.open) return { x: a.loc.tile.x + 0.5, y: a.loc.tile.y + 0.5 };
  const occ = s.places[pl.id]?.occupants ?? [];
  const i = Math.max(0, occ.indexOf(a.id));
  const cols = Math.max(1, Math.floor((pl.rect.w - 0.4) / 0.7));
  const col = i % cols;
  const row = Math.floor(i / cols);
  const rows = Math.max(1, Math.floor((pl.rect.h - 0.4) / 0.7));
  return { x: pl.rect.x + 0.55 + col * 0.7, y: pl.rect.y + 0.55 + (row % rows) * 0.7 };
}

/** 平面地图（v4 D54）：俯视，居民是按知情三态着色的圆点；点圆点选中居民 */
export function FlatMap({ map }: { map: TownMap }) {
  const [, tick] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      if (ts - last < 120) return;
      last = ts;
      tick((x) => (x + 1) % 1e9);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 地块按行合并成矩形
  const runs = useMemo(() => {
    const out: Array<{ x: number; y: number; w: number; kind: TileKind }> = [];
    for (let y = 0; y < map.h; y++) {
      let x = 0;
      while (x < map.w) {
        const k = map.kind(x, y)!;
        let w = 1;
        while (x + w < map.w && map.kind(x + w, y) === k) w++;
        out.push({ x, y, w, kind: k });
        x += w;
      }
    }
    return out;
  }, [map]);
  const buildings = useMemo(() => Object.values(map.places).filter((p) => !p.open), [map]);
  const trees = useMemo(() => map.props.filter((p) => p.kind === 'tree'), [map]);

  const st = useApp.getState();
  const s = viewState(st);
  const labels = useApp((x) => x.labels);
  const overlay = useApp((x) => x.overlay);
  const selected = useApp((x) => x.selectedAgent);
  const set = useApp((x) => x.set);
  const t = st.history ? st.history.t : displayTime(st.clock);
  const fam = focusFamily(st);
  const dark = darkDistricts(map, s);

  // 近 4 小时的转述（选中居民时只看和他有关的）
  const links: Array<{ id: string; a: { x: number; y: number }; b: { x: number; y: number }; color: string; o: number }> = [];
  if (s && overlay === 'spread') {
    for (let i = st.timeline.length - 1; i >= 0 && links.length < 160; i--) {
      const e = st.timeline[i]!;
      if (e.type !== 'transmission' || e.t > t || e.tr.familyId !== fam) continue;
      const mine = selected && (e.tr.from === selected || e.tr.to === selected);
      if (selected && !mine) continue;
      if (!selected && t - e.t > 4 * HOUR) break;
      const a = s.agents[e.tr.from];
      const b = s.agents[e.tr.to];
      if (!a || !b) continue;
      links.push({ id: `${i}`, a: spot(a, t, map, s), b: spot(b, t, map, s), color: CH_HEX[e.tr.channel], o: selected ? 0.9 : Math.max(0.2, 0.85 - ((t - e.t) / (4 * HOUR)) * 0.6) });
    }
  }

  return (
    <div className="flatmap" data-testid="flatmap">
      <svg viewBox={`-1 -1 ${map.w + 2} ${map.h + 2}`} preserveAspectRatio="xMidYMid meet" onClick={() => set({ selectedAgent: undefined, selectedPlace: undefined })}>
        <rect x={-0.4} y={-0.4} width={map.w + 0.8} height={map.h + 0.8} rx={1.2} fill="#f3efe6" />
        {runs.map((r, i) => (
          <rect key={i} x={r.x} y={r.y} width={r.w} height={1.02} fill={FLAT[r.kind]} />
        ))}
        {trees.map((p, i) => (
          <circle key={i} cx={p.x + 0.5} cy={p.y + 0.5} r={0.34} fill="#c6d8b0" />
        ))}
        {dark.map((d) => {
          const r = map.districtBounds(d);
          return <rect key={d} x={r.x} y={r.y} width={r.w} height={r.h} fill="#2e3445" opacity={0.07} />;
        })}
        {buildings.map((p) => {
          const c = mix(soft(p.style.roof), '#ffffff', 0.45);
          return (
            <g key={p.id}>
              <rect x={p.rect.x + 0.12} y={p.rect.y + 0.12} width={p.rect.w - 0.24} height={p.rect.h - 0.24} rx={0.35} fill={c} stroke={tone(c, -0.12)} strokeWidth={0.06} />
              {labels && (
                <text x={p.rect.x + p.rect.w / 2} y={p.rect.y + p.rect.h - 0.35} textAnchor="middle" fontSize={0.62} fill={PAL.ink2} style={{ pointerEvents: 'none' }}>
                  {p.short}
                </text>
              )}
            </g>
          );
        })}
        {links.map((l) => {
          const mx = (l.a.x + l.b.x) / 2;
          const my = (l.a.y + l.b.y) / 2 - Math.min(3, Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) * 0.25);
          return <path key={l.id} d={`M${l.a.x} ${l.a.y}Q${mx} ${my} ${l.b.x} ${l.b.y}`} fill="none" stroke={l.color} strokeWidth={0.09} strokeLinecap="round" opacity={l.o} />;
        })}
        {s &&
          Object.values(s.agents).map((a) => {
            if (a.act?.kind === 'sleep' && a.loc.k === 'in') return null;
            const p = spot(a, t, map, s);
            const on = a.id === selected;
            return (
              <g
                key={a.id}
                className="fm-dot"
                onClick={(e) => {
                  e.stopPropagation();
                  set({ selectedAgent: on ? undefined : a.id });
                }}
                data-testid={`dot-${a.id}`}
              >
                <title>{a.name}</title>
                {on && <circle cx={p.x} cy={p.y} r={0.62} fill="none" stroke={PAL.teal2} strokeWidth={0.1} />}
                <circle cx={p.x} cy={p.y} r={0.36} fill={STATE_HEX[knowState(a, fam)]} stroke="#fff" strokeWidth={0.09} />
              </g>
            );
          })}
      </svg>
    </div>
  );
}
