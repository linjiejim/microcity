import { useState } from 'react';
import { closenessAt, dayOf, DEFAULT_PARAMS, householdAccount, ITEMS, needsAt, weekday, type TieState } from '@microcity/society';
import { browserDeps } from '../llm/openrouter.ts';
import { monologue, templateThought, type Monologue, type MonologueFacts } from '../llm/monologue.ts';
import { runtime } from '../runtime.ts';
import { set, useApp } from '../store.ts';
import { NEED_HEX } from '../theme/palette.ts';
import { Badge, Button, Icon, Meter, SecTitle } from '../ui/kit.tsx';
import { Avatar } from './Avatar.tsx';
import { FACTOR_LABEL, feelings, fmtClock, fmtMoney, NEED_LABEL, NEEDS, roleOf, TIE_LABEL, WEATHER_LABEL } from './format.ts';
import type { DecisionRec } from '../timeline/segments.ts';

const signed = (x: number): string => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;

/** 一次选择：选了什么、最主要的两条理由；展开看全部候选 */
function Why({ rec, open }: { rec: DecisionRec; open: boolean }) {
  const chosen = rec.options.find((o) => o.id === rec.chosen)!;
  const top = Object.entries(chosen.f)
    .filter(([, v]) => v > 0.05)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);
  return (
    <div className="why" data-testid="why">
      <div className="why-line">
        <span className="dim">{fmtClock(rec.t)} 选了</span> <b>{chosen.label}</b>
      </div>
      <div className="chips">
        {top.map(([k, v]) => (
          <Badge key={k} color="var(--teal)">
            {FACTOR_LABEL[k] ?? k} {signed(v)}
          </Badge>
        ))}
        <span className="dim">在 {rec.total} 个候选里，选中它的概率 {Math.round(chosen.p * 100)}%</span>
      </div>
      {open && (
        <table className="options" data-testid="options">
          <tbody>
            {rec.options.map((o) => (
              <tr key={o.id} className={o.id === rec.chosen ? 'on' : ''}>
                <td>
                  <div className="opt-label">{o.label}</div>
                  <div className="opt-f dim">
                    {Object.entries(o.f)
                      .filter(([, v]) => Math.abs(v) >= 0.05)
                      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                      .map(([k, v]) => `${FACTOR_LABEL[k] ?? k} ${signed(v)}`)
                      .join(' · ')}
                  </div>
                </td>
                <td className="num opt-p">
                  <div className="opt-bar">
                    <i style={{ width: `${Math.round(o.p * 100)}%` }} />
                  </div>
                  {Math.round(o.p * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** 人物卡：只回答“这个人此刻在做什么、为什么”，其余是这一天的账与人 */
export function PersonCard() {
  const follow = useApp((s) => s.follow);
  const now = useApp((s) => s.now);
  const whyOpen = useApp((s) => s.whyOpen);
  useApp((s) => s.storyRev);
  const [thought, setThought] = useState<{ key: string; m: Monologue } | null>(null);
  const [busy, setBusy] = useState(false);
  const p = follow ? runtime.people[follow] : undefined;
  const state = runtime.cursor?.state;
  const ps = p && state ? state.people[p.id] : undefined;
  if (!p || !ps || !state) return null;

  const story = runtime.story;
  const n = needsAt(ps.needs, now);
  const act = ps.act;
  const moving = ps.loc.k === 'move' ? ps.loc.move : null;
  const doing = moving ? `去${runtime.placeName(moving.to)}的路上${moving.mode === 'ebike' ? '（骑电动车）' : ''}` : act ? act.label : '刚做完一件事';
  const until = moving ? moving.t1 : act ? act.t1 : now;
  const where = moving ? '' : runtime.placeName(ps.loc.k === 'in' ? ps.loc.place : '');
  const lastDecision = story ? [...story.decisions].reverse().find((d) => d.t <= now) : undefined;
  const fixed = act?.commit || moving?.intent?.commit;
  const marks = story ? story.marks.filter((m) => m.t <= now).slice(-5).reverse() : [];
  const hh = runtime.def.households.find((h) => h.id === p.household)!;

  const ties = Object.entries(state.ties)
    .filter(([k]) => k.startsWith(`${p.id}|`) || k.endsWith(`|${p.id}`))
    .map(([k, tie]): { other: string; tie: TieState; c: number } => ({ other: k.split('|').find((x) => x !== p.id)!, tie, c: closenessAt(tie, now, DEFAULT_PARAMS) }))
    .sort((a, b) => b.c - a.c);
  const known = ties.length;
  const metToday = new Set(story?.marks.filter((m) => m.kind === 'chat' && m.t <= now).map((m) => m.text)).size;

  const facts: MonologueFacts = {
    name: p.name,
    age: p.age,
    bio: p.bio,
    when: `${weekday(dayOf(now))} ${fmtClock(now)}，${WEATHER_LABEL[state.weather]}`,
    doing: where && !doing.includes(where) ? `在${where}${doing}` : doing,
    why: fixed
      ? ['这是每天固定的安排']
      : lastDecision
        ? Object.entries(lastDecision.options.find((o) => o.id === lastDecision.chosen)?.f ?? {})
            .filter(([, v]) => v > 0.3)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .map(([k]) => FACTOR_LABEL[k] ?? k)
        : [],
    feelings: feelings(n),
    today: marks.map((m) => m.text).reverse(),
    names: ties.map((x) => runtime.nameOf(x.other)),
  };
  const thoughtKey = `${p.id}:${act?.id ?? moving?.id ?? ''}`;
  const shown = thought && thought.key === thoughtKey ? thought.m : { text: templateThought(facts), source: 'template' as const };

  const ask = async () => {
    setBusy(true);
    const m = await monologue(browserDeps(), facts, runtime.def.people.map((x) => x.name));
    setThought({ key: thoughtKey, m });
    setBusy(false);
  };

  return (
    <aside className="hud card" data-testid="person-card">
      <div className="card-head">
        <Avatar look={p.look} size={44} />
        <div className="grow">
          <div className="card-name serif" data-testid="person-name">
            {p.name}
          </div>
          <div className="dim">
            {p.age} 岁 · {roleOf(p)} · {hh.label}
          </div>
        </div>
        <Button icon="cross" variant="ghost" size="sm" onClick={() => runtime.follow(null)} testId="unfollow" title="不跟了（Esc）" />
      </div>

      <div className="card-body">
        <section>
          <div className="doing serif" data-testid="doing">
            {doing}
          </div>
          <div className="dim">
            {where && `${where} · `}到 {fmtClock(until)}
          </div>
          <blockquote className="thought serif" data-testid="thought">
            {shown.text}
          </blockquote>
          <div className="thought-foot dim">
            {shown.source === 'template' ? '按事实拼出的想法' : shown.source === 'cache' ? '语言模型（本机缓存）' : '语言模型'}
            <Button icon="sparkle" size="sm" variant="ghost" disabled={busy} onClick={() => void ask()} testId="monologue" title="用语言模型把事实改写成一句内心独白（需要密钥）">
              {busy ? '在想…' : '用模型说'}
            </Button>
          </div>
          {shown.note && <div className="note">{shown.note}</div>}
        </section>

        <section>
          <SecTitle
            icon="question"
            extra={
              lastDecision && !fixed ? (
                <Button size="sm" variant="ghost" onClick={() => set({ whyOpen: !whyOpen })} testId="why-toggle">
                  {whyOpen ? '收起' : '看全部候选'}
                </Button>
              ) : undefined
            }
          >
            为什么
          </SecTitle>
          {fixed ? <div className="dim">这是固定的安排：到点就去，不用选。</div> : lastDecision ? <Why rec={lastDecision} open={whyOpen} /> : <div className="dim">今天还没做过选择。</div>}
        </section>

        <section>
          <SecTitle icon="activity">此刻的状态</SecTitle>
          <div className="needs">
            {NEEDS.map((k, i) => (
              <div key={k} className="need" data-testid={`need-${k}`}>
                <span>{NEED_LABEL[k]}</span>
                <Meter value={n[i]!} color={NEED_HEX[k]} />
                <span className="num dim">{Math.round(n[i]! * 100)}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <SecTitle icon="coin">钱</SecTitle>
          <div className="kv">
            <span>钱包</span>
            <b className="num" data-testid="wallet">
              {fmtMoney(state.accounts[p.id] ?? 0)}
            </b>
            <span>家里</span>
            <b className="num">{fmtMoney(state.accounts[householdAccount(hh.id)] ?? 0)}</b>
            <span>今天花了</span>
            <b className="num">{fmtMoney(ps.today.spent)}</b>
            <span>今天收到</span>
            <b className="num">{fmtMoney(ps.today.earned)}</b>
          </div>
        </section>

        <section>
          <SecTitle icon="talk">今天</SecTitle>
          {marks.length === 0 ? (
            <div className="dim">还没有值得记的事。</div>
          ) : (
            <ul className="marks" data-testid="marks">
              {marks.map((m, i) => (
                <li key={i}>
                  <span className="num dim">{fmtClock(m.t)}</span>
                  {m.text}
                </li>
              ))}
            </ul>
          )}
          <div className="dim">
            认识 {known} 个人，今天聊过 {metToday} 次。
          </div>
        </section>

        <section>
          <SecTitle icon="link">最亲近的人</SecTitle>
          <ul className="ties">
            {ties.slice(0, 5).map(({ other, tie, c }) => (
              <li key={other}>
                <button type="button" className="linkish" onClick={() => runtime.follow(other)} data-testid={`tie-${other}`}>
                  {runtime.nameOf(other)}
                </button>
                <span className="dim">{TIE_LABEL[tie.kind]}</span>
                <Meter value={c} color="var(--c-pink)" />
              </li>
            ))}
          </ul>
        </section>

        <section>
          <SecTitle icon="tag">兴趣与物品</SecTitle>
          <div className="chips">
            {[...p.belongings, ...hh.belongings].map((id) => (
              <Badge key={id} outline>
                {ITEMS[id]?.label ?? id}
              </Badge>
            ))}
          </div>
          <div className="dim bio">
            <Icon name="person" size={12} /> {p.bio}
          </div>
        </section>
      </div>
    </aside>
  );
}
