import { useMemo } from 'react';
import { DISTRICT_LABEL, describeSlots, type District, type PlaceDef, type TownMap } from '@microcity/sim';
import { darkDistricts } from './districts.ts';
import { useApp, viewState } from '../store.ts';
import { Icon } from '../ui/kit.tsx';
import { agentPos, useAnchor } from './overlay.tsx';
import { buildingHeight } from './Buildings.tsx';

/** 地点标签：名字 + 在场人数 + 停电/调整营业标记 */
export function PlaceLabelsLayer({ map }: { map: TownMap }) {
  const labels = useApp((s) => s.labels);
  const occ = useApp((s) => {
    const st = viewState(s);
    const now = st?.meta.t ?? 0;
    // 调整营业只在生效时段内显示
    return st ? Object.values(st.places).map((p) => `${p.id}:${p.occupants.length}:${p.powered ? 1 : 0}:${p.mode.kind !== 'normal' && now >= p.mode.from && now < p.mode.to ? p.mode.kind : 'normal'}`).join('|') : '';
  });
  const occMap = useMemo(() => Object.fromEntries(occ.split('|').filter(Boolean).map((x) => x.split(':')).map(([id, n, pw, mode]) => [id!, { n: Number(n), powered: pw === '1', mode: mode! }])), [occ]);
  if (!labels) return null;
  return (
    <>
      {Object.values(map.places).map((p) => (
        <PlaceTag key={p.id} p={p} o={occMap[p.id]} />
      ))}
    </>
  );
}

function PlaceTag({ p, o }: { p: PlaceDef; o?: { n: number; powered: boolean; mode: string } }) {
  const sel = useApp((s) => s.selectedPlace === p.id);
  const set = useApp((s) => s.set);
  const pos = useMemo(() => ({ x: p.rect.x + p.rect.w / 2, y: p.open ? 1.2 : buildingHeight(p) + 0.5, z: p.rect.y + p.rect.h / 2 }), [p]);
  const ref = useAnchor(`place:${p.id}`, () => pos);
  const dark = o && !o.powered && p.needsPower;
  return (
    <div ref={ref} className="ov">
      <button className={`place-tag ${sel ? 'on' : ''} ${dark ? 'dark' : ''}`} onClick={() => set({ selectedPlace: sel ? undefined : p.id })} data-testid={`place-tag-${p.id}`}>
        {p.short}
        {o && o.n > 0 && <b>{o.n}</b>}
        {dark && <Icon name="boltOff" color="var(--bad)" />}
        {o && o.mode !== 'normal' && <span className="mode-chip">{o.mode === 'cold_menu' ? '冷饮' : '暂停'}</span>}
      </button>
    </div>
  );
}

/** 选中居民的名字牌 + 正在聊“消息”的对话气泡（每段对话一个气泡） */
export function AgentLabelsLayer() {
  const sel = useApp((s) => s.selectedAgent);
  const bubbles = useApp((s) => s.bubbles);
  const now = performance.now();
  const byConv = new Map<string, { id: string; until: number }>();
  for (const [id, b] of Object.entries(bubbles)) if (b.until > now && !byConv.has(b.convId)) byConv.set(b.convId, { id, until: b.until });
  const active = [...byConv.entries()].slice(-4);
  return (
    <>
      {sel && <NameTag id={sel} />}
      {active.map(([convId, b]) => (
        <Bubble key={convId} id={b.id} convId={convId} until={b.until} />
      ))}
    </>
  );
}

function NameTag({ id }: { id: string }) {
  const name = useApp((s) => viewState(s)?.agents[id]?.name ?? '');
  const ref = useAnchor(
    `name:${id}`,
    () => {
      const p = agentPos.get(id);
      return p && p.visible ? { x: p.x, y: p.y, z: p.z } : null;
    },
    22,
  );
  return (
    <div ref={ref} className="ov">
      <div className="name-tag">{name}</div>
    </div>
  );
}

function Bubble({ id, convId, until }: { id: string; convId: string; until: number }) {
  const dlg = useApp((s) => s.dialogues[convId]);
  const conv = useApp((s) => s.recent.findLast((e) => e.type === 'conversation' && e.id === convId));
  const state = useApp((s) => viewState(s));
  const ref = useAnchor(`bubble:${convId}`, () => {
    const p = agentPos.get(id);
    if (!p || performance.now() > until) return null;
    return { x: p.x, y: p.visible ? 1.6 : 2.4, z: p.z };
  });
  let lines: Array<{ speaker: string; text: string }> = [];
  if (dlg) lines = dlg.lines.slice(0, 2);
  else if (conv && conv.type === 'conversation') {
    lines = conv.exchanges
      .filter((e) => e.mentioned && e.versionId && state?.versions[e.versionId])
      .slice(0, 2)
      .map((e) => ({ speaker: e.from, text: `${describeSlots(state!.versions[e.versionId!]!.slots)}！` }));
  }
  if (lines.length === 0) return null;
  return (
    <div ref={ref} className="ov">
      <div className="speech" data-testid="speech">
        {lines.map((l, i) => (
          <div key={i}>
            <b>{state?.agents[l.speaker]?.name}：</b>
            {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 停电横幅：哪个区停电就挂在哪个区上空 */
export function OutageBanner({ map }: { map: TownMap }) {
  const dark = useApp((s) => darkDistricts(map, viewState(s)).join(','));
  return (
    <>
      {dark
        .split(',')
        .filter(Boolean)
        .map((d) => (
          <DistrictBanner key={d} map={map} d={d as District} />
        ))}
    </>
  );
}

function DistrictBanner({ map, d }: { map: TownMap; d: District }) {
  const r = map.districtBounds(d);
  const ref = useAnchor(`outage:${d}`, () => ({ x: r.x + r.w / 2, y: 4.5, z: r.y + r.h / 2 }));
  return (
    <div ref={ref} className="ov">
      <div className="outage-banner" data-testid="outage-banner">
        <Icon name="boltOff" color="var(--e-yellow)" /> {DISTRICT_LABEL[d]}停电中
      </div>
    </div>
  );
}
