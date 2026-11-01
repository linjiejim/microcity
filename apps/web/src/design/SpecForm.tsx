import { FACILITY_LABEL, weekday, type EventInput, type TownSpec } from '@microcity/sim';
import { Button, Icon, Segmented, Switch } from '../ui/kit.tsx';

const pct = (x: number) => `${Math.round(x * 100)}%`;

function Slider({ label, value, min, max, step, fmt, onChange, disabled, testId, hint }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void; disabled?: boolean; testId?: string; hint?: string }) {
  return (
    <label className={`slider ${disabled ? 'off' : ''}`} title={hint}>
      <span className="slider-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} data-testid={testId} />
      <span className="num slider-val">{fmt(value)}</span>
    </label>
  );
}

/** 参数表单：直接改规格（服务端规范化后回显） */
export function SpecForm({ spec, onChange }: { spec: TownSpec; onChange: (s: TownSpec) => void }) {
  const gen = spec.base === 'generated';
  const upd = <K extends keyof TownSpec>(k: K, v: TownSpec[K]) => onChange({ ...spec, [k]: v });
  return (
    <div className="spec-form" data-testid="spec-form">
      <div className="spec-sec">
        <div className="spec-title">
          <Icon name="person" /> 人口{!gen && <span className="muted">（经典小镇固定 30 人；改这些会切到“模板生成”）</span>}
        </div>
        <Slider label="人口" value={spec.population.size} min={12} max={60} step={1} fmt={(v) => `${v} 人`} onChange={(v) => onChange({ ...spec, base: 'generated', population: { ...spec.population, size: v } })} testId="spec-size" />
        <Slider label="60 岁以上" value={spec.population.seniors} min={0} max={0.6} step={0.05} fmt={pct} onChange={(v) => onChange({ ...spec, base: 'generated', population: { ...spec.population, seniors: v } })} />
        <Slider label="18–29 岁" value={spec.population.youth} min={0} max={0.6} step={0.05} fmt={pct} onChange={(v) => onChange({ ...spec, base: 'generated', population: { ...spec.population, youth: v } })} />
        <Slider label="住北区" value={spec.population.northShare} min={0.2} max={0.8} step={0.05} fmt={pct} onChange={(v) => onChange({ ...spec, base: 'generated', population: { ...spec.population, northShare: v } })} />
        <div className="facilities">
          {(Object.keys(spec.facilities) as Array<keyof TownSpec['facilities']>).map((k) => (
            <span key={k} className="fac">
              <span className="muted">{FACILITY_LABEL[k]}</span>
              <Button size="sm" icon="minus" onClick={() => onChange({ ...spec, base: 'generated', facilities: { ...spec.facilities, [k]: Math.max(0, spec.facilities[k] - 1) } })} title={`少一个${FACILITY_LABEL[k]}`} />
              <span className="num">{spec.facilities[k]}</span>
              <Button size="sm" icon="plus" onClick={() => onChange({ ...spec, base: 'generated', facilities: { ...spec.facilities, [k]: spec.facilities[k] + 1 } })} title={`多一个${FACILITY_LABEL[k]}`} />
            </span>
          ))}
        </div>
      </div>
      <div className="spec-sec">
        <div className="spec-title">
          <Icon name="bulb" /> 人群
        </div>
        <Slider label="信官方" value={spec.culture.trustGov} min={0.05} max={0.95} step={0.05} fmt={(v) => v.toFixed(2)} onChange={(v) => upd('culture', { ...spec.culture, trustGov: v })} hint="对官方通知的平均信任" testId="spec-trust" />
        <Slider label="焦虑" value={spec.culture.anxiety} min={0.05} max={0.95} step={0.05} fmt={(v) => v.toFixed(2)} onChange={(v) => upd('culture', { ...spec.culture, anxiety: v })} hint="焦虑的人在不知道时段时会往最坏处补" />
        <Slider label="爱社交" value={spec.culture.sociability} min={0.05} max={0.95} step={0.05} fmt={(v) => v.toFixed(2)} onChange={(v) => upd('culture', { ...spec.culture, sociability: v })} />
        <Slider label="记细节" value={spec.culture.detail} min={0.05} max={0.95} step={0.05} fmt={(v) => v.toFixed(2)} onChange={(v) => upd('culture', { ...spec.culture, detail: v })} hint="转述时保留精确时段的概率" />
      </div>
      <div className="spec-sec">
        <div className="spec-title">
          <Icon name="push" /> 媒介与关系
        </div>
        <Slider label="订推送" value={spec.media.push} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => upd('media', { ...spec.media, push: v })} testId="spec-push" />
        <Slider label="看网站" value={spec.media.website} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => upd('media', { ...spec.media, website: v })} />
        <Slider label="公告栏" value={spec.media.boards} min={0} max={3} step={1} fmt={(v) => `${v} 块`} onChange={(v) => upd('media', { ...spec.media, boards: v })} />
        <Slider label="朋友数" value={spec.network.friends} min={0} max={6} step={0.5} fmt={(v) => `${v} 人`} onChange={(v) => upd('network', { ...spec.network, friends: v })} hint="人均朋友数（不含家人、同事、邻居）" />
        <Slider label="跨区交友" value={spec.network.crossDistrict} min={0} max={1} step={0.1} fmt={pct} onChange={(v) => upd('network', { ...spec.network, crossDistrict: v })} disabled={!gen} />
        <Slider label="跨户亲属" value={spec.network.kin} min={0} max={1} step={0.1} fmt={pct} onChange={(v) => upd('network', { ...spec.network, kin: v })} disabled={!gen} hint="独居老人有住在别处的子女的比例" />
      </div>
    </div>
  );
}

const TIMES = Array.from({ length: 33 }, (_, i) => 6 * 3600 + i * 1800).map((s) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${s % 3600 ? '30' : '00'}`);
const CH: Array<{ id: 'website' | 'push' | 'board'; label: string }> = [
  { id: 'website', label: '网站' },
  { id: 'push', label: '推送' },
  { id: 'board', label: '公告栏' },
];

function DayTime({ value, onChange, testId }: { value: string; onChange: (v: string) => void; testId?: string }) {
  const [d, hm] = value.split(' ');
  return (
    <span className="daytime" data-testid={testId}>
      <select className="field-input" value={d} onChange={(e) => onChange(`${e.target.value} ${hm}`)}>
        {Array.from({ length: 7 }, (_, i) => `D${String(i + 1).padStart(2, '0')}`).map((x) => (
          <option key={x} value={x}>
            {x} {weekday(Number(x.slice(1)))}
          </option>
        ))}
      </select>
      <select className="field-input" value={hm} onChange={(e) => onChange(`${d} ${e.target.value}`)}>
        {[...new Set([...TIMES, hm!])].sort().map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
    </span>
  );
}

/** 剧本：1–3 轮停电，每轮的通知与澄清 */
export function EventsEditor({ events, onChange }: { events: EventInput[]; onChange: (e: EventInput[]) => void }) {
  const upd = (i: number, e: EventInput) => onChange(events.map((x, j) => (j === i ? e : x)));
  return (
    <div className="events" data-testid="events-editor">
      {events.map((e, i) => (
        <div key={i} className="event-card" data-testid={`event-${i}`}>
          <div className="event-head">
            <b>第 {i + 1} 轮</b>
            <Segmented
              value={e.area}
              onChange={(v) => upd(i, { ...e, area: v })}
              options={[
                { value: 'north', label: '北区' },
                { value: 'south', label: '南区' },
              ]}
            />
            <span className="grow" />
            {events.length > 1 && <Button size="sm" icon="cross" variant="ghost" title="删掉这一轮" onClick={() => onChange(events.filter((_, j) => j !== i))} />}
          </div>
          <div className="event-when">
            <select className="field-input" value={e.day} onChange={(x) => upd(i, { ...e, day: Number(x.target.value) })}>
              {[2, 3, 4, 5, 6, 7].map((d) => (
                <option key={d} value={d}>
                  D{String(d).padStart(2, '0')} {weekday(d)}
                </option>
              ))}
            </select>
            <select className="field-input" value={e.from} onChange={(x) => upd(i, { ...e, from: x.target.value })}>
              {TIMES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <span className="muted">到</span>
            <select className="field-input" value={e.to} onChange={(x) => upd(i, { ...e, to: x.target.value })}>
              {TIMES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <span className="muted">{e.falseAlarm ? '虚惊' : '停电'}</span>
          </div>
          <div className="event-sw">
            <Switch checked={!!e.notice} onChange={(v) => upd(i, { ...e, notice: v ? { at: `D${String(Math.max(1, e.day - 1)).padStart(2, '0')} 09:00`, channels: ['website', 'push'], headline: 'coarse', advice: ['charge_devices'] } : null })} testId={`event-${i}-notice`}>
              发通知
            </Switch>
            {e.notice && <DayTime value={e.notice.at} onChange={(v) => upd(i, { ...e, notice: { ...e.notice!, at: v } })} />}
          </div>
          {e.notice && (
            <div className="event-sub">
              {CH.map((c) => (
                <Switch key={c.id} checked={e.notice!.channels.includes(c.id)} onChange={(v) => upd(i, { ...e, notice: { ...e.notice!, channels: v ? [...e.notice!.channels, c.id] : e.notice!.channels.filter((x) => x !== c.id) } })}>
                  {c.label}
                </Switch>
              ))}
              <Segmented
                value={e.notice.headline}
                onChange={(v) => upd(i, { ...e, notice: { ...e.notice!, headline: v } })}
                options={[
                  { value: 'exact', label: '写精确时间', title: '例如“北区周四 14:00–16:00 计划停电”' },
                  { value: 'coarse', label: '只写上午/下午', title: '例如“北区周四下午计划停电”：谣言和过度调整的主要来源' },
                  { value: 'none', label: '不写时间' },
                ]}
              />
            </div>
          )}
          <div className="event-sw">
            <Switch
              checked={!!e.falseAlarm}
              onChange={(v) => {
                const { falseAlarm: _f, ...rest } = e;
                upd(i, v ? { ...rest, falseAlarm: true } : rest);
              }}
              testId={`event-${i}-false-alarm`}
              title="照常发通知，但到时候不停电（狼来了）"
            >
              虚惊：通知了但不停电
            </Switch>
          </div>
          <div className="event-sw">
            <Switch checked={!!e.clarify} onChange={(v) => upd(i, { ...e, clarify: v ? { at: e.notice ? `${e.notice.at.slice(0, 3)} 16:00` : `D${String(Math.max(1, e.day - 1)).padStart(2, '0')} 16:00`, channels: ['website', 'push'] } : null })}>
              再发一次澄清
            </Switch>
            {e.clarify && <DayTime value={e.clarify.at} onChange={(v) => upd(i, { ...e, clarify: { ...e.clarify!, at: v } })} />}
          </div>
          {e.clarify && (
            <div className="event-sub">
              {CH.map((c) => (
                <Switch key={c.id} checked={e.clarify!.channels.includes(c.id)} onChange={(v) => upd(i, { ...e, clarify: { ...e.clarify!, channels: v ? [...e.clarify!.channels, c.id] : e.clarify!.channels.filter((x) => x !== c.id) } })}>
                  {c.label}
                </Switch>
              ))}
            </div>
          )}
        </div>
      ))}
      {events.length < 3 && (
        <Button
          size="sm"
          icon="plus"
          onClick={() => {
            const last = events[events.length - 1];
            const day = Math.min(7, (last?.day ?? 3) + 2);
            onChange([...events, { area: last?.area === 'north' ? 'south' : 'north', day, from: '10:00', to: '12:00', notice: { at: `D${String(day - 1).padStart(2, '0')} 09:00`, channels: ['website', 'push', 'board'], headline: 'coarse', advice: ['charge_devices'] }, clarify: null, workOrder: true }]);
          }}
          testId="event-add"
        >
          再加一轮停电
        </Button>
      )}
    </div>
  );
}
