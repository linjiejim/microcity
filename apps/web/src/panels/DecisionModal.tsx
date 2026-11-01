import { useEffect, useState } from 'react';
import { clock, dayOf, type DecisionRecord } from '@microcity/sim';
import { api, type ModelCallView } from '../lib/api.ts';
import { useApp, viewState } from '../store.ts';
import { Avatar, Badge, Empty, Icon, Modal, SecTitle } from '../ui/kit.tsx';

const FACTOR_LABEL: Record<string, string> = {
  avoid: '避开损失',
  cost_time: '时间成本',
  cost_money: '花钱',
  habit: '习惯延续',
  fit: '人格契合',
  concern: '担心程度',
  verify_need: '想先查证',
  tie: '关系亲近',
  contact_relevance: '对方相关',
  altruism: '利他',
  would_message: '会主动说',
};
const SEG_COLORS = ['#e3a13a', '#4b7ead', '#3e8e63', '#a45a8a', '#d9776a', '#2f8a91', '#d9b48a', '#8f897e', '#c2553a', '#6f9f76', '#efd98a', '#8a6a9a'];

function srcBadge(src: string) {
  if (src.startsWith('model:')) return <Badge color="var(--e-cyan)" title={src}>Jev</Badge>;
  if (src.startsWith('fallback:')) return <Badge color="var(--warn)" title={src}>回退</Badge>;
  return <Badge color="var(--fg-3)" title={src}>规则</Badge>;
}

export function DecisionModal({ id }: { id: string }) {
  const runId = useApp((s) => s.runId);
  const s = useApp((st) => viewState(st));
  const set = useApp((st) => st.set);
  const [data, setData] = useState<{ record: DecisionRecord; calls: ModelCallView[] }>();
  const [err, setErr] = useState('');
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!runId) return;
    api
      .decision(runId, id)
      .then(setData)
      .catch((e) => setErr((e as Error).message));
  }, [runId, id]);

  const close = () => set({ modal: null });
  if (err) return <Modal title="决策详情" icon="dice" onClose={close}>{<Empty icon="warn">{err}</Empty>}</Modal>;
  if (!data) return <Modal title="决策详情" icon="dice" onClose={close}>{<Empty>加载中…</Empty>}</Modal>;
  const r = data.record;
  const a = s?.agents[r.agent];
  const isReaction = r.kind === 'reaction';
  const cands = r.candidates.filter((c) => (isReaction ? true : c.kind === 'dm'));
  const factorKeys = [...new Set(cands.flatMap((c) => Object.keys(r.factors[c.id] ?? {})))];
  // 抽样条：按候选顺序累积概率
  let acc = 0;
  const segs = r.candidates.map((c, i) => {
    const p = r.probabilities[c.id] ?? 0;
    const seg = { id: c.id, label: c.label, from: acc, to: acc + p, color: SEG_COLORS[i % SEG_COLORS.length]! };
    acc += p;
    return seg;
  });

  return (
    <Modal title="决策详情" icon="dice" width={980} onClose={close} testId="decision-modal">
      <div className="dm-head">
        {a && <Avatar look={a.look} size={48} />}
        <div style={{ flex: 1 }}>
          <div className="t-2x" style={{ color: 'var(--fg-0)' }}>
            {r.agentName}：{isReaction ? '怎么应对这条消息' : '要不要主动告诉别人'}
          </div>
          <div className="muted">
            D{String(dayOf(r.t)).padStart(2, '0')} {clock(r.t)} 开始考虑 → {clock(r.commitAt)} 定下来 · 触发：{r.trigger.reason} · 策略 {r.policyVersion}
          </div>
        </div>
        <Badge color={r.fallback ? 'var(--warn)' : r.provider === 'jev' ? 'var(--e-cyan)' : 'var(--fg-2)'} icon="bulb">
          {r.fallback ? `规则回退（${r.fallback}）` : r.provider === 'jev' ? r.model : '规则因子'}
        </Badge>
        <Badge color={r.commit.outcome === 'applied' ? 'var(--ok)' : 'var(--warn)'}>{r.commit.outcome === 'applied' ? '已执行' : r.commit.outcome === 'invalidated' ? '执行时已不合法' : '回退'}</Badge>
      </div>

      <div className="dm-grid">
        <div>
          <SecTitle icon="eye">他当时看到的（只含主观信息）</SecTitle>
          <div className="read">“{r.observation.belief.summary}”</div>
          <div className="muted">
            置信 {r.observation.belief.confidence} · 听自 {r.observation.belief.heardFrom.join('、') || '—'}
          </div>
          <div className="muted">
            {r.observation.now} · {r.observation.location} · {r.observation.activity}
          </div>
          {r.observation.atRisk.length > 0 && (
            <>
              <SecTitle icon="warn">他以为会受影响的安排</SecTitle>
              <ul className="plain">
                {r.observation.atRisk.map((x, i) => (
                  <li key={i}>
                    {x.time} {x.item}（{x.place}，重叠 {x.overlapMin} 分钟）
                  </li>
                ))}
              </ul>
            </>
          )}
          {r.observation.contacts && r.observation.contacts.length > 0 && (
            <>
              <SecTitle icon="link">不在身边的亲友</SecTitle>
              <ul className="plain">
                {r.observation.contacts.map((c) => (
                  <li key={c.id}>
                    {c.name}（{c.relation}）{c.livesOrWorksInArea ? ' · 住/工作在受影响区域' : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div>
          <SecTitle icon="dice">随机抽样（计数器式，按键取数）</SecTitle>
          {isReaction ? (
            <>
              <div className="sample-bar" data-testid="sample-bar">
                {segs.map((g) => (
                  <i key={g.id} style={{ left: `${g.from * 100}%`, width: `${(g.to - g.from) * 100}%`, background: g.color }} title={`${g.label} ${Math.round((g.to - g.from) * 100)}%`} />
                ))}
                <b style={{ left: `calc(${r.rng.value * 100}% - 1px)` }} />
              </div>
              <div className="muted">
                u = {r.rng.value} 落在“{r.candidates.find((c) => c.id === r.chosen[0])?.label}”区间 · 键 {r.rng.key}
              </div>
            </>
          ) : (
            <div className="muted">每位联系人独立抽样：u &lt; P 则发私信（键 {r.rng.key}）</div>
          )}
          <SecTitle icon="bulb">解释性摘要</SecTitle>
          <div className="read">{r.summary}</div>
          <div className="muted">摘要由模板从审计记录生成，不是模型的内部思考。</div>
        </div>
      </div>

      <SecTitle icon="compare">合法候选与打分</SecTitle>
      <div className="table-wrap">
        <table className="dtable" data-testid="candidates-table">
          <thead>
            <tr>
              <th>候选</th>
              {factorKeys.map((k) => (
                <th key={k}>{FACTOR_LABEL[k] ?? k}</th>
              ))}
              <th>效用 U</th>
              <th style={{ width: 150 }}>概率 P</th>
            </tr>
          </thead>
          <tbody>
            {cands.map((c) => {
              const chosen = r.chosen.includes(c.id);
              const p = r.probabilities[c.id] ?? 0;
              return (
                <tr key={c.id} className={chosen ? 'chosen' : ''}>
                  <td>
                    {chosen && <Icon name="check" color="var(--ok)" />} {c.label}
                  </td>
                  {factorKeys.map((k) => {
                    const f = r.factors[c.id]?.[k];
                    return (
                      <td key={k} className="num">
                        {f ? (
                          <span className="fcell">
                            {f.value}
                            {(k === 'fit' || k === 'concern' || k === 'verify_need' || k === 'would_message') && srcBadge(f.source)}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="num">{r.utilities[c.id] ?? '—'}</td>
                  <td>
                    <div className="pbar">
                      <i style={{ width: `${p * 100}%` }} />
                      <span className="num">{Math.round(p * 100)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {r.rejected.length > 0 && (
        <>
          <SecTitle icon="cross">被规则排除的选项</SecTitle>
          <ul className="plain muted">
            {r.rejected.map((x, i) => (
              <li key={i}>
                <s>{x.label}</s> —— {x.reason}
              </li>
            ))}
          </ul>
        </>
      )}
      <SecTitle icon="refresh">执行</SecTitle>
      <div>
        {clock(r.commit.at)} 提交：{r.commit.outcome === 'applied' ? '按选择执行' : `未能执行（${r.commit.reason ?? ''}），改为照常`}
      </div>
      {data.calls.length > 0 && (
        <>
          <SecTitle icon="web" extra={<button className="linkbtn" onClick={() => setShowRaw(!showRaw)}>{showRaw ? '收起原始请求' : '看原始请求/响应'}</button>}>
            模型调用
          </SecTitle>
          {data.calls.map((c) => (
            <div key={c.id} className="call">
              <div>
                <Badge color="var(--e-cyan)">{c.model}</Badge> <span className="muted">{c.cached ? '缓存命中（跨分支同观察同答案）' : `${c.latencyMs}ms`} · ${c.costUsd.toFixed(6)}</span>
                {c.error && <span style={{ color: 'var(--bad)' }}> · {c.error}</span>}
              </div>
              {showRaw && (
                <div className="raw">
                  <div className="muted">请求 state + questions</div>
                  <pre>{JSON.stringify(c.request, null, 2)}</pre>
                  <div className="muted">响应</div>
                  <pre>{JSON.stringify(c.response, null, 2)}</pre>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </Modal>
  );
}
