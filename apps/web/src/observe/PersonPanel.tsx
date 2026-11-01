import { useEffect, useMemo, useState } from 'react';
import { CARD_STAGE_TEXT, MOOD_TEXT, STAGES, STAGE_LABEL, clock, personCard, type PersonCard } from '@microcity/sim';
import { api } from '../lib/api.ts';
import { displayTime, focusFamily, useApp, viewState } from '../store.ts';
import { Avatar, Badge, Button, Empty, Icon, Meter, SecTitle } from '../ui/kit.tsx';
import { BEAT_ICON, TONE_COLOR } from '../lib/beats.ts';
import { placeName, windowTone } from '../lib/format.ts';

export const STAGE_COLOR: Record<PersonCard['stage'], string> = {
  unaware: 'var(--st-unaware)',
  glimpsed: 'var(--st-heard)',
  disbelieve: 'var(--bad)',
  doubt: 'var(--c-plum)',
  believe: 'var(--st-believe)',
  changed: 'var(--teal-2)',
  acted: 'var(--ok)',
};
export const MOOD_COLOR: Record<PersonCard['thought']['mood'], string> = {
  unaware: 'var(--ink-3)',
  calm: 'var(--info)',
  worried: 'var(--warn)',
  skeptical: 'var(--c-plum)',
  annoyed: 'var(--bad)',
  relieved: 'var(--ok)',
};

/** 精简人物卡（v4）：默认三行（在做什么、知道什么、因此）加想法；其余收进“更多” */
export function PersonPanel({ id }: { id: string }) {
  const s = useApp((st) => viewState(st));
  const map = useApp((st) => st.map);
  const rev = useApp((st) => st.rev);
  const fam = useApp((st) => focusFamily(st));
  const scenario = useApp((st) => st.scenario);
  const clockSync = useApp((st) => st.clock);
  const history = useApp((st) => st.history);
  const runId = useApp((st) => st.runId);
  const beats = useApp((st) => st.beats);
  const set = useApp((st) => st.set);
  const [voice, setVoice] = useState<{ text: string; source: string } | 'loading' | undefined>();
  const [more, setMore] = useState(false);
  const t = history?.t ?? displayTime(clockSync);
  const outage = scenario?.outages.find((o) => o.family === fam);
  const card = useMemo(() => (s && map && s.agents[id] ? personCard(s, map, id, fam, t, outage) : undefined), [s, map, id, fam, rev, Math.floor(t / 600), outage]);
  useEffect(() => setVoice(undefined), [id, card?.thought.text]);
  if (!s || !card) return <Empty>找不到这个居民</Empty>;
  const a = s.agents[id]!;
  const f = a.funnel[fam] ?? {};
  const mine = beats.filter((b) => b.agents.includes(id) && b.t <= t).slice(-5).reverse();
  const tone = windowTone(a.beliefs[fam]?.slots);
  const speak = async () => {
    if (!runId) return;
    setVoice('loading');
    try {
      const r = await api.monologue(runId, id, { t: Math.floor(t), family: fam });
      setVoice({ text: r.text, source: r.source });
    } catch {
      setVoice(undefined);
    }
  };
  const govDelta = Math.round((card.trustGov - card.trustGov0) * 100) / 100;
  const doing = a.act ? a.act.label : a.loc.k === 'walk' ? '在路上' : '空闲';
  const where = a.loc.k === 'walk' ? `正在去 ${placeName(s, a.loc.walk.toPlace)}` : a.loc.k === 'in' ? placeName(s, a.loc.place) : '街上';
  const because = card.changes.length > 0 ? `改了：${card.changes.slice(0, 2).join('；')}` : card.stop ? `没改安排：${card.stop.reason}` : card.stage === 'unaware' ? '—' : '还没改安排';
  return (
    <div className="person" data-testid="person-panel">
      <header className="person-head">
        <Avatar look={a.look} size={48} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="person-name" data-testid="insp-name">
            {a.name}
          </div>
          <div className="muted ellipsis">
            {a.age} 岁 · {a.roleLabel} · {s.households[a.householdId]?.label}
          </div>
        </div>
        <Button icon="cross" size="sm" variant="ghost" title="关闭 (Esc)" onClick={() => set({ selectedAgent: undefined })} testId="insp-close" />
      </header>
      <div className="person-body">
        <dl className="three">
          <dt>在做什么</dt>
          <dd>
            {doing}
            <span className="muted"> · {where}</span>
          </dd>
          <dt>知道什么</dt>
          <dd>
            {card.belief ? <span style={{ color: 'var(--ink)' }}>「{card.belief.text}」</span> : <span className="muted">{card.stage === 'glimpsed' ? '接触过，但没往心里去' : '还不知道这件事'}</span>}{' '}
            <Badge color={STAGE_COLOR[card.stage]}>{CARD_STAGE_TEXT[card.stage]}</Badge>
          </dd>
          <dt>因此</dt>
          <dd className={card.changes.length ? '' : 'muted'}>{because}</dd>
        </dl>

        <div className="thought" data-testid="thought" style={{ ['--mood' as string]: MOOD_COLOR[card.thought.mood] }}>
          <div className="thought-text">“{voice && voice !== 'loading' ? voice.text : card.thought.text}”</div>
          <div className="thought-foot">
            <Badge color={MOOD_COLOR[card.thought.mood]}>{MOOD_TEXT[card.thought.mood]}</Badge>
            {voice && voice !== 'loading' && <Badge color={voice.source === 'model' ? 'var(--c-jev)' : 'var(--ink-3)'}>{voice.source === 'model' ? 'DeepSeek 口吻' : '模板'}</Badge>}
            <span className="grow" />
            <button className="linkbtn" onClick={speak} disabled={voice === 'loading'} data-testid="speak">
              {voice === 'loading' ? '组织语言中…' : '用这个人的口吻说'}
            </button>
          </div>
        </div>

        <div className="person-actions">
          <Button icon="book" size="sm" onClick={() => set({ profile: id })} testId="open-profile">
            完整档案
          </Button>
          <Button icon="history" size="sm" onClick={() => set({ workspace: 'review', reviewTab: 'wall', trajectory: id })} testId="open-trajectory">
            看轨迹
          </Button>
          <span className="grow" />
          <button className="linkbtn" onClick={() => setMore(!more)} data-testid="person-more">
            {more ? '收起' : '更多'} <Icon name="down" size={14} style={{ transform: more ? 'rotate(180deg)' : undefined, verticalAlign: '-3px' }} />
          </button>
        </div>

        {more && (
          <div className="person-more">
            {card.belief && (
              <div className="belief-mini" style={{ ['--tone' as string]: tone.hex }}>
                <div className="muted">
                  {card.belief.via} · {card.belief.status === 'believe' ? '相信' : card.belief.status === 'doubt' ? '将信将疑' : '不信'} · 置信 {card.belief.confidence}
                </div>
                <Meter value={card.belief.confidence} color={tone.color} />
              </div>
            )}
            <div className="stage-strip" title="七阶段漏斗">
              {STAGES.map((st) => (
                <span key={st} className={f[st] !== undefined ? 'on' : ''} title={f[st] !== undefined ? `${STAGE_LABEL[st]} @ ${clock(f[st]!)}` : STAGE_LABEL[st]}>
                  {STAGE_LABEL[st]}
                </span>
              ))}
            </div>

            <SecTitle>最近</SecTitle>
            {mine.length === 0 && <div className="muted">还没有和这个人有关的事。</div>}
            <ol className="chain">
              {mine.map((b) => (
                <li key={b.id}>
                  <span className="num muted">{clock(b.t)}</span>
                  <Icon name={BEAT_ICON[b.kind]} size={14} color={TONE_COLOR[b.tone]} />
                  <div>{b.title}</div>
                </li>
              ))}
            </ol>

            <SecTitle>信任与经历</SecTitle>
            <div className="trust-row">
              <span className="muted">对官方通知</span>
              <Meter value={card.trustGov} color="var(--info)" />
              <span className="num" style={{ color: govDelta > 0 ? 'var(--ok)' : govDelta < 0 ? 'var(--bad)' : 'var(--ink-2)' }}>
                {card.trustGov.toFixed(2)}
                {govDelta !== 0 && ` (${govDelta > 0 ? '+' : ''}${govDelta})`}
              </span>
            </div>
            {card.memory.map((m) => (
              <div key={m.outage} className="muted memory-row" data-testid="person-memory">
                <Icon name="history" size={14} color={m.kind.startsWith('surprised') || m.kind.startsWith('false_alarm') || m.kind === 'vague_overreact' ? 'var(--bad)' : 'var(--ok)'} /> {m.text}
              </div>
            ))}
            {card.trustShifts.slice(0, 4).map((x) => (
              <div key={x.id} className="trust-row">
                <button className="linkbtn" onClick={() => set({ selectedAgent: x.id })}>
                  对{x.name}
                </button>
                <Meter value={x.to} color={x.to < x.from ? 'var(--bad)' : 'var(--ok)'} />
                <span className="num" style={{ color: x.to < x.from ? 'var(--bad)' : 'var(--ok)' }}>
                  {x.from.toFixed(2)}→{x.to.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
