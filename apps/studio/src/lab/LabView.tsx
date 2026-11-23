import { useEffect, useMemo, useRef, useState } from 'react';
import { compare, describeIntervention, specFor, EXPERIMENT_LIMITS, generateCommunity, INDICATOR_LIST, INDICATORS, PRESETS, RUMORS, TEMPLATE_LABEL, validateExperiment, type Affected, type CommunityDef, type CommunitySpec, type DayAgg, type Experiment, type ExperimentResult, type Intervention, type InterventionKind, type Prediction } from '@microcity/society';
import { Avatar } from '../hud/Avatar.tsx';
import { roleOf } from '../hud/format.ts';
import { runtime } from '../runtime.ts';
import { experimentLink } from '../share.ts';
import { Badge, Button, Segmented } from '../ui/kit.tsx';
import { lab } from './client.ts';
import { Micro } from './Micro.tsx';
import { CASES } from './presets.ts';

const KIND_OPTIONS: Array<{ kind: InterventionKind; label: string; make: (def: CommunityDef) => Intervention }> = [
  { kind: 'close', label: '停业', make: (def) => ({ kind: 'close', place: def.map.places.some((p) => p.kind === 'market') ? 'market' : 'grocery', from: 4 }) },
  { kind: 'price', label: '调价', make: (def) => ({ kind: 'price', place: def.map.places.some((p) => p.kind === 'market') ? 'market' : 'grocery', item: 'food', factor: 1.3, from: 4 }) },
  { kind: 'grant', label: '发钱', make: () => ({ kind: 'grant', amount: 500, day: 4 }) },
  { kind: 'layoff', label: '裁员', make: (def) => ({ kind: 'layoff', place: def.map.places.some((p) => p.kind === 'workshop') ? 'workshop' : 'office', fraction: 0.5, day: 4 }) },
  { kind: 'rent', label: '房租', make: () => ({ kind: 'rent', factor: 1.3, from: 1 }) },
  { kind: 'canteen', label: '开伙', make: (def) => ({ kind: 'canteen', place: def.map.places.some((p) => p.kind === 'center') ? 'center' : 'school', price: 9, from: 4 }) },
  { kind: 'weather', label: '天气', make: () => ({ kind: 'weather', weather: 'rain', from: 4, to: 10 }) },
  { kind: 'rumor', label: '传言', make: () => ({ kind: 'rumor', topic: 'price_up', seeds: 6, day: 4 }) },
];

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const fmt = (key: string, v: number): string => `${v.toFixed(INDICATORS[key]!.digits)}${INDICATORS[key]!.unit ? ` ${INDICATORS[key]!.unit}` : ''}`;
const VERDICT_COLOR = { 支持: 'var(--ok)', 相反: 'var(--bad)', 不明确: 'var(--warn)', 没有差别: 'var(--ink-3)' } as const;

/** 一条干预的可调参数（地点、数值、哪天） */
function IvEditor({ iv, def, onChange, onRemove, index }: { iv: Intervention; def: CommunityDef; onChange: (iv: Intervention) => void; onRemove: () => void; index: number }) {
  const firms = def.firms.map((f) => def.map.places.find((p) => p.id === f.place)!);
  const num = (label: string, value: number, apply: (v: number) => Intervention, step = 1, testId?: string) => (
    <label className="iv-field">
      <span className="dim">{label}</span>
      <input className="input num" type="number" step={step} value={value} onChange={(e) => onChange(apply(Number(e.target.value) || 0))} data-testid={testId} />
    </label>
  );
  const place = (value: string, apply: (v: string) => Intervention) => (
    <label className="iv-field wide">
      <span className="dim">哪里</span>
      <select className="input" value={def.map.places.find((p) => p.id === value || p.kind === value)?.id ?? ''} onChange={(e) => onChange(apply(e.target.value))}>
        {firms.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="iv" data-testid={`iv-${index}`}>
      <div className="iv-title">
        <b>{describeIntervention(iv, (ref) => def.map.places.find((p) => p.id === ref || p.kind === ref)?.name ?? String(ref))}</b>
        <Button size="sm" variant="ghost" icon="cross" onClick={onRemove} title="去掉这一条" testId={`iv-remove-${index}`} />
      </div>
      <div className="iv-fields">
        {iv.kind === 'close' && place(iv.place, (v) => ({ ...iv, place: v }))}
        {iv.kind === 'price' && place(iv.place, (v) => ({ ...iv, place: v }))}
        {iv.kind === 'price' && num('价格变成原来的几倍', iv.factor, (v) => ({ ...iv, factor: Math.max(0.1, v) }), 0.1)}
        {iv.kind === 'grant' && num('每户多少元', iv.amount, (v) => ({ ...iv, amount: Math.max(1, v) }), 100, 'iv-amount')}
        {iv.kind === 'layoff' && place(iv.place, (v) => ({ ...iv, place: v }))}
        {iv.kind === 'layoff' && num('裁掉的比例', iv.fraction, (v) => ({ ...iv, fraction: Math.min(1, Math.max(0, v)) }), 0.1)}
        {iv.kind === 'rent' && num('房租变成原来的几倍', iv.factor, (v) => ({ ...iv, factor: Math.max(0.1, v) }), 0.1)}
        {iv.kind === 'canteen' && place(iv.place, (v) => ({ ...iv, place: v }))}
        {iv.kind === 'canteen' && num('一顿多少元', iv.price, (v) => ({ ...iv, price: Math.max(1, v) }))}
        {iv.kind === 'weather' && (
          <label className="iv-field">
            <span className="dim">什么天气</span>
            <select className="input" value={iv.weather} onChange={(e) => onChange({ ...iv, weather: e.target.value as 'sun' | 'cloud' | 'rain' })}>
              <option value="rain">雨</option>
              <option value="cloud">阴</option>
              <option value="sun">晴</option>
            </select>
          </label>
        )}
        {iv.kind === 'rumor' && (
          <label className="iv-field wide">
            <span className="dim">传的是什么</span>
            <select className="input" value={iv.topic} onChange={(e) => onChange({ ...iv, topic: e.target.value })}>
              {Object.values(RUMORS).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {iv.kind === 'rumor' && num('从几个人开始', iv.seeds, (v) => ({ ...iv, seeds: Math.max(1, Math.round(v)) }))}
        {'day' in iv ? num('第几天', iv.day, (v) => ({ ...iv, day: Math.max(1, Math.round(v)) })) : num('从第几天起', iv.from, (v) => ({ ...iv, from: Math.max(1, Math.round(v)) }))}
        {'from' in iv && iv.kind !== 'weather' && num('到第几天（0 = 一直）', iv.to ?? 0, (v) => ({ ...iv, ...(v > 0 ? { to: Math.round(v) } : { to: undefined }) }) as Intervention)}
        {iv.kind === 'weather' && num('到第几天', iv.to, (v) => ({ ...iv, to: Math.max(iv.from, Math.round(v)) }))}
      </div>
    </div>
  );
}

/** 一个指标在各个种子上的两条线：基线是空心点，干预是实心点 */
function Pairs({ base, treat }: { base: number[]; treat: number[] }) {
  const all = [...base, ...treat];
  const lo = Math.min(...all);
  const hi = Math.max(...all, lo + 1e-9);
  const x = (v: number) => 6 + ((v - lo) / (hi - lo)) * 108;
  return (
    <svg className="pairs" viewBox={`0 0 120 ${base.length * 7 + 4}`} role="img" aria-label="逐种子配对">
      {base.map((a, i) => (
        <g key={i}>
          <line x1={x(a)} x2={x(treat[i]!)} y1={i * 7 + 5} y2={i * 7 + 5} stroke={treat[i]! >= a ? 'var(--teal)' : 'var(--amber)'} strokeWidth="1.4" />
          <circle cx={x(a)} cy={i * 7 + 5} r="2" fill="var(--surface)" stroke="var(--ink-2)" strokeWidth="1" />
          <circle cx={x(treat[i]!)} cy={i * 7 + 5} r="2.2" fill={treat[i]! >= a ? 'var(--teal)' : 'var(--amber)'} />
        </g>
      ))}
    </svg>
  );
}

interface Run {
  x: Experiment;
  def: CommunityDef;
  result: ExperimentResult;
  base: DayAgg[][];
  treat: DayAgg[][];
}

/** 实验台（M4）：选一件事放进社区，先猜，再看基线与干预两条世界线差在哪 */
export function LabView({ initial }: { initial?: Experiment }) {
  const [x, setX] = useState<Experiment>(() => initial ?? CASES[0]!.experiment);
  const [caseId, setCaseId] = useState<string | null>(initial ? null : CASES[0]!.id);
  const [guess, setGuess] = useState<Record<string, 'higher' | 'lower'>>({});
  const [progress, setProgress] = useState<number | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState<Affected | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const token = useRef(0);
  const def = useMemo(() => generateCommunity(x.spec), [x.spec]);
  const story = CASES.find((c) => c.id === caseId)?.story;
  const problems = validateExperiment(x);

  useEffect(() => () => void (token.current = -1), []);

  const edit = (patch: Partial<Experiment>) => {
    setX({ ...x, ...patch });
    setRun(null);
    setWho(null);
  };
  const pick = (id: string) => {
    const c = CASES.find((k) => k.id === id)!;
    setCaseId(id);
    setX(c.experiment);
    setGuess({});
    setRun(null);
    setWho(null);
  };
  const start = async () => {
    const mine = ++token.current;
    setError(null);
    setRun(null);
    setWho(null);
    setProgress(0);
    try {
      const { base, treat } = await lab.run(x, (done, total) => mine === token.current && setProgress(done / total));
      if (mine !== token.current) return;
      const defs = x.seeds.map((_, i) => (i === 0 ? def : generateCommunity(specFor(x, i))));
      setRun({ x, def, base, treat, result: compare(defs, x, base, treat) });
    } catch (e) {
      if (mine === token.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mine === token.current) setProgress(null);
    }
  };
  const guessed = x.predictions.every((p) => guess[p.id]);
  const changed = run
    ? run.result.metrics
        .map((m) => {
          const diffs = m.treat.map((b, i) => b - m.base[i]!);
          const up = diffs.filter((d) => d > 0).length;
          const down = diffs.filter((d) => d < 0).length;
          return { m, a: mean(m.base), b: mean(m.treat), same: Math.max(up, down) / diffs.length, rel: Math.abs(mean(m.treat) - mean(m.base)) / Math.max(1e-9, Math.abs(mean(m.base))) };
        })
        .filter((r) => r.a !== r.b)
        .sort((p, q) => q.same - p.same || q.rel - p.rel)
    : [];

  return (
    <main className="page lab" data-testid="lab">
      <div className="page-head">
        <div>
          <h1 className="serif">实验台</h1>
          <div className="dim">往社区里放一件事。同一个种子跑两遍：一遍没有这件事，一遍有。差出来的，就是它的影响。</div>
        </div>
      </div>
      <div className="lab-grid">
        <aside className="cases" data-testid="cases">
          <div className="dim small">影响案例</div>
          {CASES.map((c) => (
            <button type="button" key={c.id} className={`case${caseId === c.id ? ' on' : ''}`} onClick={() => pick(c.id)} data-testid={`case-${c.id}`}>
              <b className="serif">{c.title}</b>
              <span className="dim">{TEMPLATE_LABEL[c.experiment.spec.template]}</span>
            </button>
          ))}
          <button type="button" className={`case${caseId === null ? ' on' : ''}`} onClick={() => (setCaseId(null), setRun(null))} data-testid="case-custom">
            <b className="serif">自己搭一个</b>
            <span className="dim">从左边任何一个案例改起</span>
          </button>
        </aside>

        <div className="lab-main">
          <section className="pcard surface wide" data-testid="lab-setup">
            {story && <p className="pcard-lead serif">{story}</p>}
            <h3 className="serif">{x.question || x.name}</h3>
            <div className="setup-row">
              <label className="iv-field wide">
                <span className="dim">社区</span>
                <select className="input" value={x.spec.template} onChange={(e) => edit({ spec: PRESETS[e.target.value as CommunitySpec['template']] })} data-testid="lab-community">
                  {(Object.keys(PRESETS) as CommunitySpec['template'][]).map((t) => (
                    <option key={t} value={t}>
                      {PRESETS[t].name}（{TEMPLATE_LABEL[t]}）
                    </option>
                  ))}
                </select>
              </label>
              <label className="iv-field">
                <span className="dim">看几天</span>
                <input className="input num" type="number" min={EXPERIMENT_LIMITS.days[0]} max={EXPERIMENT_LIMITS.days[1]} value={x.days} onChange={(e) => edit({ days: Math.round(Number(e.target.value) || 0) })} data-testid="lab-days" />
              </label>
              <label className="iv-field check-field">
                <span className="dim">每个种子换一批人</span>
                <input type="checkbox" checked={!!x.resample} onChange={(e) => edit({ resample: e.target.checked })} data-testid="lab-resample" />
              </label>
              <label className="iv-field">
                <span className="dim">几个种子</span>
                <input className="input num" type="number" min={1} max={EXPERIMENT_LIMITS.seeds[1]} value={x.seeds.length} onChange={(e) => edit({ seeds: Array.from({ length: Math.max(1, Math.min(EXPERIMENT_LIMITS.seeds[1], Math.round(Number(e.target.value) || 1))) }, (_, i) => i + 1) })} data-testid="lab-seeds" />
              </label>
            </div>

            <div className="sec-label">放进去的事</div>
            {x.interventions.map((iv, i) => (
              <IvEditor key={i} index={i} iv={iv} def={def} onChange={(next) => edit({ interventions: x.interventions.map((o, k) => (k === i ? next : o)) })} onRemove={() => edit({ interventions: x.interventions.filter((_, k) => k !== i) })} />
            ))}
            <div className="chips">
              <span className="dim">再加一件：</span>
              {KIND_OPTIONS.map((k) => (
                <Button key={k.kind} size="sm" onClick={() => (setCaseId(null), edit({ interventions: [...x.interventions, k.make(def)] }))} testId={`iv-add-${k.kind}`}>
                  {k.label}
                </Button>
              ))}
            </div>

            <div className="sec-label">先猜：有了这件事之后……</div>
            {x.predictions.map((p, i) => (
              <div className="guess" key={p.id} data-testid={`guess-${p.id}`}>
                <select className="input" value={p.metric} onChange={(e) => edit({ predictions: x.predictions.map((o, k) => (k === i ? { ...o, metric: e.target.value, text: INDICATORS[e.target.value]!.label } : o)) })}>
                  {INDICATOR_LIST.map((ind) => (
                    <option key={ind.key} value={ind.key}>
                      {ind.group} · {ind.label}
                    </option>
                  ))}
                </select>
                <Segmented<'higher' | 'lower' | ''>
                  testId={`guess-pick-${p.id}`}
                  value={guess[p.id] ?? ''}
                  onChange={(v) => v && setGuess({ ...guess, [p.id]: v })}
                  options={[
                    { value: 'higher', label: '会更高' },
                    { value: 'lower', label: '会更低' },
                  ]}
                />
                <Button size="sm" variant="ghost" icon="cross" onClick={() => edit({ predictions: x.predictions.filter((_, k) => k !== i) })} title="不看这一项" />
              </div>
            ))}
            <Button
              size="sm"
              icon="plus"
              onClick={() => {
                const used = new Set(x.predictions.map((p) => p.metric));
                const ind = INDICATOR_LIST.find((k) => !used.has(k.key)) ?? INDICATOR_LIST[0]!;
                const next: Prediction = { id: `P${Date.now() % 100000}`, text: ind.label, metric: ind.key, expect: 'higher' };
                edit({ predictions: [...x.predictions, next] });
              }}
              testId="guess-add"
            >
              再猜一项
            </Button>

            {problems.length > 0 && <div className="note">{problems.join('；')}</div>}
            {error && <div className="note">{error}</div>}
            <div className="row run-row">
              <Button variant="primary" icon="play" disabled={problems.length > 0 || progress !== null} onClick={() => void start()} testId="lab-run">
                {progress !== null ? `正在跑 ${Math.round(progress * 100)}%` : guessed ? '跑一下，看猜得对不对' : '不猜了，直接跑'}
              </Button>
              <span className="dim small">
                {x.seeds.length} 个种子 × 2 条世界线 × {x.days} 天，在这台电脑上算。
              </span>
              <span className="grow" />
              <Button
                size="sm"
                variant="ghost"
                icon="link"
                testId="lab-share"
                onClick={() => {
                  void navigator.clipboard?.writeText(experimentLink(location.origin + location.pathname, x));
                  setCopied(true);
                }}
              >
                {copied ? '链接已复制' : '复制这个实验的链接'}
              </Button>
            </div>
            {progress !== null && (
              <div className="progress">
                <i style={{ width: `${progress * 100}%` }} />
              </div>
            )}
          </section>

          {run && (
            <>
              <section className="pcard surface wide" data-testid="lab-result">
                <h3 className="serif">结果：{run.x.name}</h3>
                <p className="pcard-lead">
                  {run.def.name}，{run.x.seeds.length} 个种子{run.x.resample ? '（每个种子换一批人）' : '（同一批人，只换过法）'}，指标取第 {run.result.from} 天之后。空心点是没有这件事，实心点是有。
                </p>
                <div className="verdicts">
                  {run.result.predictions.map((p) => {
                    const m = run.result.metrics.find((k) => k.key === p.metric)!;
                    const a = mean(m.base);
                    const b = mean(m.treat);
                    const actual = b > a ? 'higher' : b < a ? 'lower' : null;
                    const g = guess[p.id];
                    return (
                      <div className="verdict" key={p.id} data-testid={`verdict-${p.id}`}>
                        <div className="grow">
                          <b>{INDICATORS[p.metric]!.label}</b>
                          <div className="num">
                            {fmt(p.metric, a)} → {fmt(p.metric, b)}
                          </div>
                          <div className="dim small">
                            {actual === null ? '两条线一样' : `${Math.round((actual === 'higher' ? m.treat.filter((v, i) => v > m.base[i]!).length : m.treat.filter((v, i) => v < m.base[i]!).length))} / ${m.base.length} 个种子里${actual === 'higher' ? '更高' : '更低'}`}
                          </div>
                        </div>
                        <Pairs base={m.base} treat={m.treat} />
                        <div className="verdict-side">
                          {g ? <Badge color={actual === g ? 'var(--ok)' : 'var(--bad)'}>{actual === g ? '你猜对了' : actual === null ? '没有差别' : '你猜错了'}</Badge> : <span className="dim small">没有猜</span>}
                          <span className="dim small">
                            预先写的假设“{p.expect === 'higher' ? '更高' : '更低'}”：<b style={{ color: VERDICT_COLOR[p.verdict] }}>{p.verdict}</b>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)} testId="lab-all">
                  {showAll ? '收起' : `看所有变了的指标（${changed.length} 项）`}
                </Button>
                {showAll && (
                  <table className="allmetrics" data-testid="lab-allmetrics">
                    <tbody>
                      {changed.map((r) => (
                        <tr key={r.m.key}>
                          <td className="dim">{INDICATORS[r.m.key]!.group}</td>
                          <td>{INDICATORS[r.m.key]!.label}</td>
                          <td className="num">
                            {fmt(r.m.key, r.a)} → {fmt(r.m.key, r.b)}
                          </td>
                          <td className="num dim">{Math.round(r.same * r.m.base.length)} / {r.m.base.length} 同向</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="pcard surface wide" data-testid="lab-affected">
                <h3 className="serif">谁的日子变得最不一样？</h3>
                <p className="pcard-lead">按第一个种子（{run.def.name}原本的那一批人）里两条世界线的差排的：时间怎么花、花了多少钱、聊了几次天、心情。点一个人，看这个人最不一样的那一天。</p>
                <div className="tiegrid">
                  {run.result.affected
                    .filter((a) => a.score > 0)
                    .map((a) => {
                      const p = run.def.people[a.index]!;
                      return (
                        <button type="button" key={p.id} className={`person-row${who?.index === a.index ? ' on' : ''}`} onClick={() => setWho(a)} data-testid={`affected-${a.index}`}>
                          <Avatar look={p.look} size={28} />
                          <span className="grow">
                            <b>{p.name}</b>
                            <span className="dim">
                              {' '}
                              {p.age} 岁 · {roleOf(p)}
                            </span>
                            <span className="doing-line dim">差得最多的是第 {a.day} 天</span>
                          </span>
                        </button>
                      );
                    })}
                </div>
                {run.result.affected.every((a) => a.score === 0) && <div className="dim">两条世界线里，每个人的每一天都一模一样。</div>}
              </section>
              {who && <Micro def={run.def} x={run.x} who={who} base={run.base[0]!} treat={run.treat[0]!} onClose={() => setWho(null)} />}
            </>
          )}
          {!run && progress === null && runtime.config.interventions.length > 0 && <p className="dim small">现在“世界”里打开的是一条有干预的世界线。</p>}
        </div>
      </div>
    </main>
  );
}
