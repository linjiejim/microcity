import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_BRANCHES, describeBranch, formatTime, type BranchSpec } from '@microcity/sim';
import { api, type Experiment, type Paired, type Stat } from '../lib/api.ts';
import { openRun, useApp } from '../store.ts';
import { Badge, Button, Empty, Icon, Meter, SecTitle, Segmented } from '../ui/kit.tsx';
import { CH_COLOR, CHANNEL_LABEL, dur } from '../lib/format.ts';

const METRICS: Array<{ key: string; label: string; better: 'low' | 'high' | null; unit: 'sec' | 'person' | 'min' | 'count' | 'trust' | 'pp'; hint?: string; more?: boolean }> = [
  { key: 't50', label: '半数人相信用时', better: 'low', unit: 'sec' },
  { key: 't80', label: '八成人相信用时', better: 'low', unit: 'sec' },
  { key: 'aware', label: '停电时已知情', better: 'high', unit: 'person' },
  { key: 'exact', label: '停电时知道精确时段', better: 'high', unit: 'person' },
  { key: 'allDay', label: '停电时信“全天”', better: 'low', unit: 'person', hint: '被转述变形带偏的人数' },
  { key: 'intended', label: '改了安排', better: null, unit: 'person' },
  { key: 'surprisedPeople', label: '措手不及', better: 'low', unit: 'person', hint: '不知情就撞上停电' },
  { key: 'overreactMin', label: '过度调整', better: 'low', unit: 'min', hint: '真实停电窗口之外被挪走的安排' },
  { key: 'versions', label: '主张版本数', better: null, unit: 'count' },
  { key: 'allDayEver', label: '信过“全天”', better: 'low', unit: 'person', hint: '任何时候信过“停一整天”的人', more: true },
  { key: 'disbelieved', label: '听到但不信', better: null, unit: 'person', more: true },
  { key: 'verified', label: '上网查证过', better: null, unit: 'person', more: true },
  { key: 'intendedOutside', label: '停电区外改了安排', better: 'low', unit: 'person', hint: '家和单位都不在停电区', more: true },
  { key: 'distortedEver', label: '信过走样版本', better: 'low', unit: 'person', hint: '停电前信过不准确的时段，或丢了地点', more: true },
  { key: 'gapT50', label: '老人比青年晚多久过半', better: 'low', unit: 'sec', hint: '60 岁以上 vs 18–29 岁；没过半按 7 天算', more: true },
  { key: 'gapAware', label: '青年比老人多知情', better: 'low', unit: 'pp', hint: '停电那一刻，两组知情比例之差', more: true },
];

/** 指标键的中文说法（预测用） */
function metricLabel(key: string): string {
  const [a, b, c] = key.split('.');
  if (a === 'trust') return TRUST.find((m) => m.key === b)?.label ?? key;
  if (a === 'trustAt') return `${b} 开始时对官方的信任`;
  const m = METRICS.find((x) => x.key === b);
  return `${a} ${m?.label ?? b}${c ? `.${c}` : ''}`;
}
function metricUnit(key: string): string {
  const k = key.split('.')[1] ?? '';
  return METRICS.find((m) => m.key === k)?.unit ?? (key.startsWith('trust') ? 'trust' : 'count');
}
const VERDICT_COLOR: Record<string, string> = { 支持: 'var(--ok)', 部分支持: 'var(--warn)', 不支持: 'var(--bad)', 无法判定: 'var(--fg-3)' };
const TRUST: Array<{ key: string; label: string; better: 'low' | 'high' | null; unit: 'trust' | 'count' }> = [
  { key: 'govDelta', label: '对官方信任的变化', better: 'high', unit: 'trust' },
  { key: 'tiesDown', label: '信任下降的关系', better: 'low', unit: 'count' },
];

const fmt = (unit: string, v: number | null): string => {
  if (v === null) return '未达到';
  switch (unit) {
    case 'pp':
      return `${Math.round(v * 10) / 10} 个百分点`;
    case 'sec':
      return v < 0 ? `−${dur(-v)}` : dur(v);
    case 'person':
      return `${Math.round(v * 10) / 10} 人`;
    case 'min':
      return `${Math.round(v)} 分钟`;
    case 'trust':
      return `${v > 0 ? '+' : ''}${v.toFixed(3)}`;
    default:
      return String(Math.round(v * 10) / 10);
  }
};

export function Compare() {
  const scenario = useApp((s) => s.scenario);
  const expId = useApp((s) => s.experimentId);
  const set = useApp((s) => s.set);
  const [list, setList] = useState<Array<Omit<Experiment, 'result' | 'error'> & { scenarioName: string }>>([]);
  const [creating, setCreating] = useState(false);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    api
      .experiments()
      .then((xs) => {
        setList(xs);
        // 没选过就打开这座镇最近的一个实验
        const mine = xs.find((x) => !scenario || x.manifest.scenario === scenario.id);
        if (!useApp.getState().experimentId && mine) set({ experimentId: mine.id });
      })
      .catch(() => {});
  }, [scenario, expId, bump]);
  const mine = list.filter((x) => !scenario || x.manifest.scenario === scenario.id);
  const others = list.filter((x) => scenario && x.manifest.scenario !== scenario.id);
  const option = (x: (typeof list)[number]) => (
    <option key={x.id} value={x.id}>
      {x.manifest.name} · {x.manifest.seeds.length} 个 seed · {x.manifest.provider === 'jev' ? 'Jev' : '规则'} · {x.status === 'done' ? new Date(x.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : x.status === 'failed' ? '失败' : '运行中'}
    </option>
  );
  if (creating || (!expId && mine.length === 0)) return <NewExperiment onCancel={list.length ? () => setCreating(false) : undefined} onStarted={(id) => (setCreating(false), set({ experimentId: id }))} />;
  return (
    <div className="compare-wrap">
      <div className="exp-pick">
        <select className="field-input" value={expId ?? ''} onChange={(e) => set({ experimentId: e.target.value || undefined })} data-testid="exp-select">
          <option value="">选一个对照实验…</option>
          {mine.length > 0 && <optgroup label={`这座镇（${scenario?.name ?? ''}）`}>{mine.map(option)}</optgroup>}
          {[...new Set(others.map((x) => x.scenarioName))].map((name) => (
            <optgroup key={name} label={`其他镇：${name}`}>
              {others.filter((x) => x.scenarioName === name).map(option)}
            </optgroup>
          ))}
        </select>
        <Button icon="plus" onClick={() => setCreating(true)} testId="exp-new">
          新建对照实验
        </Button>
      </div>
      {expId ? <ExperimentView id={expId} onDone={() => setBump((x) => x + 1)} /> : <Empty icon="compare">选一个实验，或新建一个。</Empty>}
    </div>
  );
}

function NewExperiment({ onCancel, onStarted }: { onCancel?: () => void; onStarted: (id: string) => void }) {
  const health = useApp((s) => s.health);
  const scenario = useApp((s) => s.scenario);
  const run = useApp((s) => s.run);
  const toast = useApp((s) => s.toast);
  const set = useApp((s) => s.set);
  const [pick, setPick] = useState<Record<string, boolean>>({ A: true, B: true, C: true, D: true });
  const [seeds, setSeeds] = useState(5);
  const [provider, setProvider] = useState<'rule' | 'jev'>('rule');
  const [busy, setBusy] = useState(false);
  const first = scenario?.events[0];
  const start = async () => {
    const branches: Record<string, BranchSpec> = {};
    for (const [k, b] of Object.entries(DEFAULT_BRANCHES)) if (pick[k]) branches[k] = b;
    if (Object.keys(branches).length < 2) return toast('至少选两个分支', 'bad');
    setBusy(true);
    try {
      const r = await api.startExperiment({ scenario: scenario?.id ?? 'town30', seed: run?.seed ?? 42, seedCount: seeds, provider, branches });
      onStarted(r.id);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="new-exp" data-testid="experiment-new">
      <SecTitle icon="fork">新建对照实验：同一座镇、同一分叉点，只改第一轮通知的发布方式</SecTitle>
      <p className="dim" style={{ marginTop: 0 }}>
        从第一条通知发布前分叉出几个平行世界：居民、库存、真实停电完全一样，只改渠道与是否澄清。每个随机种子跑一遍全部分支，结论看分布而不是一次运气。
        {first && <span className="muted">（第一轮：{scenario?.eventText[0]}）</span>}
      </p>
      <div className="branch-cards">
        {Object.entries(DEFAULT_BRANCHES).map(([k, b]) => {
          const p = b.patches?.[0];
          return (
            <button key={k} className={`branch-card well ${pick[k] ? 'on' : ''}`} onClick={() => setPick({ ...pick, [k]: !pick[k] })} data-testid={`branch-${k}`}>
              <div className="t-2x" style={{ color: pick[k] ? 'var(--accent)' : 'var(--fg-3)' }}>
                {k}
              </div>
              <div>{b.label}</div>
              <div className="wrap-row" style={{ marginTop: 6 }}>
                {(p?.channels ?? []).map((c) => (
                  <Badge key={c} color={CH_COLOR[c]}>
                    {CHANNEL_LABEL[c]}
                  </Badge>
                ))}
                {p?.clarify && <Badge color="var(--rumor)">当天 16:00 澄清</Badge>}
              </div>
              <span className="muted">
                <Icon name={pick[k] ? 'check' : 'minus'} color={pick[k] ? 'var(--ok)' : 'var(--fg-3)'} /> {pick[k] ? '参与对照' : '不参与'}
              </span>
            </button>
          );
        })}
      </div>
      <div className="exp-form">
        <div className="field">
          <label>随机种子个数</label>
          <Segmented
            testId="exp-seeds"
            value={seeds}
            onChange={setSeeds}
            options={[
              { value: 1, label: '1' },
              { value: 5, label: '5' },
              { value: 10, label: '10' },
              { value: 20, label: '20' },
            ]}
          />
        </div>
        <div className="field">
          <label>决策方式</label>
          <Segmented
            testId="exp-provider"
            value={provider}
            onChange={setProvider}
            options={[
              { value: 'rule', label: '规则（秒出结果）' },
              { value: 'jev', label: health?.models.jevAllowed ? `Jev（约 $${(seeds * 0.006).toFixed(2)}）` : health?.public ? 'Jev（演示站未开放）' : 'Jev（未配置）' },
            ]}
          />
        </div>
        <span className="grow" />
        <Button
          icon="list"
          onClick={() =>
            set({
              modal: {
                kind: 'manifest',
                scenario: scenario?.id ?? 'town30',
                title: '用实验清单新建（JSON）',
                manifest: {
                  name: '我的实验',
                  question: '加推送能不能让人更早知道？',
                  seeds: [1, 2, 3, 4, 5],
                  provider: 'rule',
                  branches: { A: DEFAULT_BRANCHES.A!, C: DEFAULT_BRANCHES.C! },
                  predictions: [{ id: 'P1', text: '加推送后，半数人更早相信', metric: `${first?.id ?? 'E1'}.t50`, a: 'C', b: 'A', expect: 'lower' }],
                },
              },
            })
          }
          testId="exp-json"
        >
          用实验清单（JSON）
        </Button>
        {onCancel && <Button onClick={onCancel}>取消</Button>}
        <Button variant="primary" icon="fork" onClick={start} disabled={busy || (provider === 'jev' && !health?.models.jevAllowed)} testId="exp-start">
          {busy ? '启动中…' : '开始实验'}
        </Button>
      </div>
    </div>
  );
}

function ExperimentView({ id, onDone }: { id: string; onDone: () => void }) {
  const set = useApp((s) => s.set);
  const [x, setX] = useState<Experiment>();
  const [outage, setOutage] = useState<string>();
  const [more, setMore] = useState(false);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const e = await api.experiment(id);
        if (!alive) return;
        setX(e);
        if (e.status === 'running') setTimeout(poll, 600);
        else onDone();
      } catch {
        /* 轮询失败就停 */
      }
    };
    void poll();
    return () => {
      alive = false;
    };
  }, [id]);
  if (!x) return <Empty>加载中…</Empty>;
  if (x.status === 'failed') return <Empty icon="warn">实验失败：{x.error}</Empty>;
  if (x.status === 'running' || !x.result) {
    const p = x.live?.progress ?? {};
    return (
      <div data-testid="exp-progress">
        <p className="dim">
          第 {(x.live?.seedIndex ?? 0) + 1}/{x.live?.seeds ?? x.manifest.seeds.length} 个随机种子：先跑到分叉点（{x.manifest.forkAt}），再逐个分支跑到 {x.manifest.until}。
        </p>
        {['base', ...Object.keys(x.manifest.branches)].map((k) => (
          <div key={k} className="prog-row">
            <span style={{ width: 170 }}>{k === 'base' ? '基线（分叉前）' : `${k} ${x.manifest.branches[k]!.label}`}</span>
            <Meter value={p[k] ?? 0} tall color={k === 'base' ? 'var(--fg-2)' : 'var(--accent)'} />
            <span className="num" style={{ width: 44, textAlign: 'right' }}>
              {Math.round((p[k] ?? 0) * 100)}%
            </span>
          </div>
        ))}
      </div>
    );
  }
  const r = x.result;
  const names = Object.keys(r.branches);
  const oid = outage ?? r.outages[0]?.id ?? 'E1';
  const multi = r.seeds.length > 1;
  const fresh = names.filter((k) => r.branches[k]!.scenario && r.branches[k]!.scenario !== x.manifest.scenario);
  const global = x.manifest.params ? describeBranch({ label: '', params: x.manifest.params }) : [];
  const hasMore = names.some((k) => r.stats[k]?.[`${oid}.allDayEver`]);
  return (
    <div data-testid="compare">
      <header className="exp-hero">
        <div className="exp-kicker">
          对照实验 · {r.seeds.length} 个随机种子 · {x.manifest.provider === 'jev' ? 'Jev' : '规则'}心智 · 参照分支 {r.reference}
        </div>
        <h2 className="exp-q serif">{x.manifest.question || x.manifest.name}</h2>
        <div className="exp-actions">
          <Button size="sm" icon="fork" onClick={() => set({ modal: { kind: 'manifest', scenario: x.manifest.scenario, title: `复制为新实验：${x.manifest.name}`, manifest: x.manifest } })} testId="exp-copy">
            复制为新实验
          </Button>
          <Button size="sm" icon="book" onClick={() => set({ reviewTab: 'report' })} testId="exp-report">
            实验报告
          </Button>
        </div>
      {x.manifest.predictions?.length ? (
        <div className="predictions" data-testid="predictions">
          <div className="pred-note muted">事先写下的预测，跑完逐 seed 配对自动判定：方向在 70% 以上的配对里成立为“支持”</div>
          {x.manifest.predictions.map((p) => {
            const v = r.predictions?.find((q) => q.id === p.id);
            const share = v ? (p.expect === 'lower' ? v.lower : v.higher) : 0;
            return (
              <div key={p.id} className="pred-row" data-testid={`prediction-${p.id}`}>
                <Badge color={VERDICT_COLOR[v?.verdict ?? '无法判定']}>{v?.verdict ?? '待判定'}</Badge>
                <span>{p.text}</span>
                <span className="muted">
                  {metricLabel(p.metric)}：{p.a} {p.expect === 'higher' ? '高于' : p.expect === 'lower' ? '低于' : '约等于'} {p.b}
                  {v && v.n > 0 && ` · ${p.expect === 'same' ? `中位差 ${fmt(metricUnit(p.metric), v.median)}` : `${Math.round(share * v.n)}/${v.n} 个 seed 方向一致 · 中位差 ${fmt(metricUnit(p.metric), v.median)}`}`}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      </header>
      <div className="wrap-row">
        {r.outages.length > 1 && (
          <Segmented value={oid} onChange={setOutage} options={r.outages.map((o) => ({ value: o.id, label: `${o.id} · ${o.area === 'north' ? '北区' : '南区'} D${String(o.day).padStart(2, '0')}` }))} testId="exp-outage" />
        )}
        <span className="grow" />
        {hasMore && (
          <Button size="sm" on={more} onClick={() => setMore(!more)} testId="exp-more">
            更多指标
          </Button>
        )}
      </div>
      <div className="table-wrap">
        <table className="dtable compare">
          <thead>
            <tr>
              <th>指标{multi ? '（中位数与每个 seed）' : ''}</th>
              {names.map((k) => (
                <th key={k}>
                  <div className="t-2x" style={{ color: 'var(--accent)' }}>
                    {k}
                  </div>
                  <div>{r.branches[k]!.label}</div>
                  {(r.branches[k]!.changes ?? []).map((c) => (
                    <div key={c} className="muted">
                      {c}
                    </div>
                  ))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...METRICS.filter((m) => more || !m.more).map((m) => ({ ...m, full: `${oid}.${m.key}` })), ...TRUST.map((m) => ({ ...m, full: `trust.${m.key}`, hint: undefined }))].map((m) => {
              const stats = names.map((k) => r.stats[k]?.[m.full]);
              const meds = stats.map((s) => (s?.median ?? null));
              const nums = meds.map((v) => (v === null ? (m.better === 'low' ? Infinity : -Infinity) : v));
              const best = m.better === 'low' ? Math.min(...nums) : m.better === 'high' ? Math.max(...nums) : NaN;
              const worst = m.better === 'low' ? Math.max(...nums) : m.better === 'high' ? Math.min(...nums) : NaN;
              const all = stats.flatMap((s) => (s?.values ?? []).filter((v): v is number => v !== null));
              const lo = Math.min(...all, 0);
              const hi = Math.max(...all, 1);
              return (
                <tr key={m.full}>
                  <td title={m.hint}>
                    {m.label}
                    {m.hint && <div className="muted">{m.hint}</div>}
                  </td>
                  {names.map((k, i) => {
                    const s = stats[i];
                    const p = r.paired[k]?.[m.full];
                    const cls = m.better && best !== worst ? (nums[i] === best ? 'best' : nums[i] === worst ? 'worst' : '') : '';
                    return (
                      <td key={k} className={`num ${cls}`} data-testid={`cmp-${k}-${m.key}`}>
                        {fmt(m.unit, s?.median ?? null)}
                        {multi && s && (
                          <>
                            {s.p25 !== null && s.p75 !== null && <div className="muted">四分位 {fmt(m.unit, s.p25)}–{fmt(m.unit, s.p75)}</div>}
                            {s.missing > 0 && <div className="muted">{s.missing} 个 seed 未达到</div>}
                            <Dots s={s} lo={lo} hi={hi} />
                          </>
                        )}
                        {multi && p && m.better && <PairBadge p={p} n={r.seeds.length} refName={r.reference} />}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr>
              <td>第一个 seed 的运行</td>
              {names.map((k) => (
                <td key={k}>
                  {r.branches[k]!.runId && (
                    <Button
                      size="sm"
                      icon="eye"
                      onClick={() => {
                        void openRun(r.branches[k]!.runId);
                        set({ workspace: 'observe' });
                      }}
                      testId={`open-branch-${k}`}
                    >
                      在城市中打开
                    </Button>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="fork-note">
        <Icon name="fork" color="var(--accent)" /> 分叉点 {formatTime(r.forkT)} · 分叉前状态哈希一致：<span className="num">{r.forkHash}</span> · {r.seeds.length} 个随机种子（{r.seeds.join('、')}）· {x.manifest.provider === 'jev' ? 'Jev' : '规则'}决策 · 参照分支 {r.reference}
        {fresh.length > 0 && <> · 换镇分支 {fresh.join('、')} 从头跑</>}
        {global.length > 0 && <> · 参数覆盖 {global.join('；')}</>}
      </div>
      <p className="muted">
        {multi ? `每格：中位数、四分位与 ${r.seeds.length} 个 seed 的点；徽章是与参照分支 ${r.reference} 逐 seed 配对比较（更好/更差）。` : '只有 1 个随机种子：差异可能是偶然，建议多跑几个 seed。'}
        差异是“这个模型下的差异”，不是现实政策效应。
      </p>
    </div>
  );
}

function PairBadge({ p, n, refName }: { p: Paired; n: number; refName: string }) {
  const tone = p.better > p.worse ? 'var(--ok)' : p.worse > p.better ? 'var(--bad)' : 'var(--fg-3)';
  return (
    <div className="pair" style={{ color: tone }} title={`与 ${refName} 逐 seed 比较：${p.better} 个更好、${p.worse} 个更差、${p.same} 个持平`}>
      vs {refName}：{p.better}↑ {p.worse}↓ / {n}
    </div>
  );
}

function Dots({ s, lo, hi }: { s: Stat; lo: number; hi: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const vals = useMemo(() => s.values, [s]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const W = 120;
    const H = 14;
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#cfc7ba';
    g.fillRect(0, H / 2, W, 1);
    const X = (v: number) => Math.round(2 + ((v - lo) / Math.max(1e-9, hi - lo)) * (W - 5));
    const seen = new Map<number, number>();
    for (const v of vals) {
      if (v === null) continue;
      const x = X(v);
      const k = seen.get(x) ?? 0;
      seen.set(x, k + 1);
      g.fillStyle = '#a8a298';
      g.fillRect(x, H / 2 - 1 - (k % 3) * 3 + 2, 3, 3);
    }
    if (s.median !== null) {
      g.fillStyle = '#e3a13a';
      g.fillRect(X(s.median), 0, 2, H);
    }
  }, [vals, lo, hi, s.median]);
  return <canvas ref={ref} className="dots" width={120} height={14} />;
}
