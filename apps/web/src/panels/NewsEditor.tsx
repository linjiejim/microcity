import { useMemo, useState } from 'react';
import { clock as fmtClock, coarsen, dayOf, describeSlots, hm, weekday, type Advice, type PublishChannel, type Slots, type WindowSlot } from '@microcity/sim';
import { api } from '../lib/api.ts';
import { displayTime, openRun, useApp, viewState } from '../store.ts';
import { Button, Check, Icon, Modal, Segmented } from '../ui/kit.tsx';

const EVENTS = [
  { v: 'power_outage', label: '停电' },
  { v: '停水', label: '停水' },
  { v: '封路', label: '封路' },
  { v: '涨价', label: '涨价' },
  { v: 'custom', label: '自定义…' },
];
const HOURS = Array.from({ length: 35 }, (_, i) => 6 * 2 + i).map((x) => ({ v: x * 1800, label: `${String(Math.floor(x / 2)).padStart(2, '0')}:${x % 2 ? '30' : '00'}` }));

export function NewsEditor() {
  const runId = useApp((s) => s.runId);
  const s = useApp((st) => viewState(st));
  const clock = useApp((st) => st.clock);
  const history = useApp((st) => st.history);
  const set = useApp((st) => st.set);
  const toast = useApp((st) => st.toast);
  const today = dayOf(displayTime(clock));
  const [headline, setHeadline] = useState('');
  const [body, setBody] = useState('');
  const [event, setEvent] = useState('power_outage');
  const [custom, setCustom] = useState('');
  const [area, setArea] = useState<'north' | 'south' | 'town' | ''>('north');
  const [day, setDay] = useState<number>(today + 1);
  const [wkind, setWkind] = useState<'exact' | 'coarse' | 'all_day' | 'none'>('exact');
  const [from, setFrom] = useState(hm(14));
  const [to, setTo] = useState(hm(16));
  const [coarseLabel, setCoarseLabel] = useState<'morning' | 'afternoon' | 'evening'>('afternoon');
  const [certainty, setCertainty] = useState<'confirmed' | 'likely' | 'rumor'>('confirmed');
  const [advice, setAdvice] = useState<Advice[]>(['charge_devices']);
  const [hlArea, setHlArea] = useState(true);
  const [hlDay, setHlDay] = useState(true);
  const [hlWindow, setHlWindow] = useState<'none' | 'coarse' | 'exact'>('coarse');
  const [channels, setChannels] = useState<PublishChannel[]>(['website', 'push']);
  const [correctionOf, setCorrectionOf] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const ev = event === 'custom' ? custom.trim() : event;
  const window: WindowSlot | undefined = wkind === 'exact' ? { kind: 'exact', from, to } : wkind === 'coarse' ? { kind: 'coarse', label: coarseLabel } : wkind === 'all_day' ? { kind: 'all_day' } : undefined;
  const bodySlots: Slots = useMemo(
    () => ({ event: ev || undefined, area: area || undefined, day: day || undefined, window, source: 'gov', certainty, advice: advice.length ? advice : undefined }),
    [ev, area, day, window?.kind, from, to, coarseLabel, certainty, advice],
  );
  const headSlots: Slots = { event: ev || undefined, area: hlArea && area ? area : undefined, day: hlDay && day ? day : undefined, window: hlWindow !== 'none' && window ? (hlWindow === 'coarse' ? coarsen(window) : window) : undefined, source: 'gov', certainty };

  const preset = (k: 'clarify' | 'road') => {
    if (k === 'clarify') {
      setHeadline('澄清：北区停电仅周四 14:00–16:00');
      setBody('有“北区周四停一整天电”的说法。特此澄清：停电仅为周四 14:00–16:00，范围北区，其余时间正常供电。');
      setEvent('power_outage');
      setArea('north');
      setDay(4);
      setWkind('exact');
      setFrom(hm(14));
      setTo(hm(16));
      setCertainty('confirmed');
      setHlWindow('exact');
      setChannels(['website', 'push']);
      const n1 = s && Object.values(s.news).find((n) => n.familyId === 'F_OUTAGE');
      setCorrectionOf(n1?.id ?? '');
    } else {
      setHeadline('南街周六上午封路施工');
      setBody('南街（超市、诊所、政务中心一带）周六 08:00–12:00 封路施工，行人请绕行河滨步道。');
      setEvent('封路');
      setArea('south');
      setDay(6);
      setWkind('exact');
      setFrom(hm(8));
      setTo(hm(12));
      setCertainty('confirmed');
      setAdvice([]);
      setChannels(['website', 'board']);
      setCorrectionOf('');
    }
  };

  const submit = async () => {
    setErr('');
    if (!headline.trim()) return setErr('请填写标题');
    if (!body.trim()) return setErr('请填写正文');
    if (!ev) return setErr('请说明是什么事件');
    if (channels.length === 0) return setErr('至少选择一个渠道');
    if (wkind === 'exact' && from >= to) return setErr('结束时间要晚于开始时间');
    if (!runId) return;
    setBusy(true);
    try {
      const r = await api.publish(runId, { headline: headline.trim(), body: body.trim(), slots: bodySlots, headlineSlots: headSlots, channels, ...(correctionOf ? { correctionOf } : {}) });
      toast(`已发布 ${r.id}（已记录为管理员干预）`, 'ok');
      set({ modal: null, selectedFamily: r.familyId, sideTab: 'feed', selectedAgent: undefined, overlay: 'spread' });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <Modal
      title="发布新闻（管理员干预）"
      icon="news"
      width={900}
      onClose={() => set({ modal: null })}
      testId="news-editor"
      footer={
        <>
          {err && (
            <span style={{ color: 'var(--bad)', marginRight: 'auto' }} data-testid="news-error">
              <Icon name="warn" /> {err}
            </span>
          )}
          {history && <span className="muted">历史模式下发布会作用于实时世界</span>}
          <Button onClick={() => set({ modal: null })}>取消</Button>
          <Button variant="primary" icon="push" onClick={submit} disabled={busy} testId="news-submit">
            {busy ? '发布中…' : '发布'}
          </Button>
        </>
      }
    >
      <div className="editor">
        <div className="editor-form">
          <div className="presets">
            <span className="muted">快速填入：</span>
            <Button size="sm" onClick={() => preset('clarify')} testId="preset-clarify">
              停电澄清
            </Button>
            <Button size="sm" onClick={() => preset('road')} testId="preset-road">
              南街封路
            </Button>
          </div>
          <div className="field">
            <label>标题（锁屏和海报只显示它）</label>
            <input className="field-input" value={headline} maxLength={60} onChange={(e) => setHeadline(e.target.value)} placeholder="例如：南街周六上午封路施工" data-testid="news-headline" />
          </div>
          <div className="field">
            <label>正文</label>
            <textarea className="field-input" rows={3} value={body} maxLength={600} onChange={(e) => setBody(e.target.value)} placeholder="读全文的人才能看到的细节" data-testid="news-body" />
          </div>
          <div className="divider" />
          <div className="field-label">结构化主张（居民只会“理解”这些槽位，文字不直接进入他们的认知）</div>
          <div className="slot-grid">
            <label>事件</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="field-input" value={event} onChange={(e) => setEvent(e.target.value)} data-testid="news-event">
                {EVENTS.map((x) => (
                  <option key={x.v} value={x.v}>
                    {x.label}
                  </option>
                ))}
              </select>
              {event === 'custom' && <input className="field-input" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="事件名" />}
            </div>
            <label>地点</label>
            <Segmented
              value={area}
              onChange={setArea}
              testId="news-area"
              options={[
                { value: 'north', label: '北区' },
                { value: 'south', label: '南区' },
                { value: 'town', label: '全镇' },
                { value: '', label: '不写' },
              ]}
            />
            <label>日期</label>
            <select className="field-input" value={day} onChange={(e) => setDay(Number(e.target.value))} data-testid="news-day">
              <option value={0}>不写</option>
              {Array.from({ length: 7 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  D{String(d).padStart(2, '0')} {weekday(d)}
                  {d === today ? '（今天）' : d === today + 1 ? '（明天）' : ''}
                </option>
              ))}
            </select>
            <label>时段</label>
            <div className="stack">
              <Segmented
                value={wkind}
                onChange={setWkind}
                testId="news-window"
                options={[
                  { value: 'exact', label: '精确' },
                  { value: 'coarse', label: '粗略' },
                  { value: 'all_day', label: '全天' },
                  { value: 'none', label: '不写' },
                ]}
              />
              {wkind === 'exact' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select className="field-input" value={from} onChange={(e) => setFrom(Number(e.target.value))}>
                    {HOURS.map((h) => (
                      <option key={h.v} value={h.v}>
                        {h.label}
                      </option>
                    ))}
                  </select>
                  <span>至</span>
                  <select className="field-input" value={to} onChange={(e) => setTo(Number(e.target.value))}>
                    {HOURS.map((h) => (
                      <option key={h.v} value={h.v}>
                        {h.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {wkind === 'coarse' && (
                <Segmented
                  value={coarseLabel}
                  onChange={setCoarseLabel}
                  options={[
                    { value: 'morning', label: '上午' },
                    { value: 'afternoon', label: '下午' },
                    { value: 'evening', label: '晚上' },
                  ]}
                />
              )}
            </div>
            <label>确定度</label>
            <Segmented
              value={certainty}
              onChange={setCertainty}
              options={[
                { value: 'confirmed', label: '确定' },
                { value: 'likely', label: '可能' },
                { value: 'rumor', label: '传言' },
              ]}
            />
            <label>建议</label>
            <div className="wrap-row">
              <Check checked={advice.includes('charge_devices')} onChange={() => setAdvice(toggle(advice, 'charge_devices'))}>
                提前充电
              </Check>
              <Check checked={advice.includes('plan_elsewhere')} onChange={() => setAdvice(toggle(advice, 'plan_elsewhere'))}>
                另行安排
              </Check>
              <Check checked={advice.includes('store_food')} onChange={() => setAdvice(toggle(advice, 'store_food'))}>
                备好食物
              </Check>
            </div>
            <label>标题含</label>
            <div className="wrap-row">
              <Check checked={hlArea} onChange={setHlArea}>
                地点
              </Check>
              <Check checked={hlDay} onChange={setHlDay}>
                日期
              </Check>
              <span className="muted">时段</span>
              <Segmented
                value={hlWindow}
                onChange={setHlWindow}
                testId="news-hl-window"
                options={[
                  { value: 'none', label: '不含' },
                  { value: 'coarse', label: '粗略' },
                  { value: 'exact', label: '精确' },
                ]}
              />
            </div>
            <label>渠道</label>
            <div className="wrap-row" data-testid="news-channels">
              <Check checked={channels.includes('website')} onChange={() => setChannels(toggle(channels, 'website'))} testId="ch-website">
                镇网站
              </Check>
              <Check checked={channels.includes('push')} onChange={() => setChannels(toggle(channels, 'push'))} testId="ch-push">
                政务推送
              </Check>
              <Check checked={channels.includes('board')} onChange={() => setChannels(toggle(channels, 'board'))} testId="ch-board">
                公告栏
              </Check>
            </div>
            <label>更正</label>
            <select className="field-input" value={correctionOf} onChange={(e) => setCorrectionOf(e.target.value)}>
              <option value="">不是更正</option>
              {s &&
                Object.values(s.news).map((n) => (
                  <option key={n.id} value={n.id}>
                    更正 {n.id}：{n.headline.text}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <aside className="editor-preview">
          <div className="field-label">锁屏推送</div>
          <div className="phone">
            <div className="phone-screen">
              <div className="phone-clock num">{fmtClock(displayTime(clock))}</div>
              <div className="notif">
                <div className="muted">镇政务通知 · 刚刚</div>
                <div>{headline || '（标题）'}</div>
              </div>
            </div>
          </div>
          <div className="field-label" style={{ marginTop: 12 }}>
            公告栏海报
          </div>
          <div className="poster">
            <div className="poster-head">通 知</div>
            <div>{headline || '（标题）'}</div>
          </div>
          <div className="divider" />
          <div className="field-label">只看标题的人会以为</div>
          <div className="read" data-testid="preview-headline">
            {ev ? describeSlots(headSlots) : '—'}
          </div>
          <div className="field-label" style={{ marginTop: 8 }}>
            读了全文的人会知道
          </div>
          <div className="read" data-testid="preview-body">
            {ev ? describeSlots(bodySlots, { withAdvice: true }) : '—'}
          </div>
          <div className="muted" style={{ marginTop: 10 }}>
            发布者会记录为“管理员（实验干预）”，不伪装成自然传播。
          </div>
        </aside>
      </div>
    </Modal>
  );
}

export { openRun };
