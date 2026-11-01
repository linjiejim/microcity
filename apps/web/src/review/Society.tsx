import { useMemo } from 'react';
import { STAGES, STAGE_LABEL, STOP_LABEL, beliefCensus, formatTime, funnelMetrics, outcomeMetrics, timeToShare, trustSummary, type Beat, type FunnelStop, type WorldState } from '@microcity/sim';
import { focusFamily, useApp } from '../store.ts';
import { Badge, Empty, SecTitle } from '../ui/kit.tsx';
import { dur, pct } from '../lib/format.ts';
import { LineChart, Legend, StackChart, type Layer, type Line } from './charts.tsx';
import { Network } from './Network.tsx';
import { useReviewTimes, useSeries, useStateAt } from './data.ts';

const LAYERS: Layer[] = [
  { key: 'exact', label: '相信·精确时段', color: '#3e8e63', get: (p) => p.exact },
  { key: 'coarse', label: '相信·只知大概', color: '#e3a13a', get: (p) => p.coarse },
  { key: 'allDay', label: '相信·“全天”', color: '#c2553a', get: (p) => p.allDay },
  { key: 'unknown', label: '相信·时间不详', color: '#8f897e', get: (p) => p.unknown },
  { key: 'doubt', label: '将信将疑/不信', color: '#8a6a9a', get: (p) => p.doubt + p.disbelieve },
  { key: 'glimpsed', label: '扫到没进脑子', color: '#cfc7ba', get: (p) => p.glimpsed },
  { key: 'unaware', label: '未接触', color: '#e2dbcf', get: (p) => p.unaware },
];
const TRUST_LINES: Line[] = [{ key: 'gov', label: '对官方信任（均值）', color: '#4b7ead', get: (p) => p.trustGov }];
const TIE_LINES: Line[] = [
  { key: 'up', label: '人际信任上升的关系', color: '#3e8e63', get: (p) => p.tiesUp },
  { key: 'down', label: '人际信任下降的关系', color: '#c2553a', get: (p) => p.tiesDown },
];
const TRUST_HIST: Layer[] = [
  { key: 'h4', label: '≥0.75', color: '#2f5f8a', get: (p) => p.trustHist[4] },
  { key: 'h3', label: '0.6–0.75', color: '#4b7ead', get: (p) => p.trustHist[3] },
  { key: 'h2', label: '0.45–0.6', color: '#8f897e', get: (p) => p.trustHist[2] },
  { key: 'h1', label: '0.3–0.45', color: '#d98a2b', get: (p) => p.trustHist[1] },
  { key: 'h0', label: '<0.3', color: '#c2553a', get: (p) => p.trustHist[0] },
];

export function Society({ chapters }: { chapters: Beat[] }) {
  const { t, base } = useReviewTimes();
  const { state: sT } = useStateAt(t);
  const { state: sB } = useStateAt(base);
  const map = useApp((s) => s.map);
  const fam = useApp((s) => focusFamily(s));
  const scenario = useApp((s) => s.scenario);
  const set = useApp((s) => s.set);
  const { points: all } = useSeries(fam);
  // 曲线只画“有事发生”的一段：从第一条消息前 6 小时开始（回看更早的时刻时不裁）
  const firstInfo = chapters.find((b) => b.family === fam || b.kind === 'publish')?.t;
  const from = firstInfo !== undefined && t >= firstInfo ? Math.max(all[0]?.t ?? 0, firstInfo - 6 * 3600) : -Infinity;
  const points = all.filter((p) => p.t >= from);
  if (!sT || !map) return <Empty>载入中…</Empty>;
  const N = Object.keys(sT.agents).length;
  const outage = scenario?.outages.find((o) => o.family === fam);
  const pick = (tt: number) => set({ reviewT: tt >= (useApp.getState().run?.t ?? 0) - 60 ? null : tt });
  return (
    <div className="society" data-testid="society">
      <Kpis s={sT} b={sB} fam={fam} outageId={outage?.id} hasOutage={!!outage} />
      <SecTitle icon="bulb" extra={<span className="muted">点图表可跳到那一刻</span>}>
        大家相信什么（随时间）
      </SecTitle>
      <StackChart points={points} layers={LAYERS} total={N} t={t} base={base} onPick={pick} testId="chart-beliefs" />
      <Legend items={LAYERS.map((l) => ({ label: l.label, color: l.color }))} />
      <div className="soc-grid">
        <div>
          <SecTitle icon="link">对官方通知的信任</SecTitle>
          <LineChart points={points} lines={TRUST_LINES} lo={0.3} hi={0.9} t={t} base={base} onPick={pick} fmt={(v) => v.toFixed(2)} testId="chart-trust" />
          <StackChart points={points} layers={TRUST_HIST} total={N} t={t} base={base} height={70} onPick={pick} />
          <Legend items={TRUST_HIST.map((l) => ({ label: `信任 ${l.label}`, color: l.color }))} />
        </div>
        <div>
          <SecTitle icon="talk">人与人之间的信任</SecTitle>
          <LineChart points={points} lines={TIE_LINES} lo={0} hi={Math.max(4, ...points.map((p) => Math.max(p.tiesUp, p.tiesDown)))} t={t} base={base} onPick={pick} testId="chart-ties" />
          <Legend items={TIE_LINES.map((l) => ({ label: l.label, color: l.color }))} />
          <SocialChange s={sT} b={sB} fam={fam} base={base} />
        </div>
      </div>
      <div className="soc-grid">
        <div>
          <SecTitle icon="layers" extra={<span className="muted">点一个人看他的轨迹</span>}>
            谁告诉了谁（截至 {formatTime(t)}）
          </SecTitle>
          <Network s={sT} map={map} family={fam} t={t} />
          <Legend
            items={[
              { label: '精确时段', color: '#3e8e63' },
              { label: '只知大概', color: '#e3a13a' },
              { label: '“全天”', color: '#c2553a' },
              { label: '时间不详', color: '#8f897e' },
              { label: '外圈绿/红：对官方信任升/降', color: '#cfc7ba' },
            ]}
          />
        </div>
        <div>
          <FunnelAt s={sT} fam={fam} />
        </div>
      </div>
      {points.length === 0 && <div className="muted">曲线计算中…</div>}
    </div>
  );
}

function Kpis({ s, b, fam, outageId, hasOutage }: { s: WorldState; b?: WorldState; fam: string; outageId?: string; hasOutage: boolean }) {
  const c = beliefCensus(s, fam);
  const o = outcomeMetrics(s, outageId);
  const tr = trustSummary(s);
  const cb = b ? beliefCensus(b, fam) : undefined;
  const N = Object.keys(s.agents).length;
  const f = funnelMetrics(s, fam);
  const d = (x: number, y?: number) => (y === undefined || x === y ? null : <em className="num">{x > y ? `+${x - y}` : x - y}</em>);
  return (
    <div className="kpis six" data-testid="kpis">
      <div>
        <div className="muted">知情</div>
        <div className="kpi num">
          {c.aware}/{N} {d(c.aware, cb?.aware)}
        </div>
        <div className="muted">相信 {c.believe} · 怀疑 {c.doubt}</div>
      </div>
      <div>
        <div className="muted">知道精确时段</div>
        <div className="kpi num" style={{ color: 'var(--w-exact)' }}>
          {c.exact} {d(c.exact, cb?.exact)}
        </div>
        <div className="muted">只知大概 {c.coarse}</div>
      </div>
      <div>
        <div className="muted">以为“全天”</div>
        <div className="kpi num" style={{ color: c.allDay ? 'var(--w-allday)' : undefined }}>
          {c.allDay} {d(c.allDay, cb?.allDay)}
        </div>
        <div className="muted">谣言持有者</div>
      </div>
      <div>
        <div className="muted">改了安排</div>
        <div className="kpi num">{f.stages.intended}</div>
        <div className="muted">转告他人 {f.stages.relayed}</div>
      </div>
      <div>
        <div className="muted">措手不及</div>
        <div className="kpi num" style={{ color: o.surprisedPeople ? 'var(--bad)' : undefined }}>
          {hasOutage ? `${o.surprisedPeople} 人` : '—'}
        </div>
        <div className="muted">{hasOutage ? `过度调整 ${dur(o.overreactMin * 60)}` : '这条消息没有对应的真实停电'}</div>
      </div>
      <div>
        <div className="muted">对官方信任</div>
        <div className="kpi num" style={{ color: tr.govMean > tr.govMean0 ? 'var(--ok)' : tr.govMean < tr.govMean0 ? 'var(--bad)' : undefined }}>
          {tr.govMean.toFixed(2)}
        </div>
        <div className="muted">
          初始 {tr.govMean0.toFixed(2)} · ↑{tr.govUp} ↓{tr.govDown}
        </div>
      </div>
    </div>
  );
}

function SocialChange({ s, b, fam, base }: { s: WorldState; b?: WorldState; fam: string; base: number | null }) {
  const timeline = useApp((st) => st.timeline);
  const items = useMemo(() => {
    const out: Array<{ text: string; tone: string }> = [];
    const a = trustSummary(s);
    const z = b ? trustSummary(b) : undefined;
    out.push({ text: `对官方信任均值 ${z ? z.govMean.toFixed(3) : a.govMean0.toFixed(3)} → ${a.govMean.toFixed(3)}`, tone: a.govMean >= (z?.govMean ?? a.govMean0) ? 'var(--ok)' : 'var(--bad)' });
    out.push({ text: `人际信任：${a.tiesUp - (z?.tiesUp ?? 0)} 段上升、${a.tiesDown - (z?.tiesDown ?? 0)} 段下降`, tone: a.tiesDown > (z?.tiesDown ?? 0) ? 'var(--warn)' : 'var(--fg-2)' });
    const from = base ?? -Infinity;
    const tx = timeline.filter((e) => e.type === 'transmission' && e.tr.familyId === fam && e.t > from && e.t <= s.meta.t);
    const count = new Map<string, number>();
    for (const e of tx) if (e.type === 'transmission') count.set(e.tr.from, (count.get(e.tr.from) ?? 0) + 1);
    const hubs = [...count.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3);
    if (hubs.length) out.push({ text: `传话最多：${hubs.map(([id, n]) => `${s.agents[id]?.name}（${n}）`).join('、')}`, tone: 'var(--ch-talk)' });
    const rumor = [...new Set(Object.values(s.versions).filter((v) => v.familyId === fam && v.mutations.some((m) => m.op === 'fill_worst_case')).map((v) => s.agents[v.origin.by]?.name ?? v.origin.by))];
    if (rumor.length) out.push({ text: `把时段补成“全天”的人：${rumor.join('、')}`, tone: 'var(--rumor)' });
    out.push({ text: `这段时间里共转述 ${tx.length} 次`, tone: 'var(--fg-2)' });
    return out;
  }, [s, b, fam, base, timeline]);
  return (
    <div className="soc-change" data-testid="social-change">
      <SecTitle icon="compare">{base !== null ? `与基准（${formatTime(base)}）相比` : '截至此刻'}</SecTitle>
      <ul className="plain">
        {items.map((x, i) => (
          <li key={i} style={{ color: x.tone }}>
            {x.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FunnelAt({ s, fam }: { s: WorldState; fam: string }) {
  const f = funnelMetrics(s, fam);
  const news = Object.values(s.news).filter((n) => n.familyId === fam);
  const first = news.reduce((m, n) => Math.min(m, n.publishedAt), Infinity);
  const t50 = Number.isFinite(first) ? timeToShare(f, 0.5, first) : null;
  const t80 = Number.isFinite(first) ? timeToShare(f, 0.8, first) : null;
  return (
    <div>
      <SecTitle icon="filter" extra={<span className="muted">分母：{f.population} 人</span>}>
        传播漏斗
      </SecTitle>
      <div className="funnel" data-testid="funnel">
        {STAGES.map((st, i) => {
          const n = f.stages[st];
          // “转告他人”不是嵌套层（将信将疑的人也会说），按占全镇的比例显示
          const prev = st === 'relayed' ? f.population : i === 0 ? f.population : f.stages[STAGES[i - 1]!];
          return (
            <div key={st} className="funnel-row" data-testid={`funnel-${st}`}>
              <span className="funnel-label">{STAGE_LABEL[st]}</span>
              <div className="funnel-bar">
                <i style={{ width: `${(n / f.population) * 100}%`, background: i < 5 ? 'var(--info)' : i < 7 ? 'var(--accent)' : 'var(--ch-talk)' }} />
              </div>
              <span className="num funnel-n">{n}</span>
              <span className="num muted funnel-p">{prev > 0 ? pct(n / prev) : '—'}</span>
            </div>
          );
        })}
      </div>
      <div className="stops">
        {(Object.entries(f.stops) as Array<[FunnelStop, number]>)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => (
            <Badge key={k} color="var(--fg-2)" outline>
              {STOP_LABEL[k]} {n}
            </Badge>
          ))}
      </div>
      <div className="kpis">
        <div>
          <div className="muted">半数人相信用时</div>
          <div className="kpi num" data-testid="t50">
            {news.length ? dur(t50) : '—'}
          </div>
        </div>
        <div>
          <div className="muted">八成人相信用时</div>
          <div className="kpi num">{news.length ? dur(t80) : '—'}</div>
        </div>
      </div>
    </div>
  );
}
