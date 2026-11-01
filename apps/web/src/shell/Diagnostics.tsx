import { useEffect, useState } from 'react';
import { api, type Metrics } from '../lib/api.ts';
import { useApp } from '../store.ts';
import { Button, Icon, Modal, SecTitle } from '../ui/kit.tsx';

/** 诊断：模型调用、花费、重放校验（开发与验收用，不占主界面） */
export function Diagnostics() {
  const runId = useApp((s) => s.runId);
  const health = useApp((s) => s.health);
  const run = useApp((s) => s.run);
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);
  const [m, setM] = useState<Metrics['health']>();
  const [replay, setReplay] = useState<{ ok: boolean; events: number; rebuilt: string } | 'loading'>();
  useEffect(() => {
    if (!runId) return;
    api
      .metrics(runId)
      .then((x) => setM(x.health))
      .catch(() => {});
    api
      .health()
      .then((h) => set({ health: h }))
      .catch(() => {});
  }, [runId]);
  const check = async () => {
    if (!runId) return;
    setReplay('loading');
    try {
      const r = await api.replayCheck(runId);
      setReplay(r);
      toast(r.ok ? `重放校验通过：${r.events} 条事件重建出同一哈希` : '重放校验失败', r.ok ? 'ok' : 'bad');
    } catch (e) {
      setReplay(undefined);
      toast((e as Error).message, 'bad');
    }
  };
  return (
    <Modal title="诊断" icon="dice" width={640} onClose={() => set({ modal: null })} testId="diagnostics">
      <SecTitle icon="bulb">模型</SecTitle>
      <dl className="kv">
        <dt>访问</dt>
        <dd>{health?.models.access ? '已配置 OpenRouter' : '离线（只用规则与模板）'}</dd>
        <dt>居民语义因子</dt>
        <dd className="num">{health?.models.jev}</dd>
        <dt>建镇 / 报告 / 台词</dt>
        <dd className="num">{health?.models.generative}</dd>
        <dt>累计花费</dt>
        <dd className="num">
          ${health?.budget.spentUsd.toFixed(4)} / 上限 ${health?.budget.globalCapUsd}（每次运行上限 ${health?.budget.runCapUsd}）
        </dd>
      </dl>
      <SecTitle icon="dice">这次运行</SecTitle>
      <dl className="kv" data-testid="health">
        <dt>运行</dt>
        <dd>{run?.name}</dd>
        <dt>决策</dt>
        <dd>
          {m ? `${m.decisions.total} 次（${Object.entries(m.decisions.byProvider).map(([k, v]) => `${k === 'jev' ? 'Jev' : '规则'} ${v}`).join(' / ') || '—'}）` : '…'}
          {m && m.decisions.fallbacks > 0 && <span style={{ color: 'var(--warn)' }}> · 回退 {m.decisions.fallbacks}</span>}
        </dd>
        <dt>模型调用</dt>
        <dd>{m ? `${m.calls.calls} 次 · 缓存命中 ${m.calls.cached} · 错误 ${m.calls.errors} · ${m.calls.avgLatency}ms · $${m.calls.cost.toFixed(4)}` : '…'}</dd>
        <dt>正在思考</dt>
        <dd>{m ? `${m.pending} 人` : '…'}</dd>
      </dl>
      <SecTitle icon="refresh">确定性</SecTitle>
      <p className="muted" style={{ marginTop: 0 }}>
        从初始状态把全部事件重放一遍，看是否得到与服务端当前状态完全相同的哈希（同时核对每个快照点）。
      </p>
      <div className="wrap-row">
        <Button icon="refresh" onClick={check} disabled={replay === 'loading'} testId="replay-check">
          重放校验
        </Button>
        {replay && replay !== 'loading' && (
          <span style={{ color: replay.ok ? 'var(--ok)' : 'var(--bad)' }} data-testid="replay-result">
            <Icon name={replay.ok ? 'check' : 'cross'} /> {replay.ok ? `一致（${replay.events} 条事件 → ${replay.rebuilt}）` : '不一致'}
          </span>
        )}
        {replay === 'loading' && <span className="muted blink">重建中…</span>}
      </div>
    </Modal>
  );
}
