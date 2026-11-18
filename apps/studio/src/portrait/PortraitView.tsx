import { useMemo, useState } from 'react';
import { BUCKET_LABEL, BUCKETS, dayOf, dayStart, weekday } from '@microcity/society';
import { Avatar } from '../hud/Avatar.tsx';
import { fmtMoney, roleOf } from '../hud/format.ts';
import { runtime } from '../runtime.ts';
import { set, useApp } from '../store.ts';
import { BUCKET_HEX } from '../theme/palette.ts';
import { Button, Segmented } from '../ui/kit.tsx';
import { Bars, HeatGrid, Legend, Lines, Pyramid, Ring, StackBar } from './charts.tsx';
import { calibration, flows, groups, groupStats, headline, heat, householdMix, money, paper, personSeries, pyramid as pyramid_, social, TIE_LABEL as TIE } from './data.ts';
import { CALIBRATION_CAVEATS, TIME_USE_2018 } from './reference.ts';

type Tab = 'community' | 'groups' | 'person' | 'paper' | 'calibration';
const pct = (a: number, b: number): string => `${Math.round((100 * a) / Math.max(1, b))}%`;
const hm = (minutes: number): string => `${Math.floor(minutes / 60)} 小时 ${String(Math.round(minutes % 60)).padStart(2, '0')} 分`;

function Card({ title, lead, children, wide, testId }: { title: string; lead?: string; children: React.ReactNode; wide?: boolean; testId?: string }) {
  return (
    <section className={`pcard surface${wide ? ' wide' : ''}`} data-testid={testId}>
      <h3 className="serif">{title}</h3>
      {lead && <p className="pcard-lead">{lead}</p>}
      {children}
    </section>
  );
}

function Community() {
  const def = runtime.def;
  const aggs = runtime.aggs;
  const h = useMemo(() => headline(def), [def]);
  const m = useMemo(() => money(def, aggs), [def, aggs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = useMemo(() => social(aggs), [aggs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = useMemo(() => flows(aggs), [aggs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const ht = useMemo(() => heat(aggs), [aggs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const mix = useMemo(() => householdMix(def), [def]);
  const aloneAvg = s.alone.length ? s.alone.reduce((a, b) => a + b, 0) / s.alone.length : 0;
  return (
    <div className="pgrid">
      <Card title="这是个什么样的社区？" lead={def.blurb} wide testId="p-headline">
        <div className="bignums">
          {[
            [h.people, '人'],
            [h.households, '户'],
            [h.avgAge.toFixed(0), '岁，平均年龄'],
            [pct(h.elders, h.people), '是 60 岁以上'],
            [pct(h.children, h.people), '是孩子'],
            [pct(h.cityJobs, h.cityJobs + h.localJobs), '的上班族去城里'],
            [pct(h.renters, h.households), '的家庭租房'],
          ].map(([v, label]) => (
            <div key={String(label)}>
              <b className="serif num">{v}</b>
              <span className="dim">{label}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card title="多大年纪的人住在这里？" lead="左边是男，右边是女。">
        <Pyramid bands={pyramid_(def)} />
      </Card>
      <Card title="都是些什么样的家庭？">
        <Bars rows={mix.map((x) => ({ label: x.label, value: x.n }))} format={(v) => `${v} 户`} />
      </Card>
      <Card title="一天里，人都在哪儿？" lead="每一格是一个整点；颜色越深人越多。“在家”一行单独按自己的深浅画。" wide testId="p-heat">
        <HeatGrid rows={ht.rows} max={ht.max} />
      </Card>
      <Card title="钱从哪来，到哪去？" lead="这些天里每天平均的流量，最大的十几条。" wide testId="p-flows">
        <Bars rows={f.map((x) => ({ label: `${x.from} → ${x.to}`, value: x.perDay, note: x.kind }))} format={(v) => `${fmtMoney(v)}/天`} color="var(--amber)" />
      </Card>
      <Card title="手头宽裕吗？" lead={`成年人钱包的中位数 ${fmtMoney(m.walletMedian)}，基尼系数 ${m.gini.toFixed(2)}；家庭账户的中位数 ${fmtMoney(m.householdMedian)}，${m.negative} 户入不敷出。`}>
        <Bars rows={m.hist.map((x) => ({ label: `${x.label} 元`, value: x.n }))} format={(v) => `${v} 人`} color="var(--ok)" />
        <Lines series={[{ label: '家庭账户的中位数', values: m.trend, color: 'var(--ok)' }]} format={(v) => fmtMoney(v)} height={90} />
      </Card>
      <Card title="人和人熟不熟？" lead={`平均每天有 ${aloneAvg.toFixed(0)}% 的人一整天没和谁聊过天。`} testId="p-social">
        <Bars rows={s.ties.map((x) => ({ label: x.label, value: x.n }))} format={(v) => `${v} 对`} color="var(--c-pink)" />
        <Lines
          series={[
            { label: '每天聊天的次数', values: s.chats, color: 'var(--c-pink)' },
            { label: '每天新认识与新朋友', values: s.newTies, color: 'var(--teal)' },
          ]}
          zero
          height={90}
        />
        <Legend
          items={[
            { label: '每天聊天的次数', color: 'var(--c-pink)' },
            { label: '每天新认识与新朋友', color: 'var(--teal)' },
          ]}
        />
      </Card>
    </div>
  );
}

function Groups() {
  const def = runtime.def;
  const aggs = runtime.aggs;
  const rows = useMemo(() => groups(def).map((g) => ({ g, s: groupStats(aggs, g.idx) })), [def, aggs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="pgrid">
      <Card title="各种人的一天是怎么分的？" lead="这些天里平均每天的小时数。" wide testId="p-groups">
        <div className="grouprows">
          {rows.map(({ g, s }) => (
            <div className="grouprow" key={g.key}>
              <span className="grouprow-label">
                <b>{g.label}</b>
                <span className="dim num"> {g.idx.length} 人</span>
              </span>
              <StackBar parts={BUCKETS.map((b, k) => ({ label: BUCKET_LABEL[b], value: s.hours[k]!, color: BUCKET_HEX[b] }))} unit=" 小时" />
            </div>
          ))}
        </div>
        <Legend items={BUCKETS.map((b) => ({ label: BUCKET_LABEL[b], color: BUCKET_HEX[b] }))} />
      </Card>
      <Card title="谁聊得多？">
        <Bars rows={rows.map(({ g, s }) => ({ label: g.label, value: s.chats }))} format={(v) => `${v.toFixed(1)} 次/天`} color="var(--c-pink)" />
      </Card>
      <Card title="谁过得舒心？" lead="心情由吃饱、精力、社交、乐趣四项需求算出，满分 100。">
        <Bars rows={rows.map(({ g, s }) => ({ label: g.label, value: s.mood * 100 }))} format={(v) => v.toFixed(0)} color="var(--ok)" />
      </Card>
      <Card title="谁花得多，谁挣得多？" lead="个人钱包每天的进出；买菜、房租走家庭账户，不在这里。" wide>
        <div className="two">
          <Bars rows={rows.map(({ g, s }) => ({ label: g.label, value: s.spent }))} format={(v) => `花 ${fmtMoney(v)}/天`} color="var(--amber)" />
          <Bars rows={rows.map(({ g, s }) => ({ label: g.label, value: s.earned }))} format={(v) => `进 ${fmtMoney(v)}/天`} color="var(--teal)" />
        </div>
      </Card>
    </div>
  );
}

function Person() {
  const follow = useApp((s) => s.follow);
  const now = useApp((s) => s.now);
  useApp((s) => s.storyRev);
  const def = runtime.def;
  const aggs = runtime.aggs;
  const i = follow ? def.people.findIndex((p) => p.id === follow) : -1;
  const p = i >= 0 ? def.people[i]! : undefined;
  const series = useMemo(() => (i >= 0 ? personSeries(aggs, i) : undefined), [i, aggs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p || !series) {
    return (
      <div className="pgrid">
        <Card title="先选一个人" lead="在世界里点一个人，或者从居民名单里挑一个，这里就是这个人的画像。" wide>
          <Button variant="primary" onClick={() => set({ view: 'world', peopleOpen: true })} testId="p-pick">
            去挑一个人
          </Button>
        </Card>
      </div>
    );
  }
  const d0 = dayStart(dayOf(now));
  const story = runtime.story;
  const hh = def.households.find((h) => h.id === p.household)!;
  const state = runtime.cursor?.state;
  const ties = state
    ? Object.entries(state.ties)
        .filter(([k]) => k.split('|').includes(p.id))
        .map(([k, t]) => ({ other: k.split('|').find((x) => x !== p.id)!, t }))
        .sort((a, b) => b.t.closeness - a.t.closeness)
    : [];
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return (
    <div className="pgrid">
      <Card title={p.name} lead={`${p.bio}${hh.label}。`} wide testId="p-person">
        <div className="person-top">
          <Avatar look={p.look} size={64} />
          <Ring segments={(story?.segments ?? []).map((s) => ({ from: s.t0 - d0, to: s.t1 - d0, color: BUCKET_HEX[s.bucket], label: s.label }))}>
            <b className="serif">第 {dayOf(now)} 天</b>
            <span className="dim">{weekday(dayOf(now))}</span>
          </Ring>
          <div className="grow">
            <div className="dim">这些天平均每天</div>
            <StackBar parts={BUCKETS.map((b, k) => ({ label: BUCKET_LABEL[b], value: series.hours[k]!, color: BUCKET_HEX[b] }))} unit=" 小时" />
            <Legend items={BUCKETS.map((b) => ({ label: BUCKET_LABEL[b], color: BUCKET_HEX[b] }))} />
            <p className="dim">
              {roleOf(p)}。平均每天聊 {avg(series.chats).toFixed(1)} 次天，花 {fmtMoney(avg(series.spent))}。
            </p>
          </div>
        </div>
      </Card>
      <Card title="心情起伏" lead="满分 100。">
        <Lines series={[{ label: '心情', values: series.mood.map((v) => v * 100), color: 'var(--ok)' }]} format={(v) => v.toFixed(0)} />
      </Card>
      <Card title="钱包">
        <Lines series={[{ label: '钱包', values: series.wallet, color: 'var(--amber)' }]} format={(v) => fmtMoney(v)} />
      </Card>
      <Card title="认识谁？" lead={`一共认识 ${ties.length} 个人。`} wide>
        <div className="tiegrid">
          {ties.slice(0, 18).map(({ other, t }) => {
            const o = runtime.people[other]!;
            return (
              <button type="button" key={other} className="person-row" onClick={() => runtime.follow(other)} data-testid={`p-tie-${other}`}>
                <Avatar look={o.look} size={26} />
                <span className="grow">
                  <b>{o.name}</b>
                  <span className="dim"> {TIE[t.kind]}</span>
                </span>
                <span className="mini-meter">
                  <i style={{ width: `${t.closeness * 100}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function Paper() {
  const computed = useApp((s) => s.computed);
  const now = useApp((s) => s.now);
  const [day, setDay] = useState(() => Math.max(1, Math.min(computed, dayOf(now) - 1 || 1)));
  const agg = runtime.aggs[Math.min(day, computed) - 1];
  const items = useMemo(() => (agg ? paper(runtime.def, agg) : []), [agg]);
  return (
    <div className="pgrid">
      <section className="pcard surface wide paper" data-testid="p-paper">
        <div className="paper-head">
          <Button size="sm" variant="ghost" icon="history" disabled={day <= 1} onClick={() => setDay(day - 1)} testId="paper-prev">
            前一天
          </Button>
          <div>
            <h2 className="serif">{runtime.def.name}日报</h2>
            <div className="dim">
              第 {day} 天 · {weekday(day)}
            </div>
          </div>
          <Button size="sm" variant="ghost" icon="right" disabled={day >= computed} onClick={() => setDay(day + 1)} testId="paper-next">
            后一天
          </Button>
        </div>
        <div className="paper-body">
          {items.map((it, i) => (
            <article key={i}>
              <h4 className="serif">{it.title}</h4>
              <p>{it.text}</p>
            </article>
          ))}
        </div>
        <p className="dim small">日报里的每一句都来自当天的统计，没有用模型。</p>
      </section>
    </div>
  );
}

function Calibration() {
  const def = runtime.def;
  const aggs = runtime.aggs;
  const rows = useMemo(() => calibration(def, aggs), [def, aggs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const max = Math.max(...rows.flatMap((r) => [r.model, r.reference]));
  const worst = [...rows].sort((a, b) => Math.abs(b.model - b.reference) - Math.abs(a.model - a.reference))[0]!;
  return (
    <div className="pgrid">
      <Card title="模型里的一天，和调查里的一天，差多少？" lead={`差得最多的是“${worst.category}”：模型 ${hm(worst.model)}，调查 ${hm(worst.reference)}。这里只把差距摆出来，不为了对上而调参数。`} wide testId="p-calibration">
        <div className="cal">
          {rows.map((r) => (
            <div className="cal-row" key={r.category}>
              <span className="cal-label">{r.category}</span>
              <span className="cal-bars">
                <i style={{ width: `${(r.model / max) * 100}%`, background: 'var(--teal)' }} />
                <i style={{ width: `${(r.reference / max) * 100}%`, background: 'var(--ink-3)' }} />
              </span>
              <span className="cal-nums num">
                <span>{hm(r.model)}</span>
                <span className="dim">{hm(r.reference)}</span>
              </span>
              <span className={`cal-diff num ${Math.abs(r.model - r.reference) > 45 ? 'far' : ''}`}>
                {r.model >= r.reference ? '+' : '−'}
                {Math.round(Math.abs(r.model - r.reference))} 分
              </span>
            </div>
          ))}
        </div>
        <Legend
          items={[
            { label: `${def.name}（模型，15 岁以上，已算完的 ${aggs.length} 天）`, color: 'var(--teal)' },
            { label: TIME_USE_2018.source, color: 'var(--ink-3)' },
          ]}
        />
      </Card>
      <Card title="读这张表之前" lead={`参照：${TIME_USE_2018.scope}。`} wide>
        <ul className="caveats">
          {CALIBRATION_CAVEATS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="dim small">
          出处：
          <a href={TIME_USE_2018.url} target="_blank" rel="noreferrer">
            {TIME_USE_2018.source}
          </a>
        </p>
      </Card>
    </div>
  );
}

/** 画像：社区、人群、个人三层，加上日报与校准（M3） */
export function PortraitView() {
  const [tab, setTab] = useState<Tab>('community');
  const computed = useApp((s) => s.computed);
  const target = useApp((s) => s.target);
  return (
    <main className="page" data-testid="portrait">
      <div className="page-head">
        <div>
          <h1 className="serif">{runtime.def.name}的画像</h1>
          <div className="dim">
            根据已经算完的 {computed} 天{computed < target ? `（还在往后算，到第 ${target} 天）` : ''}
          </div>
        </div>
        <Segmented<Tab>
          testId="portrait-tabs"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'community', label: '社区' },
            { value: 'groups', label: '人群' },
            { value: 'person', label: '个人' },
            { value: 'paper', label: '日报' },
            { value: 'calibration', label: '校准' },
          ]}
        />
      </div>
      {computed < 1 ? <div className="dim">还在算第一天…</div> : tab === 'community' ? <Community /> : tab === 'groups' ? <Groups /> : tab === 'person' ? <Person /> : tab === 'paper' ? <Paper /> : <Calibration />}
    </main>
  );
}
