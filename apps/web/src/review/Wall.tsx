import { useMemo, useState } from 'react';
import { CARD_STAGE_TEXT, formatTime, personCard, type CardStage, type PersonCard } from '@microcity/sim';
import { focusFamily, useApp } from '../store.ts';
import { Avatar, Badge, Check, Empty, Icon, Segmented } from '../ui/kit.tsx';
import { MOOD_COLOR, STAGE_COLOR } from '../observe/PersonPanel.tsx';
import { useReviewTimes, useStateAt } from './data.ts';

const STAGE_ORDER: CardStage[] = ['unaware', 'glimpsed', 'disbelieve', 'doubt', 'believe', 'changed', 'acted'];
const WIN_TEXT: Record<string, string> = { exact: '精确时段', coarse: '只知大概', all_day: '以为“全天”', unknown: '时间不详' };
const WIN_COLOR: Record<string, string> = { exact: 'var(--w-exact)', coarse: 'var(--w-coarse)', all_day: 'var(--w-allday)', unknown: 'var(--w-unknown)' };

/** 与基准相比变了什么（给人看的一行行） */
export function cardDiff(a: PersonCard | undefined, b: PersonCard): string[] {
  if (!a) return [];
  const out: string[] = [];
  if (a.stage !== b.stage) out.push(`${CARD_STAGE_TEXT[a.stage]} → ${CARD_STAGE_TEXT[b.stage]}`);
  if (a.window !== b.window && b.window) out.push(`时段：${a.window ? WIN_TEXT[a.window] : '不知道'} → ${WIN_TEXT[b.window]}`);
  for (const c of b.changes) if (!a.changes.includes(c)) out.push(`改了：${c}`);
  if (b.told > a.told) out.push(`告诉了 ${b.told - a.told} 个人`);
  if (!a.surprised && b.surprised) out.push('被停电打了个措手不及');
  if (b.overreactMin > a.overreactMin) out.push(`过度调整 ${b.overreactMin - a.overreactMin} 分钟`);
  if (Math.abs(b.trustGov - a.trustGov) >= 0.005) out.push(`对官方信任 ${a.trustGov.toFixed(2)} → ${b.trustGov.toFixed(2)}`);
  for (const x of b.trustShifts) {
    const y = a.trustShifts.find((z) => z.id === x.id);
    if (!y || Math.abs(y.to - x.to) >= 0.005) out.push(`对${x.name}的信任 ${(y?.to ?? x.from).toFixed(2)} → ${x.to.toFixed(2)}`);
  }
  for (const m of b.memory) if (!a.memory.some((x) => x.outage === m.outage)) out.push(`记下了：${m.text}`);
  return out;
}

type Group = 'none' | 'district' | 'household' | 'stage';

export function Wall() {
  const { t, base } = useReviewTimes();
  const { state: sT, loading } = useStateAt(t);
  const { state: sB } = useStateAt(base);
  const map = useApp((s) => s.map);
  const fam = useApp((s) => focusFamily(s));
  const scenario = useApp((s) => s.scenario);
  const set = useApp((s) => s.set);
  const [group, setGroup] = useState<Group>('district');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const outage = scenario?.outages.find((o) => o.family === fam);
  const cards = useMemo(() => (sT && map ? Object.keys(sT.agents).map((id) => personCard(sT, map, id, fam, t, outage)) : []), [sT, map, fam, t, outage]);
  const before = useMemo(() => (sB && map && base !== null ? Object.fromEntries(Object.keys(sB.agents).map((id) => [id, personCard(sB, map, id, fam, base, outage)])) : {}), [sB, map, fam, base, outage]);
  if (!sT || !map) return <Empty>{loading ? '取回那一刻的状态…' : '载入中…'}</Empty>;
  const diffs = Object.fromEntries(cards.map((c) => [c.id, cardDiff(before[c.id], c)]));
  const shown = onlyChanged ? cards.filter((c) => diffs[c.id]!.length > 0) : cards;
  const count = (xs: PersonCard[], st: CardStage) => xs.filter((c) => c.stage === st).length;
  const baseCards = Object.values(before);
  const groups = groupCards(shown, group, sT);
  return (
    <div className="wall" data-testid="wall">
      <div className="wall-bar">
        <div className="stage-sum" data-testid="stage-summary">
          {STAGE_ORDER.map((st) => {
            const n = count(cards, st);
            const d = baseCards.length ? n - count(baseCards, st) : 0;
            return (
              <span key={st} className="stage-pill" style={{ ['--c' as string]: STAGE_COLOR[st] }} title={CARD_STAGE_TEXT[st]}>
                <i />
                {CARD_STAGE_TEXT[st]} <b className="num">{n}</b>
                {d !== 0 && <em className="num">{d > 0 ? `+${d}` : d}</em>}
              </span>
            );
          })}
        </div>
        <span className="grow" />
        <Check checked={onlyChanged} onChange={setOnlyChanged} testId="only-changed">
          只看有变化的（{cards.filter((c) => diffs[c.id]!.length > 0).length}）
        </Check>
        <Segmented
          value={group}
          onChange={setGroup}
          testId="wall-group"
          options={[
            { value: 'district', label: '按区' },
            { value: 'household', label: '按户' },
            { value: 'stage', label: '按阶段' },
            { value: 'none', label: '不分组' },
          ]}
        />
      </div>
      <div className="muted wall-note">
        {base !== null ? `高亮的卡片：与基准（${formatTime(base)}）相比有变化。` : '未设对比基准。'}每张卡的“想法”由此人此刻的状态模板生成；点卡片看这个人的轨迹。
      </div>
      {shown.length === 0 && <Empty icon="check">与基准相比没有人发生变化。</Empty>}
      {groups.map((g) => (
        <section key={g.key} className="wall-group">
          {group !== 'none' && (
            <div className="sec-title">
              <Icon name={group === 'district' ? 'place' : group === 'household' ? 'home' : 'filter'} />
              <span>{g.label}</span>
              <span className="muted">{g.cards.length} 人</span>
            </div>
          )}
          <div className="wall-grid">
            {g.cards.map((c) => (
              <WallCard key={c.id} c={c} diff={diffs[c.id]!} onOpen={() => set({ trajectory: c.id })} look={sT.agents[c.id]!.look} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function groupCards(cards: PersonCard[], g: Group, s: { households: Record<string, { label: string }> }): Array<{ key: string; label: string; cards: PersonCard[] }> {
  if (g === 'none') return [{ key: 'all', label: '', cards }];
  const m = new Map<string, { key: string; label: string; cards: PersonCard[] }>();
  const keyOf = (c: PersonCard): [string, string] => (g === 'district' ? [c.district, c.district === 'north' ? '北区' : '南区'] : g === 'household' ? [c.household, s.households[c.household]?.label ?? c.household] : [c.stage, CARD_STAGE_TEXT[c.stage]]);
  for (const c of cards) {
    const [k, label] = keyOf(c);
    if (!m.has(k)) m.set(k, { key: k, label, cards: [] });
    m.get(k)!.cards.push(c);
  }
  const out = [...m.values()];
  if (g === 'stage') out.sort((a, b) => STAGE_ORDER.indexOf(a.key as CardStage) - STAGE_ORDER.indexOf(b.key as CardStage));
  if (g === 'district') out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

function WallCard({ c, diff, onOpen, look }: { c: PersonCard; diff: string[]; onOpen: () => void; look: import('@microcity/sim').Look }) {
  const changed = diff.length > 0;
  const govD = Math.round((c.trustGov - c.trustGov0) * 100) / 100;
  return (
    <button className={`wall-card ${changed ? 'changed' : ''}`} onClick={onOpen} style={{ ['--stage' as string]: STAGE_COLOR[c.stage], ['--mood' as string]: MOOD_COLOR[c.thought.mood] }} data-testid={`card-${c.id}`}>
      <div className="wc-head">
        <Avatar look={look} />
        <div className="wc-name">
          <div className="row-title">{c.name}</div>
          <div className="muted ellipsis">
            {c.age} · {c.role}
          </div>
        </div>
      </div>
      <div className="wc-chips">
        <span className="stage-chip">{CARD_STAGE_TEXT[c.stage]}</span>
        {c.window && (
          <span className="win-chip" style={{ ['--c' as string]: WIN_COLOR[c.window] }}>
            {WIN_TEXT[c.window]}
          </span>
        )}
      </div>
      <div className="wc-thought">“{c.thought.text}”</div>
      <div className="wc-badges">
        {wallBadges(c, govD)
          .slice(0, 2)
          .map((x) => (
            <Badge key={x.text} color={x.color}>
              {x.text}
            </Badge>
          ))}
      </div>
      {changed && (
        <ul className="wc-diff">
          {diff.slice(0, 3).map((d, i) => (
            <li key={i}>{d}</li>
          ))}
          {diff.length > 3 && <li className="muted">还有 {diff.length - 3} 处…</li>}
        </ul>
      )}
    </button>
  );
}

/** 卡片上的标记：按重要性排序，只显示前两个（v4：减少徽章） */
function wallBadges(c: PersonCard, govD: number): Array<{ text: string; color: string }> {
  const out: Array<{ text: string; color: string }> = [];
  if (c.surprised) out.push({ text: '措手不及', color: 'var(--bad)' });
  if (c.memory.some((m) => m.kind.startsWith('surprised'))) out.push({ text: '被坑过', color: 'var(--bad)' });
  if (c.memory.some((m) => m.kind.startsWith('false_alarm'))) out.push({ text: '虚惊过', color: 'var(--warn)' });
  if (c.changes.length > 0) out.push({ text: '改了安排', color: 'var(--info)' });
  if (govD !== 0) out.push({ text: `信官方 ${govD > 0 ? '↑' : '↓'}`, color: govD > 0 ? 'var(--ok)' : 'var(--bad)' });
  if (c.overreactMin > 0) out.push({ text: `过度 ${c.overreactMin} 分`, color: 'var(--rumor)' });
  if (c.told > 0) out.push({ text: `转告 ${c.told}`, color: 'var(--ch-talk)' });
  if (c.trustShifts.some((x) => x.to < x.from)) out.push({ text: '对人信任↓', color: 'var(--warn)' });
  return out;
}
