import { useEffect, useState } from 'react';
import { clock, dayOf, formatTime, weekday } from '@microcity/sim';
import { api, type ScenarioView } from '../lib/api.ts';
import { displayTime, useApp, type Workspace } from '../store.ts';
import { Badge, Button, Icon, Popover, Segmented } from '../ui/kit.tsx';

export const SPEEDS = [1, 10, 60, 300, 1800] as const;

const WS: Array<{ id: Workspace; label: string; hint: string }> = [
  { id: 'gallery', label: '广场', hint: '精选实验：先猜，再跑（G）' },
  { id: 'design', label: '设计', hint: '造一座小镇，定好规则与剧本（D）' },
  { id: 'observe', label: '观察', hint: '看它实时发生（O）' },
  { id: 'review', label: '复盘', hint: '回看每个人的反应与社会的变化（R）' },
];

/** 快进目标：由剧本推出（每轮通知前后、停电前/中/后） */
export function jumpTargets(sc?: ScenarioView): Array<{ to: string; label: string; t: number }> {
  if (!sc) return [];
  const out: Array<{ t: number; label: string }> = [];
  for (const x of sc.script) {
    if (x.kind === 'publish') {
      out.push({ t: x.at - 5 * 60, label: `发布前` });
      out.push({ t: x.at + 4 * 3600, label: `发布后 4 小时` });
    }
  }
  for (const o of sc.outages) {
    const start = (o.day - 1) * 86400 + o.from;
    const end = (o.day - 1) * 86400 + o.to;
    out.push({ t: start - 10 * 60, label: '停电前' });
    out.push({ t: start + 30 * 60, label: '停电中' });
    out.push({ t: end + 10 * 60, label: '来电后' });
  }
  const seen = new Set<number>();
  return out
    .filter((x) => (seen.has(x.t) ? false : (seen.add(x.t), true)))
    .sort((a, b) => a.t - b.t)
    .map((x) => ({ to: formatTime(x.t), label: `${x.label} ${formatTime(x.t)}`, t: x.t }));
}

/** 品牌标：圆角方块里一座小房子 */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#1f5f63" />
      <path d="M8 15.5 16 9l8 6.5V24a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z" fill="#faf7f2" />
      <path d="M6.5 16 16 8.2l9.5 7.8" fill="none" stroke="#e3a13a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="14" y="18.5" width="4" height="6.5" rx="1" fill="#1f5f63" />
    </svg>
  );
}

function LiveClock() {
  const [, force] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (ts: number) => {
      if (ts - last > 250) {
        last = ts;
        force((x) => x + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const c = useApp((s) => s.clock);
  const history = useApp((s) => s.history);
  const t = history ? history.t : displayTime(c);
  return (
    <div className="clock" data-testid="clock" title={history ? '正在回看的历史时刻' : '模拟时间'}>
      <span className="clock-day">
        {weekday(dayOf(t))}
        {history ? ' · 回看' : ''}
      </span>
      <span className="clock-time num" data-testid="clock-time">
        D{String(dayOf(t)).padStart(2, '0')} {clock(t)}
      </span>
    </div>
  );
}

export function TopBar() {
  const ws = useApp((s) => s.workspace);
  const run = useApp((s) => s.run);
  const runId = useApp((s) => s.runId);
  const scenario = useApp((s) => s.scenario);
  const connected = useApp((s) => s.connected);
  const health = useApp((s) => s.health);
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);
  const [jumping, setJumping] = useState(false);
  const paused = run?.paused ?? true;

  const control = async (body: Parameters<typeof api.control>[1]) => {
    if (!runId) return;
    try {
      const r = await api.control(runId, body);
      set({ run: r, clock: { t: r.t, at: performance.now(), speed: r.speed, paused: r.paused, blocked: r.blocked } });
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };

  const jump = async (to: string) => {
    setJumping(true);
    await control({ op: 'jump', to });
    setJumping(false);
    set({ history: undefined });
  };

  return (
    <header className="topbar" data-testid="topbar">
      <div className="brand" title="可解释的人工社会实验室">
        <BrandMark />
        <span className="brand-name serif">微缩城</span>
      </div>

      <nav className="ws-tabs" role="tablist" data-testid="workspaces">
        {WS.map((w) => (
          <button key={w.id} role="tab" aria-selected={ws === w.id} className={`ws-tab ${ws === w.id ? 'on' : ''}`} onClick={() => set({ workspace: w.id })} title={w.hint} data-testid={`ws-${w.id}`}>
            {w.label}
          </button>
        ))}
      </nav>

      <div className="top-right">
        {(ws === 'observe' || ws === 'review') && (
          <button className="run-pick" onClick={() => set({ modal: { kind: 'runs' } })} data-testid="run-picker" title="切换 / 新建运行">
            <span className="run-name">{run?.name ?? '…'}</span>
            <Badge color={run?.provider === 'jev' ? 'var(--c-jev)' : 'var(--ink-3)'}>{run?.provider === 'jev' ? 'Jev' : '规则'}</Badge>
            {run?.branch && <Badge color="var(--rumor)">分支 {run.branch}</Badge>}
            <Icon name="down" size={14} color="var(--ink-3)" />
          </button>
        )}

        {ws === 'observe' && (
          <>
            <button className={`play-btn ${paused ? '' : 'on'}`} onClick={() => control({ op: paused ? 'play' : 'pause' })} title={paused ? '播放（空格）' : '暂停（空格）'} aria-label={paused ? '播放' : '暂停'} data-testid="play">
              <Icon name={paused ? 'play' : 'pause'} size={16} />
            </button>
            <LiveClock />
            <Popover
              align="right"
              width={320}
              testId="more-panel"
              trigger={(open, toggle) => <Button icon="more" variant="ghost" on={open} title="倍速、单步、快进、发布新闻" onClick={toggle} testId="more-controls" />}
            >
              {(close) => (
                <>
                  <div className="pop-sec">
                    <div className="pop-label">倍速</div>
                    <div className="pop-row">
                      <Segmented testId="speed" value={run?.speed ?? 60} onChange={(v) => control({ op: 'speed', speed: v })} options={SPEEDS.map((s, i) => ({ value: s, label: `${s}×`, title: `${s} 倍速（${i + 1}）` }))} />
                    </div>
                  </div>
                  <div className="pop-sec">
                    <div className="pop-label">推进</div>
                    <div className="pop-row">
                      <Button icon="step" size="sm" title="推进到下一个事件" onClick={() => control({ op: 'step', step: 'event' })} testId="step-event">
                        下一个事件
                      </Button>
                      <Button size="sm" title="推进 10 模拟分钟" onClick={() => control({ op: 'step', step: '10min' })} testId="step-10">
                        +10 分钟
                      </Button>
                    </div>
                    <div className="pop-row" style={{ marginTop: 8 }}>
                      <select className="field-input jump" value="" disabled={jumping} onChange={(e) => {
                          if (!e.target.value) return;
                          void jump(e.target.value);
                          close();
                        }} data-testid="jump" title="快进到剧本里的关键时刻">
                        <option value="">{jumping ? '快进中…' : '快进到剧本里的关键时刻…'}</option>
                        {jumpTargets(scenario).map((j) => (
                          <option key={j.to} value={j.to} disabled={!!run && run.t >= j.t}>
                            {j.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="pop-sec">
                    <div className="pop-label">干预</div>
                    <div className="pop-row">
                      <Button
                        icon="news"
                        size="sm"
                        onClick={() => {
                          close();
                          set({ modal: { kind: 'news' } });
                        }}
                        title="发布新闻：一次记录在案的干预（N）"
                        testId="open-news"
                      >
                        发布新闻
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </Popover>
          </>
        )}

        {ws === 'review' && run && (
          <div className="muted top-note">
            运行到 <span className="num dim">{formatTime(run.t)}</span>
            <Button size="sm" variant="ghost" onClick={() => set({ workspace: 'observe' })} testId="back-observe">
              回到观察
            </Button>
          </div>
        )}

        <div className="status">
          {health?.public && (
            <span className="public-note" title={`演示站：访客只能跑规则模式；每个实验最多 ${health.public.limits.maxSeeds} 个随机种子；访客的实验保留 ${health.public.limits.keepHours} 小时`}>
              演示站 · 规则模式
            </span>
          )}
          {(ws === 'observe' || ws === 'review') && (
            <span className={`conn ${connected ? 'on' : 'off'}`} title={connected ? '已连接服务端' : '断开，正在重连'} data-testid="conn">
              <i />
              {connected ? '在线' : '重连中'}
            </span>
          )}
          {ws === 'observe' && run && run.pending > 0 && (
            <Badge color="var(--info)" title="正在思考的居民（等待决策提交）">
              {run.pending} 人在想
            </Badge>
          )}
          <Button icon="activity" size="sm" variant="ghost" onClick={() => set({ modal: { kind: 'diagnostics' } })} title="诊断：模型调用、花费、重放校验" testId="open-diagnostics" />
          <Button icon="question" size="sm" variant="ghost" onClick={() => set({ modal: { kind: 'help' } })} title="帮助（?）" testId="open-help" />
        </div>
      </div>
    </header>
  );
}
