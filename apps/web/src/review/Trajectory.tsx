import { useEffect, useState } from 'react';
import { CARD_STAGE_TEXT, clock, formatTime } from '@microcity/sim';
import { api, type Trajectory } from '../lib/api.ts';
import { focusFamily, useApp, viewState } from '../store.ts';
import { Avatar, Badge, Button, Empty, Icon, SecTitle } from '../ui/kit.tsx';
import { MOOD_COLOR, STAGE_COLOR } from '../observe/PersonPanel.tsx';
import { BEAT_ICON, TONE_COLOR } from '../lib/beats.ts';
import { cardDiff } from './Wall.tsx';
import { useReviewTimes } from './data.ts';

/** 人物轨迹：他在各个时刻知道什么、怎么想、做了什么、信任怎样变 */
export function TrajectoryDrawer({ id }: { id: string }) {
  const runId = useApp((s) => s.runId);
  const fam = useApp((s) => focusFamily(s));
  const s = useApp((st) => viewState(st));
  const set = useApp((st) => st.set);
  const toast = useApp((st) => st.toast);
  const { t } = useReviewTimes();
  const [data, setData] = useState<Trajectory>();
  const [voice, setVoice] = useState<{ text: string; source: string } | 'loading'>();
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    setData(undefined);
    setVoice(undefined);
    api
      .trajectory(runId, id, fam)
      .then((d) => alive && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [runId, id, fam]);
  const a = s?.agents[id];
  const close = () => set({ trajectory: undefined });
  const speak = async () => {
    if (!runId) return;
    setVoice('loading');
    try {
      const r = await api.monologue(runId, id, { t, family: fam });
      setVoice({ text: r.text, source: r.source });
    } catch (e) {
      toast((e as Error).message, 'bad');
      setVoice(undefined);
    }
  };
  const inCity = async () => {
    if (!runId) return;
    try {
      const h = await api.stateAt(runId, t);
      set({ workspace: 'observe', selectedAgent: id, trajectory: undefined, history: { seq: h.seq, t, state: h.state } });
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };
  const samples = (data?.samples ?? []).filter((x) => x.t <= t + 1);
  return (
    <div className="drawer-back" onMouseDown={(e) => e.target === e.currentTarget && close()} data-testid="trajectory">
      <aside className="drawer surface">
        <header className="insp-head">
          {a && <Avatar look={a.look} size={48} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t-2x" style={{ color: 'var(--fg-0)' }} data-testid="trajectory-name">
              {a?.name ?? id}
            </div>
            <div className="muted">{a ? `${a.age} 岁 · ${a.roleLabel} · 截至 ${formatTime(t)}` : ''}</div>
          </div>
          <Button icon="cross" size="sm" variant="ghost" title="关闭 (Esc)" onClick={close} testId="trajectory-close" />
        </header>
        <div className="insp-body">
          <div className="wrap-row" style={{ marginBottom: 10 }}>
            <Button icon="talk" onClick={speak} disabled={voice === 'loading'} testId="trajectory-speak">
              {voice === 'loading' ? '组织语言中…' : '用他的口吻说（此刻）'}
            </Button>
            <Button icon="eye" onClick={inCity} testId="trajectory-city">
              在城市里看这一刻
            </Button>
          </div>
          {voice && voice !== 'loading' && (
            <div className="thought" style={{ ['--mood' as string]: 'var(--e-cyan)' }}>
              <div className="thought-text">“{voice.text}”</div>
              <div className="thought-foot">
                <Badge color={voice.source === 'model' ? 'var(--e-cyan)' : 'var(--fg-3)'}>{voice.source === 'model' ? 'DeepSeek 口吻（只供展示）' : '模板'}</Badge>
              </div>
            </div>
          )}
          {!data && <Empty>重放事件日志，整理他的轨迹…</Empty>}
          {data && (
            <>
              <SecTitle icon="history">他的轨迹</SecTitle>
              <ol className="traj" data-testid="trajectory-steps">
                {samples.map((x, i) => {
                  const prev = samples[i - 1]?.card;
                  const d = cardDiff(prev, x.card);
                  return (
                    <li key={i} style={{ ['--stage' as string]: STAGE_COLOR[x.card.stage] }}>
                      <div className="traj-when">
                        <span className="num">{formatTime(x.t)}</span>
                        <span className="muted ellipsis">{x.label}</span>
                      </div>
                      <div className="traj-card">
                        <div className="wc-chips">
                          <span className="stage-chip">{CARD_STAGE_TEXT[x.card.stage]}</span>
                          {x.card.belief && <span className="muted">「{x.card.belief.text}」 {x.card.belief.via}</span>}
                        </div>
                        <div className="traj-thought" style={{ ['--mood' as string]: MOOD_COLOR[x.card.thought.mood] }}>
                          “{x.card.thought.text}”
                        </div>
                        {d.length > 0 && i > 0 && <div className="muted">变化：{d.join('；')}</div>}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {data.trust.filter((x) => x.t <= t).length > 0 && (
                <>
                  <SecTitle icon="link">信任怎么变的</SecTitle>
                  <ul className="plain">
                    {data.trust
                      .filter((x) => x.t <= t)
                      .map((x, i) => (
                        <li key={i}>
                          <span className="num muted">{formatTime(x.t)}</span> 对{x.name}{' '}
                          <span className="num" style={{ color: x.to < x.from ? 'var(--bad)' : 'var(--ok)' }}>
                            {x.from.toFixed(2)} → {x.to.toFixed(2)}
                          </span>
                          ：{x.reason}
                        </li>
                      ))}
                  </ul>
                </>
              )}
              <SecTitle icon="list">和他有关的事</SecTitle>
              <ol className="chain">
                {data.beats
                  .filter((b) => b.t <= t)
                  .slice(-40)
                  .reverse()
                  .map((b) => (
                    <li key={b.id}>
                      <span className="num muted">{clock(b.t)}</span>
                      <Icon name={BEAT_ICON[b.kind]} color={TONE_COLOR[b.tone]} />
                      <div>
                        {b.ref?.decision ? (
                          <button className="linkbtn" onClick={() => set({ modal: { kind: 'decision', id: b.ref!.decision! } })}>
                            {b.title}
                          </button>
                        ) : (
                          b.title
                        )}
                        {b.detail && <div className="muted">{b.detail}</div>}
                      </div>
                    </li>
                  ))}
              </ol>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
