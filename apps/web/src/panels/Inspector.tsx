import { useEffect, useMemo, useState } from 'react';
import { STAGES, STAGE_LABEL, STOP_LABEL, clock, dayOf, describeSlots, slotSummary, fatigueOf, hungerOf, type Agent, type DomainEvent, type PlanItem, type WorldState } from '@microcity/sim';
import { api, type AgentDetail } from '../lib/api.ts';
import { displayTime, focusFamily, useApp, viewState } from '../store.ts';
import { Avatar, Badge, Button, Empty, Icon, Meter, SecTitle, Tabs } from '../ui/kit.tsx';
import { CH_COLOR, CH_ICON, CHANNEL_LABEL, FRAGMENT_LABEL, describeEvent, dur, placeName, windowTone, yuan } from '../lib/format.ts';
import type { IconName } from '../ui/icons.ts';

export function Inspector({ id, onClose }: { id: string; onClose: () => void }) {
  const s = useApp((st) => viewState(st));
  const rev = useApp((st) => st.rev);
  const runId = useApp((st) => st.runId);
  const tab = useApp((st) => st.inspectorTab);
  const history = useApp((st) => st.history);
  const set = useApp((st) => st.set);
  const [detail, setDetail] = useState<AgentDetail>();

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    const load = () =>
      api
        .agent(runId, id)
        .then((d) => alive && setDetail(d))
        .catch(() => {});
    void load();
    const timer = history ? undefined : setInterval(load, 2500);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [runId, id, history]);

  const a = s?.agents[id];
  if (!a || !s) return <Empty>找不到这个居民</Empty>;
  const cutoff = history?.t ?? Infinity;
  const timeline = (detail?.agent.id === id ? detail.timeline : []).filter((e) => e.t <= cutoff);
  const hh = s.households[a.householdId];

  return (
    <div className="inspector" data-testid="inspector">
      <header className="insp-head">
        <Avatar look={a.look} size={48} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t-2x" style={{ color: 'var(--fg-0)' }} data-testid="profile-name">
            {a.name}
          </div>
          <div className="muted">
            {a.age} 岁 · {a.roleLabel} · {hh?.label}（{placeName(s, a.home)}）
          </div>
        </div>
        <Button icon="cross" size="sm" variant="ghost" title="关闭 (Esc)" onClick={onClose} testId="profile-close" />
      </header>
      <Tabs
        value={tab}
        onChange={(v) => set({ inspectorTab: v })}
        testId="insp-tabs"
        tabs={[
          { id: 'overview', label: '概况', icon: 'person' },
          { id: 'mind', label: '认知', icon: 'bulb' },
          { id: 'memory', label: '记忆', icon: 'book' },
          { id: 'relations', label: '关系', icon: 'link' },
          { id: 'decisions', label: '决策', icon: 'dice', count: detail?.decisions.filter((d) => d.t <= cutoff).length },
          { id: 'timeline', label: '时间线', icon: 'list' },
        ]}
      />
      <div className="insp-body" key={tab}>
        {tab === 'overview' && <Overview a={a} s={s} />}
        {tab === 'mind' && <Mind a={a} s={s} timeline={timeline} />}
        {tab === 'memory' && <Memory a={a} s={s} timeline={timeline} />}
        {tab === 'relations' && <Relations a={a} s={s} detail={detail} />}
        {tab === 'decisions' && <Decisions detail={detail} cutoff={cutoff} />}
        {tab === 'timeline' && <Timeline a={a} s={s} timeline={timeline} />}
      </div>
      <span hidden>{rev}</span>
    </div>
  );
}

const STATUS_ICON: Record<string, { icon: IconName; color: string; label: string }> = {
  done: { icon: 'check', color: 'var(--ok)', label: '完成' },
  active: { icon: 'play', color: 'var(--accent)', label: '进行中' },
  failed: { icon: 'cross', color: 'var(--bad)', label: '落空' },
  interrupted: { icon: 'boltOff', color: 'var(--bad)', label: '被打断' },
  cancelled: { icon: 'minus', color: 'var(--fg-3)', label: '已取消' },
  planned: { icon: 'clock', color: 'var(--fg-3)', label: '计划中' },
};

function PlanList({ items, s }: { items: PlanItem[]; s: WorldState }) {
  const set = useApp((st) => st.set);
  const visible = items.filter((it) => it.status !== 'cancelled' && it.end - it.start >= 300);
  return (
    <div className="plan">
      {visible.map((it) => {
        const st = STATUS_ICON[it.status]!;
        const revised = it.origin && it.origin.reason !== 'fallback';
        return (
          <div key={it.id} className={`plan-row ${it.status}`} data-testid="plan-row">
            <span className="num muted">{clock(it.start)}</span>
            <Icon name={st.icon} color={st.color} title={st.label} />
            <span className="plan-label">
              {it.label}
              <span className="muted"> · {placeName(s, it.place)}</span>
              {it.needsPower && <Icon name="bolt" color="var(--e-yellow)" title="需要用电" style={{ marginLeft: 4, verticalAlign: -2 }} />}
            </span>
            {revised && (
              <button className="tagbtn" onClick={() => it.origin?.decisionId && set({ modal: { kind: 'decision', id: it.origin.decisionId } })} title="因为消息改了安排：点开看这次决定">
                改
              </button>
            )}
            {it.origin?.reason === 'fallback' && <span className="tagbtn warn" title="临时替代安排">替</span>}
          </div>
        );
      })}
    </div>
  );
}

function Overview({ a, s }: { a: Agent; s: WorldState }) {
  const clockSync = useApp((st) => st.clock);
  const history = useApp((st) => st.history);
  const t = history?.t ?? displayTime(clockSync);
  const today = dayOf(t);
  const [showTomorrow, setShowTomorrow] = useState(false);
  const battery = Math.max(0, Math.min(100, a.phone.battery + (a.phone.charging ? 30 : a.phone.awake ? -a.phone.drain : -1) * ((t - a.phone.at) / 3600)));
  const where = a.loc.k === 'walk' ? `正在走去 ${placeName(s, a.loc.walk.toPlace)}（${clock(a.loc.walk.t1)} 到）` : a.loc.k === 'in' ? placeName(s, a.loc.place) : '街上';
  return (
    <div data-testid="insp-overview">
      <SecTitle icon="clock">现在</SecTitle>
      <div className="now-card">
        <div className="row-title">{a.act ? a.act.label : a.loc.k === 'walk' ? '在路上' : '空闲'}</div>
        <div className="muted">
          {where}
          {a.act && ` · ${clock(a.act.startedAt)}–${clock(a.act.endsAt)}`}
        </div>
      </div>
      <div className="stats-grid">
        <div>
          <div className="muted">饥饿</div>
          <Meter value={hungerOf(a, t)} color="var(--warn)" />
        </div>
        <div>
          <div className="muted">疲劳</div>
          <Meter value={fatigueOf(a, t)} color="var(--info)" />
        </div>
        <div>
          <div className="muted">
            手机 {Math.round(battery)}% {a.phone.charging && <Icon name="bolt" color="var(--e-yellow)" />}
          </div>
          <Meter value={battery / 100} color={battery < 20 ? 'var(--bad)' : 'var(--ok)'} />
        </div>
        <div>
          <div className="muted">钱包</div>
          <div className="num" style={{ color: 'var(--fg-0)' }}>
            {yuan(s.accounts[a.wallet] ?? 0)}
          </div>
        </div>
      </div>
      {(a.stats.inconvenience > 0 || a.stats.overreactSec > 0) && (
        <>
          <SecTitle icon="boltOff">停电影响</SecTitle>
          <dl className="kv">
            <dt>受影响的安排</dt>
            <dd>
              {a.stats.inconvenience} 项，{dur(a.stats.disruptedSec)}
            </dd>
            <dt>其中措手不及</dt>
            <dd style={{ color: a.stats.surprised ? 'var(--bad)' : undefined }}>{a.stats.surprised} 项</dd>
            {a.stats.overreactSec > 0 && (
              <>
                <dt>过度调整</dt>
                <dd style={{ color: 'var(--rumor)' }}>{dur(a.stats.overreactSec)}</dd>
              </>
            )}
          </dl>
        </>
      )}
      <SecTitle
        icon="list"
        extra={
          a.plans[today + 1] && (
            <Button size="sm" variant="ghost" onClick={() => setShowTomorrow(!showTomorrow)}>
              {showTomorrow ? '看今天' : '看明天'}
            </Button>
          )
        }
      >
        {showTomorrow ? '明天的安排' : '今天的安排'}
      </SecTitle>
      <PlanList items={(showTomorrow ? a.plans[today + 1] : a.plans[today]) ?? []} s={s} />
      <SecTitle icon="person">人物</SecTitle>
      <p className="bio">{a.bio}</p>
      <div className="muted">口语风格：{a.speech}</div>
      <div className="trait-grid">
        {(
          [
            ['焦虑', a.traits.anxiety],
            ['风险规避', a.traits.riskAversion],
            ['社交主动', a.traits.sociability],
            ['秩序偏好', a.traits.order],
            ['好奇心', a.traits.curiosity],
            ['利他', a.traits.altruism],
            ['重承诺', a.traits.commitment],
            ['信任官方', a.traits.trustOfficial],
            ['记细节', a.traits.detail],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="trait">
            <span className="muted">{k}</span>
            <Meter value={v} color="var(--accent)" />
          </div>
        ))}
      </div>
      <div className="muted" style={{ marginTop: 8 }}>
        特质是模型参数（0–1），不是完整人格。
      </div>
    </div>
  );
}

function Mind({ a, s, timeline }: { a: Agent; s: WorldState; timeline: DomainEvent[] }) {
  const set = useApp((st) => st.set);
  const fams = [...new Set([...Object.keys(a.beliefs), ...Object.keys(a.funnel)])];
  if (fams.length === 0) {
    return (
      <div data-testid="insp-mind">
        <Empty icon="bulb">对任何新闻都还一无所知。</Empty>
        <SecTitle icon="eye">他能从哪里知道</SecTitle>
        <dl className="kv">
          <dt>订阅政务推送</dt>
          <dd>{a.habits.push ? '是' : '否'}</dd>
          <dt>看镇网站</dt>
          <dd>{a.habits.website.length ? a.habits.website.map((x) => ({ wake: '起床后', lunch: '午饭时', evening: '晚上' })[x]).join('、') : '不看'}</dd>
          <dt>看手机</dt>
          <dd>{{ low: '很少', mid: '一般', high: '频繁' }[a.habits.phone]}</dd>
          <dt>口耳相传</dt>
          <dd>取决于家人、同事、朋友和邻居</dd>
        </dl>
      </div>
    );
  }
  return (
    <div data-testid="insp-mind">
      {fams.map((fam) => {
        const b = a.beliefs[fam];
        const f = a.funnel[fam] ?? {};
        const tone = windowTone(b?.slots);
        const exposures = timeline.filter((e) => (e.type === 'exposure' && e.family === fam) || (e.type === 'comprehended' && e.family === fam) || (e.type === 'belief_set' && e.family === fam));
        return (
          <div key={fam} className="belief-card" style={{ ['--tone' as string]: tone.hex }}>
            <div className="belief-head">
              <Icon name={b?.slots.window?.kind === 'all_day' ? 'rumor' : 'bulb'} color={tone.color} />
              <div style={{ flex: 1 }}>
                <div className="row-title" style={{ color: 'var(--fg-0)' }} data-testid="belief-statement">
                  {b ? describeSlots(b.slots, { withAdvice: true }) : '接触过，但没形成信念'}
                </div>
                <div className="muted">
                  {b ? `${b.status === 'believe' ? '相信' : b.status === 'doubt' ? '将信将疑' : '不信'} · 置信 ${b.confidence} · ${tone.label}` : f.stop ? STOP_LABEL[f.stop] : ''}
                </div>
              </div>
              <Button size="sm" icon="rumor" onClick={() => set({ modal: { kind: 'lineage', family: fam } })} title="看这件事的版本血缘" />
            </div>
            {b && <Meter value={b.confidence} color={tone.color} />}
            {b && (
              <table className="slot-table">
                <thead>
                  <tr>
                    <th>槽位</th>
                    <th>他记住的</th>
                    <th>从哪来</th>
                  </tr>
                </thead>
                <tbody>
                  {slotSummary(b.slots).map((row) => {
                    const vid = b.slotFrom[row.key as keyof typeof b.slotFrom];
                    const v = vid ? s.versions[vid] : undefined;
                    const src = v ? (v.origin.kind === 'relay' ? `${s.agents[v.origin.by]?.name ?? v.origin.by} 转述` : v.origin.kind === 'org' ? '单位通知' : `${v.origin.by === 'gov' ? '政务中心' : v.origin.by}发布`) : '—';
                    return (
                      <tr key={row.key} className={row.value === '—' ? 'missing' : ''}>
                        <td className="muted">{row.label}</td>
                        <td>{row.value === '—' ? <span className="muted">不知道</span> : row.value}</td>
                        <td className="muted">{row.value === '—' ? '' : src}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <SecTitle icon="history">他为什么知道（证据链）</SecTitle>
            <ol className="chain" data-testid="evidence-chain">
              {exposures.length === 0 && <li className="muted">证据链加载中…</li>}
              {exposures.map((e) => {
                const line = describeEvent(e, s, a.id);
                if (!line) return null;
                return (
                  <li key={e.seq}>
                    <span className="num muted">{clock(e.t)}</span>
                    <Icon name={line.icon} color={line.color} />
                    <div>
                      <div>{line.text}</div>
                      {line.sub && <div className="muted">{line.sub}</div>}
                    </div>
                  </li>
                );
              })}
            </ol>
            <SecTitle icon="filter">他在漏斗里走到哪一步</SecTitle>
            <div className="mini-funnel">
              {STAGES.map((st) => (
                <div key={st} className={f[st] !== undefined ? 'on' : ''} title={f[st] !== undefined ? `${STAGE_LABEL[st]} @ ${clock(f[st]!)}` : STAGE_LABEL[st]}>
                  <span>{STAGE_LABEL[st]}</span>
                  <span className="num">{f[st] !== undefined ? clock(f[st]!) : '—'}</span>
                </div>
              ))}
            </div>
            {f.stop && (
              <div className="muted" style={{ marginTop: 6 }}>
                停在：{STOP_LABEL[f.stop]}（{f.stopReason}）
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const MEMORY_TYPES = new Set(['exposure', 'belief_set', 'conversation', 'dm_sent', 'transmission', 'org_notice', 'decision', 'inconvenience', 'plan_set', 'overreaction']);

function Memory({ a, s, timeline }: { a: Agent; s: WorldState; timeline: DomainEvent[] }) {
  const runId = useApp((st) => st.runId);
  const [open, setOpen] = useState<Record<string, Array<{ speaker: string; text: string }> | 'loading'>>({});
  const items = useMemo(
    () =>
      timeline
        .filter((e) => MEMORY_TYPES.has(e.type))
        .filter((e) => !(e.type === 'conversation' && e.topic === 'chat'))
        .filter((e) => !(e.type === 'transmission' && e.tr.from !== a.id))
        .filter((e) => !(e.type === 'decision' && e.phase === 'requested'))
        .reverse(),
    [timeline, a.id],
  );
  const loadDialogue = async (cid: string) => {
    if (!runId) return;
    setOpen((o) => ({ ...o, [cid]: 'loading' }));
    try {
      const d = await api.dialogue(runId, cid);
      setOpen((o) => ({ ...o, [cid]: d.lines }));
    } catch {
      setOpen((o) => ({ ...o, [cid]: [] }));
    }
  };
  if (items.length === 0) return <Empty icon="book">还没有值得记住的经历</Empty>;
  return (
    <ol className="chain memory" data-testid="insp-memory">
      {items.map((e) => {
        const line = describeEvent(e, s, a.id);
        if (!line) return null;
        const conv = e.type === 'conversation' ? e : undefined;
        const lines = conv ? open[conv.id] : undefined;
        return (
          <li key={e.seq}>
            <span className="num muted">
              D{String(dayOf(e.t)).padStart(2, '0')} {clock(e.t)}
            </span>
            <Icon name={line.icon} color={line.color} />
            <div style={{ flex: 1 }}>
              <div>{line.text}</div>
              {line.sub && <div className="muted">{line.sub}</div>}
              {conv && !lines && (
                <button className="linkbtn" onClick={() => loadDialogue(conv.id)} data-testid="load-dialogue">
                  看他们怎么说的
                </button>
              )}
              {lines === 'loading' && <div className="muted blink">台词生成中…</div>}
              {Array.isArray(lines) && (
                <div className="dialogue">
                  {lines.map((l, i) => (
                    <div key={i}>
                      <b>{s.agents[l.speaker]?.name ?? l.speaker}：</b>
                      {l.text}
                    </div>
                  ))}
                  <div className="muted">台词仅供展示，不回写到任何人的记忆。</div>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const REL_LABEL: Record<string, string> = { family: '家人', friend: '朋友', coworker: '同事', neighbor: '邻居' };

function Relations({ a, s, detail }: { a: Agent; s: WorldState; detail?: AgentDetail }) {
  const set = useApp((st) => st.set);
  const fam = useApp((st) => focusFamily(st));
  const told = new Set(a.told[fam] ?? []);
  const heardFrom = new Set((a.beliefs[fam]?.sources ?? []).map((x) => x.from).filter(Boolean) as string[]);
  if (!detail) return <Empty>加载中…</Empty>;
  return (
    <div data-testid="insp-relations">
      {detail.relations.map((r) => {
        const o = s.agents[r.other];
        if (!o) return null;
        return (
          <button key={r.other} className="rel-row" onClick={() => set({ selectedAgent: r.other })}>
            <Avatar look={o.look} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row-title">
                {o.name} <Badge color={r.kind === 'family' ? 'var(--e-pink)' : r.kind === 'friend' ? 'var(--accent)' : r.kind === 'coworker' ? 'var(--info)' : 'var(--fg-3)'}>{r.note && r.note !== '同住' ? r.note : REL_LABEL[r.kind]}</Badge>
              </div>
              <div className="rel-meters">
                <span className="muted">亲近</span>
                <Meter value={r.strength} color="var(--e-pink)" />
                <span className="muted">信任{Math.abs(r.trust - r.baseTrust) >= 0.005 && <b style={{ fontWeight: 'normal', color: r.trust < r.baseTrust ? 'var(--bad)' : 'var(--ok)' }}> {r.trust > r.baseTrust ? '↑' : '↓'}</b>}</span>
                <Meter value={r.trust} color={r.trust < r.baseTrust - 0.005 ? 'var(--bad)' : 'var(--info)'} />
              </div>
            </div>
            <div className="row-tail">
              {heardFrom.has(r.other) && <Badge color="var(--ch-talk)">听他说的</Badge>}
              {told.has(r.other) && <Badge color="var(--ok)">告诉过他</Badge>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Decisions({ detail, cutoff }: { detail?: AgentDetail; cutoff: number }) {
  const set = useApp((st) => st.set);
  if (!detail) return <Empty>加载中…</Empty>;
  const list = detail.decisions.filter((d) => d.t <= cutoff);
  if (list.length === 0) return <Empty icon="dice">还没做过需要权衡的决定</Empty>;
  return (
    <div data-testid="insp-decisions">
      {list
        .slice()
        .reverse()
        .map((d) => (
          <button key={d.id} className="decision-row" onClick={() => set({ modal: { kind: 'decision', id: d.id } })} data-testid={`decision-${d.id}`}>
            <div className="num muted">
              D{String(dayOf(d.t)).padStart(2, '0')} {clock(d.t)}
            </div>
            <div style={{ flex: 1 }}>
              <div className="row-title">{d.chosenLabels.join('；')}</div>
              <div className="muted">{d.kind === 'reaction' ? '怎么应对这条消息' : '要不要告诉别人'}</div>
            </div>
            <Badge color={d.fallback ? 'var(--warn)' : d.provider === 'jev' ? 'var(--e-cyan)' : 'var(--fg-2)'}>{d.fallback ? '规则回退' : d.provider === 'jev' ? 'Jev' : '规则'}</Badge>
            <Icon name="right" />
          </button>
        ))}
    </div>
  );
}

function Timeline({ a, s, timeline }: { a: Agent; s: WorldState; timeline: DomainEvent[] }) {
  const days = new Map<number, DomainEvent[]>();
  for (const e of timeline) {
    const line = describeEvent(e, s, a.id);
    if (!line) continue;
    const d = dayOf(e.t);
    (days.get(d) ?? days.set(d, []).get(d)!).push(e);
  }
  const list = [...days.entries()].reverse();
  if (list.length === 0) return <Empty icon="list">加载中…</Empty>;
  return (
    <div data-testid="insp-timeline">
      {list.map(([d, evs]) => (
        <div key={d}>
          <SecTitle icon="clock">D{String(d).padStart(2, '0')}</SecTitle>
          <ol className="chain">
            {evs
              .slice()
              .reverse()
              .slice(0, 80)
              .map((e) => {
                const line = describeEvent(e, s, a.id)!;
                return (
                  <li key={e.seq}>
                    <span className="num muted">{clock(e.t)}</span>
                    <Icon name={line.icon} color={line.color} />
                    <div>
                      <div>{line.text}</div>
                      {line.sub && <div className="muted">{line.sub}</div>}
                    </div>
                  </li>
                );
              })}
          </ol>
        </div>
      ))}
    </div>
  );
}

export { CH_COLOR, CH_ICON, CHANNEL_LABEL, FRAGMENT_LABEL };
