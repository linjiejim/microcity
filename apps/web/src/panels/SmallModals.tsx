import { useEffect, useMemo, useState } from 'react';
import { clock, describeSlots, dayOf, type ClaimVersion } from '@microcity/sim';
import { api, type Lineage, type RunRow } from '../lib/api.ts';
import { openRun, refreshRuns, useApp, viewState } from '../store.ts';
import { Avatar, Badge, Button, Empty, Icon, Kbd, Modal, SecTitle, Segmented } from '../ui/kit.tsx';
import { CH_HEX, CHANNEL_LABEL, windowTone } from '../lib/format.ts';

export function RunsModal() {
  const set = useApp((s) => s.set);
  const runs = useApp((s) => s.runs);
  const current = useApp((s) => s.runId);
  const health = useApp((s) => s.health);
  const toast = useApp((s) => s.toast);
  const [seed, setSeed] = useState(42);
  const [provider, setProvider] = useState<'rule' | 'jev'>(health?.models.access ? 'jev' : 'rule');
  const [script, setScript] = useState<'outage' | 'quiet'>('outage');
  useEffect(() => {
    void refreshRuns();
  }, []);
  const scenario = useApp((s) => s.scenario);
  const create = async () => {
    try {
      const r = await api.createRun({ seed, provider, script, ...(scenario ? { scenario: scenario.id } : {}) });
      await refreshRuns();
      await openRun(r.id);
      set({ modal: null });
      toast('新运行已创建（暂停在 D01 06:00）', 'ok');
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };
  const live = runs.filter((r) => !r.experiment_id);
  const branches = runs.filter((r) => r.experiment_id && r.branch !== 'base');
  const row = (r: RunRow) => (
    <button key={r.id} className={`row-btn ${r.id === current ? 'on' : ''}`} onClick={() => (void openRun(r.id), set({ modal: null }))} data-testid={`run-row-${r.id}`}>
      <Icon name={r.parent_run_id ? 'fork' : 'play'} color="var(--accent)" />
      <div className="row-main">
        <div className="row-title">{r.name}</div>
        <div className="row-sub muted">
          {r.scenarioName} · seed {r.seed} · {new Date(r.created_at).toLocaleString('zh-CN')}
          {r.fork_t !== null ? ` · 分叉于 D${String(dayOf(r.fork_t)).padStart(2, '0')} ${clock(r.fork_t)}` : ''}
        </div>
      </div>
      <Badge color={r.provider === 'jev' ? 'var(--e-cyan)' : 'var(--fg-2)'}>{r.provider === 'jev' ? 'Jev' : '规则'}</Badge>
      {r.id === current && <Badge color="var(--accent)">当前</Badge>}
    </button>
  );
  return (
    <Modal title="运行" icon="play" width={760} onClose={() => set({ modal: null })} testId="runs-modal">
      <SecTitle icon="plus">在当前小镇（{scenario?.name ?? '河岸小镇'}）新建运行</SecTitle>
      <p className="muted" style={{ marginTop: 0 }}>
        想换一座小镇？到“设计”工作区用对话或模板造一座。
      </p>
      <div className="exp-form">
        <div className="field">
          <label>随机种子</label>
          <input className="field-input num" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} style={{ width: 110 }} data-testid="new-seed" />
        </div>
        <div className="field">
          <label>决策方式</label>
          <Segmented
            value={provider}
            onChange={setProvider}
            testId="new-provider"
            options={[
              { value: 'rule', label: '规则' },
              { value: 'jev', label: health?.models.access ? 'Jev（OpenRouter）' : 'Jev（未配置）' },
            ]}
          />
        </div>
        <div className="field">
          <label>剧本</label>
          <Segmented
            value={script}
            onChange={setScript}
            options={[
              { value: 'outage', label: '按剧本发通知' },
              { value: 'quiet', label: '只停电不通知' },
            ]}
          />
        </div>
        <Button variant="primary" icon="plus" onClick={create} disabled={provider === 'jev' && !health?.models.access} testId="new-run" style={{ alignSelf: 'flex-end' }}>
          新建
        </Button>
      </div>
      <SecTitle icon="history">实时运行</SecTitle>
      <div className="exp-list">{live.length ? live.map(row) : <Empty>还没有</Empty>}</div>
      {branches.length > 0 && (
        <>
          <SecTitle icon="fork">实验分支（已跑完，可打开查看每个人的经过）</SecTitle>
          <div className="exp-list">{branches.map(row)}</div>
        </>
      )}
    </Modal>
  );
}

export function LineageModal({ family }: { family: string }) {
  const runId = useApp((s) => s.runId);
  const s = useApp((st) => viewState(st));
  const set = useApp((st) => st.set);
  const [data, setData] = useState<Lineage>();
  useEffect(() => {
    if (runId) api.lineage(runId, family).then(setData).catch(() => {});
  }, [runId, family]);
  const tree = useMemo(() => {
    if (!data) return [];
    const byParent = new Map<string, ClaimVersion[]>();
    const ids = new Set(data.versions.map((v) => v.id));
    const roots: ClaimVersion[] = [];
    for (const v of [...data.versions].sort((a, b) => a.createdAt - b.createdAt)) {
      if (v.parentId && ids.has(v.parentId)) (byParent.get(v.parentId) ?? byParent.set(v.parentId, []).get(v.parentId)!).push(v);
      else roots.push(v);
    }
    const out: Array<{ v: ClaimVersion; depth: number }> = [];
    const walk = (v: ClaimVersion, depth: number) => {
      out.push({ v, depth });
      for (const c of byParent.get(v.id) ?? []) walk(c, depth + 1);
    };
    for (const r of roots) walk(r, 0);
    return out;
  }, [data]);
  const txCount = (vid: string) => data?.transmissions.filter((t) => t.versionId === vid).length ?? 0;
  const distorted = data ? data.versions.filter((v) => v.slots.window?.kind === 'all_day').length : 0;
  return (
    <Modal title="版本血缘：同一件事在人群里变成了什么样" icon="rumor" width={880} onClose={() => set({ modal: null })} testId="lineage-modal">
      {!data && <Empty>加载中…</Empty>}
      {data && (
        <>
          <div className="wrap-row" style={{ marginBottom: 10 }}>
            <Badge color="var(--fg-2)">{data.versions.length} 个版本</Badge>
            <Badge color="var(--info)">{data.transmissions.length} 次转述</Badge>
            <Badge color={distorted ? 'var(--bad)' : 'var(--ok)'}>{distorted} 个“全天”版本</Badge>
            <span className="muted">版本按内容去重；每条边都来自记录在案的转述，变形原因写在节点上。</span>
          </div>
          <div className="lineage" data-testid="lineage-tree">
            {tree.map(({ v, depth }) => {
              const tone = windowTone(v.slots);
              const holders = data.holders[v.id] ?? [];
              return (
                <div key={v.id} className="lin-node" style={{ marginLeft: depth * 22, ['--tone' as string]: tone.hex }}>
                  <div className="lin-head">
                    <span className="lin-dot" />
                    <span style={{ color: 'var(--fg-0)' }}>{describeSlots(v.slots, { withSource: true })}</span>
                  </div>
                  <div className="muted">
                    {v.origin.kind === 'publish' || v.origin.kind === 'correction' ? `${v.origin.kind === 'correction' ? '更正' : '发布'}：${v.root}` : v.origin.kind === 'org' ? '单位通知' : `${s?.agents[v.origin.by]?.name ?? v.origin.by} 经${CHANNEL_LABEL[v.origin.channel]}转述`} · D{String(dayOf(v.createdAt)).padStart(2, '0')} {clock(v.createdAt)} · 转述 {txCount(v.id)} 次
                  </div>
                  {v.mutations.length > 0 && (
                    <div className="mutations">
                      {v.mutations.map((m, i) => (
                        <Badge key={i} color={m.op === 'fill_worst_case' ? 'var(--bad)' : 'var(--warn)'} outline>
                          {mutLabel(m.slot, m.op)}
                          {Object.entries(m.because)
                            .map(([k, x]) => ` ${k}=${x}`)
                            .join('')}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {holders.length > 0 && (
                    <div className="holders">
                      <span className="muted">现在持有：</span>
                      {holders.map((h) => {
                        const a = s?.agents[h];
                        return a ? (
                          <button key={h} className="mini-person" onClick={() => set({ selectedAgent: h, modal: null, inspectorTab: 'mind' })}>
                            <Avatar look={a.look} />
                            <span>{a.name}</span>
                          </button>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}

function mutLabel(slot: string, op: string): string {
  const s = ({ window: '时段', day: '日期', area: '地点', source: '来源', certainty: '确定度', advice: '建议', event: '事件' } as Record<string, string>)[slot] ?? slot;
  switch (op) {
    case 'drop':
      return `漏说了${s}`;
    case 'coarsen':
      return `${s}说得更模糊`;
    case 'fill_worst_case':
      return `${s}往最坏处补成“全天”`;
    case 'weaken':
      return `${s}变弱`;
    case 'strengthen':
      return `${s}说得更肯定`;
    default:
      return `${s}${op}`;
  }
}

export function HelpModal() {
  const set = useApp((s) => s.set);
  return (
    <Modal title="怎么用这间社会实验室" icon="question" width={780} onClose={() => set({ modal: null })} testId="help-modal">
      <p className="dim" style={{ marginTop: 0 }}>
        在同一个时钟下生活的合成居民。世界由规则裁决（钱、库存、营业、停电都守恒且可审计）；居民只能在合法候选里选，Jev 只提供“人格契合、担心、想不想查证”这类语义因子，选择由显式效用 + 随机抽样完成；信任随经历按规则变化。每一步都留痕，可以重放。
      </p>
      <SecTitle icon="list">三个工作区</SecTitle>
      <dl className="kv">
        <dt>
          <Kbd>D</Kbd> 设计
        </dt>
        <dd>用对话或模板造一座小镇：人口、设施、人群性格、媒介、关系、停电剧本；右边实时预览。然后“开始观察”或“对照实验”。</dd>
        <dt>
          <Kbd>O</Kbd> 观察
        </dt>
        <dd>看它实时发生：城市 + 现场叙事；点一个人看他此刻的想法；底部章节条点过去回看、点空心标记快进。</dd>
        <dt>
          <Kbd>R</Kbd> 复盘
        </dt>
        <dd>选一个时刻和对比基准：反应墙看每个人的反应与变化，社会看信念与信任曲线、谁告诉了谁，对照看多 seed 分布，报告由 DeepSeek 只按事实表撰写。</dd>
      </dl>
      <SecTitle icon="eye">常用按键</SecTitle>
      <dl className="kv">
        <dt>
          <Kbd>空格</Kbd>
        </dt>
        <dd>播放 / 暂停（观察）</dd>
        <dt>
          <Kbd>1</Kbd>–<Kbd>5</Kbd>
        </dt>
        <dd>倍速 1× / 10× / 60× / 300× / 1800×</dd>
        <dt>
          <Kbd>N</Kbd>
        </dt>
        <dd>发布新闻（一次记录在案的干预）</dd>
        <dt>
          <Kbd>[</Kbd> <Kbd>]</Kbd> / 滚轮
        </dt>
        <dd>缩放城市；拖拽平移；方向键移动镜头</dd>
        <dt>
          <Kbd>Esc</Kbd>
        </dt>
        <dd>关闭抽屉 / 取消选中</dd>
      </dl>
      <SecTitle icon="layers">图例</SecTitle>
      <div className="wrap-row">
        {(['website', 'push', 'board', 'talk', 'dm', 'org'] as const).map((c) => (
          <Badge key={c} color={CH_HEX[c]}>
            {CHANNEL_LABEL[c]}
          </Badge>
        ))}
      </div>
      <div className="wrap-row" style={{ marginTop: 8 }}>
        <Badge color="var(--w-exact)">精确时段</Badge>
        <Badge color="var(--w-coarse)">只知道“下午”</Badge>
        <Badge color="var(--w-allday)">以为“全天”</Badge>
        <Badge color="var(--w-unknown)">时间不详</Badge>
      </div>
      <div className="wrap-row" style={{ marginTop: 8 }}>
        <span>
          <Icon name="exclaim" color="var(--warn)" /> 刚得知
        </span>
        <span>
          <Icon name="question" color="var(--info)" /> 正在考虑
        </span>
        <span>
          <Icon name="talk" /> 聊天
        </span>
        <span>
          <Icon name="rumor" color="var(--rumor)" /> 相信“全天”
        </span>
        <span>
          <Icon name="boltOff" color="var(--bad)" /> 被停电影响
        </span>
      </div>
      <SecTitle icon="warn">边界</SecTitle>
      <p className="muted">这是合成人物的实验沙盘，不是现实预测器。单次运行只是一条轨迹，结论要看多个 seed。台词、独白、报告由 DeepSeek 渲染，经校验只复述事实，不回写任何人的记忆。</p>
    </Modal>
  );
}
