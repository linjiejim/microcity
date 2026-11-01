import { useEffect, useRef, useState } from 'react';
import { DAY, clock, dayOf, dayStart, formatTime, weekday, type Beat } from '@microcity/sim';
import { focusFamily, useApp } from '../store.ts';
import { Button, Icon, Tabs } from '../ui/kit.tsx';
import { drawIcon } from '../ui/icons.ts';
import { BEAT_ICON, TONE_HEX } from '../lib/beats.ts';
import { useChapters, useReviewTimes } from './data.ts';
import { Wall } from './Wall.tsx';
import { Society } from './Society.tsx';
import { Compare } from './Compare.tsx';
import { ReportPanel } from './Report.tsx';
import { TrajectoryDrawer } from './Trajectory.tsx';
import { PAL, canvasFont } from '../theme/palette.ts';

/** 复盘：选一个时刻、一个对比基准，看每个人的反应与社会的变化 */
export function ReviewView() {
  const tab = useApp((s) => s.reviewTab);
  const set = useApp((s) => s.set);
  const trajectory = useApp((s) => s.trajectory);
  const scenario = useApp((s) => s.scenario);
  const fam = useApp((s) => focusFamily(s));
  const chapters = useChapters();
  const { t, base, now } = useReviewTimes();
  const live = useApp((s) => s.state);
  // 剧本里的每一轮 + 管理员发布的其他新闻
  const families = [
    ...(scenario?.outages ?? []).map((o) => ({ family: o.family, label: `${o.id} · ${o.area === 'north' ? '北区' : '南区'} D${String(o.day).padStart(2, '0')} 停电` })),
    ...Object.values(live?.news ?? {})
      .filter((n) => !(scenario?.outages ?? []).some((o) => o.family === n.familyId))
      .filter((n, i, arr) => arr.findIndex((m) => m.familyId === n.familyId) === i)
      .map((n) => ({ family: n.familyId, label: `干预 · ${n.headline.text.slice(0, 12)}` })),
  ];
  return (
    <div className="review" data-testid="review">
      <section className="review-head surface">
        <div className="review-row">
          <div className="review-when">
            <div className="t-2x num" data-testid="review-time">
              {formatTime(t)}
            </div>
            <div className="muted">{t >= now - 1 ? '此刻（运行的最新时刻）' : '回看的时刻'}</div>
          </div>
          <div className="review-nav">
            <Button size="sm" icon="step" onClick={() => stepChapter(chapters, t, -1, set)} title="上一个关键时刻" testId="chapter-prev" style={{ transform: 'scaleX(-1)' }} />
            <Button size="sm" icon="step" onClick={() => stepChapter(chapters, t, 1, set)} title="下一个关键时刻" testId="chapter-next" />
            <Button size="sm" onClick={() => set({ reviewT: null })} on={t >= now - 1} testId="review-now">
              此刻
            </Button>
          </div>
          <div className="field inline">
            <label>对比基准</label>
            <select
              className="field-input"
              value={base === null ? '-1' : String(base)}
              onChange={(e) => set({ reviewBase: Number(e.target.value) })}
              data-testid="review-base"
            >
              <option value="-1">不对比</option>
              {baseOptions(scenario?.script ?? [], chapters, t).map((o) => (
                <option key={o.t} value={o.t}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {families.length > 1 && (
            <div className="field inline">
              <label>看哪一轮</label>
              <select className="field-input" value={fam} onChange={(e) => set({ selectedFamily: e.target.value })} data-testid="review-family">
                {families.map((o) => (
                  <option key={o.family} value={o.family}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <ChapterBar chapters={chapters} t={t} base={base} now={now} />
      </section>
      <div className="review-body surface">
        <Tabs
          value={tab}
          onChange={(v) => set({ reviewTab: v })}
          testId="review-tabs"
          tabs={[
            { id: 'wall', label: '反应墙', icon: 'person' },
            { id: 'society', label: '社会', icon: 'link' },
            { id: 'compare', label: '对照', icon: 'compare' },
            { id: 'report', label: '报告', icon: 'book' },
          ]}
        />
        <div className="review-content" key={tab}>
          {tab === 'wall' && <Wall />}
          {tab === 'society' && <Society chapters={chapters} />}
          {tab === 'compare' && <Compare />}
          {tab === 'report' && <ReportPanel />}
        </div>
      </div>
      {trajectory && <TrajectoryDrawer id={trajectory} />}
    </div>
  );
}

// 跳到关键时刻之后 1 分钟（那一刻的变化才看得见）；比较时用落点而不是关键时刻本身，否则往回跳会停在原地
const AFTER = 60;
function stepChapter(chapters: Beat[], t: number, dir: 1 | -1, set: (p: { reviewT: number | null }) => void) {
  const ts = [...new Set(chapters.map((b) => b.t + AFTER))].sort((a, b) => a - b);
  const next = dir > 0 ? ts.find((x) => x > t + 30) : [...ts].reverse().find((x) => x < t - 30);
  if (next !== undefined) set({ reviewT: next });
  else if (dir > 0) set({ reviewT: null });
}

function baseOptions(script: Array<{ at: number; kind: string; headline?: string }>, chapters: Beat[], t: number): Array<{ t: number; label: string }> {
  const out: Array<{ t: number; label: string }> = [];
  for (const x of script) if (x.kind === 'publish' && x.at - 60 < t) out.push({ t: x.at - 60, label: `发布《${x.headline}》之前` });
  for (const b of chapters) if (b.t < t && (b.kind === 'outage' || b.kind === 'restore' || b.kind === 'milestone')) out.push({ t: b.t + 60, label: `${formatTime(b.t)} ${b.title}` });
  const seen = new Set<number>();
  return out.filter((o) => (seen.has(o.t) ? false : (seen.add(o.t), true))).sort((a, b) => a.t - b.t);
}

const FONT = canvasFont(12);
const PAD = 12;

function ChapterBar({ chapters, t, base, now }: { chapters: Beat[]; t: number; base: number | null; now: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const scenario = useApp((s) => s.scenario);
  const set = useApp((s) => s.set);
  const [tip, setTip] = useState<{ x: number; y: number; text: string; color: string } | null>(null);
  const hits = useRef<Array<{ x: number; b: Beat }>>([]);
  const range = useRef({ t0: 0, t1: 1, w: 1 });
  const [size, setSize] = useState(0);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = ref.current;
    const el = wrap.current;
    if (!c || !el || !scenario) return;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    c.width = W * dpr;
    c.height = H * dpr;
    c.style.width = `${W}px`;
    c.style.height = `${H}px`;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.font = FONT;
    g.textBaseline = 'top';
    const t0 = scenario.start;
    const t1 = Math.max(now, t0 + DAY / 2);
    const w = W - PAD * 2;
    range.current = { t0, t1, w };
    const X = (x: number) => PAD + ((x - t0) / (t1 - t0)) * w;
    const TY = Math.round(H * 0.6);
    g.clearRect(0, 0, W, H);
    for (let d = dayOf(t0); d <= dayOf(t1); d++) {
      const x = X(Math.max(t0, dayStart(d)));
      g.fillStyle = PAL.line;
      g.fillRect(Math.round(x), 4, 1, H - 8);
      g.fillStyle = PAL.ink3;
      g.fillText(`D${String(d).padStart(2, '0')} ${weekday(d)}`, x + 5, 5);
    }
    g.lineCap = 'round';
    g.lineWidth = 3;
    g.strokeStyle = PAL.line2;
    g.beginPath();
    g.moveTo(PAD, TY);
    g.lineTo(PAD + w, TY);
    g.stroke();
    const cx = X(t);
    g.strokeStyle = PAL.teal;
    g.beginPath();
    g.moveTo(PAD, TY);
    g.lineTo(cx, TY);
    g.stroke();
    if (base !== null) {
      const bx = X(base);
      g.strokeStyle = PAL.ink3;
      g.lineWidth = 1.5;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(bx, 18);
      g.lineTo(bx, H - 4);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = PAL.ink3;
      g.fillText('基准', bx + 5, H - 16);
    }
    const hs: Array<{ x: number; b: Beat }> = [];
    let lastIcon = -99;
    for (const b of chapters) {
      if (b.t > t1) continue;
      const x = X(b.t);
      const color = TONE_HEX[b.tone];
      if (x - lastIcon > 22) {
        g.fillStyle = PAL.surface;
        g.strokeStyle = color;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(x, TY, 9, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        drawIcon(g, BEAT_ICON[b.kind], x - 6, TY - 6, color, 12, 2.2);
        lastIcon = x;
      } else {
        g.fillStyle = color;
        g.beginPath();
        g.arc(x, TY, 3, 0, Math.PI * 2);
        g.fill();
      }
      hs.push({ x, b });
    }
    g.fillStyle = PAL.teal;
    g.beginPath();
    g.roundRect(cx - 2, TY - 15, 4, 30, 2);
    g.fill();
    hits.current = hs;
  }, [chapters, t, base, now, scenario, size]);

  const at = (e: React.MouseEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    let best: { x: number; b: Beat } | undefined;
    let bd = 7;
    for (const h of hits.current) {
      const d = Math.abs(h.x - x);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return { r, x, best };
  };
  return (
    <div
      ref={wrap}
      className="chapter-bar"
      data-testid="chapter-bar"
      onMouseMove={(e) => {
        const { r, best } = at(e);
        setTip(best ? { x: r.left + Math.min(r.width - 300, Math.max(0, best.x - 20)), y: r.top - 6, text: `${clock(best.b.t)} ${best.b.title}`, color: TONE_HEX[best.b.tone] } : null);
      }}
      onMouseLeave={() => setTip(null)}
      onClick={(e) => {
        const { x, best } = at(e);
        const { t0, t1, w } = range.current;
        const tt = best ? best.b.t + 60 : Math.round(t0 + ((x - PAD) / w) * (t1 - t0));
        set({ reviewT: tt >= now - 60 ? null : Math.max(t0, tt) });
      }}
    >
      <canvas ref={ref} />
      {tip && (
        <div className="tip surface" style={{ left: tip.x, top: tip.y, transform: 'translateY(-100%)' }}>
          <Icon name="history" color={tip.color} /> {tip.text}
        </div>
      )}
    </div>
  );
}
