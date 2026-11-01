import { HOUR, hhmm, weekday } from '../core/time.ts';
import { canonical } from '../core/hash.ts';
import type { Slots, WindowSlot } from './types.ts';

const EVENT_LABEL: Record<string, string> = { power_outage: '停电' };

export const SLOT_LABEL: Record<string, string> = { event: '事件', area: '地点', day: '日期', window: '时段', source: '来源', certainty: '确定度', advice: '建议' };
export const slotNames = (keys: readonly string[]): string => keys.map((k) => SLOT_LABEL[k] ?? k).join('、');
export const eventLabel = (e?: string): string => (e ? (EVENT_LABEL[e] ?? e) : '有事');

export const areaLabel = (a?: Slots['area']): string => (a === 'north' ? '北区' : a === 'south' ? '南区' : a === 'town' ? '全镇' : '某处');

export function windowInterval(w?: WindowSlot): [number, number] {
  if (!w) return [8 * HOUR, 20 * HOUR];
  switch (w.kind) {
    case 'exact':
      return [w.from, w.to];
    case 'all_day':
      return [0, 24 * HOUR];
    case 'coarse':
      return w.label === 'morning' ? [8 * HOUR, 12 * HOUR] : w.label === 'afternoon' ? [12 * HOUR, 18 * HOUR] : [18 * HOUR, 22 * HOUR];
  }
}

/** 精度：0 不详，1 全天（扭曲），2 粗略，3 精确 */
export function windowPrecision(w?: WindowSlot): number {
  if (!w) return 0;
  return w.kind === 'exact' ? 3 : w.kind === 'coarse' ? 2 : 1;
}

export function windowLabel(w?: WindowSlot): string {
  if (!w) return '时间不详';
  if (w.kind === 'exact') return `${hhmm(w.from)}–${hhmm(w.to)}`;
  if (w.kind === 'all_day') return '全天';
  return w.label === 'morning' ? '上午' : w.label === 'afternoon' ? '下午' : '晚上';
}

export function coarsen(w: WindowSlot): WindowSlot {
  if (w.kind !== 'exact') return w;
  const mid = (w.from + w.to) / 2;
  return { kind: 'coarse', label: mid < 12 * HOUR ? 'morning' : mid < 18 * HOUR ? 'afternoon' : 'evening' };
}

export const dayLabel = (day?: number): string => (day ? weekday(day) : '近期');

const sourceLabel = (s?: Slots['source']) => (s === 'gov' ? '政务中心' : s === 'press' ? '社区报' : s === 'org' ? '单位' : s === 'person' ? '别人' : '');

const ADVICE: Record<string, string> = { charge_devices: '提前给手机充电', plan_elsewhere: '需用电办公请另行安排', store_food: '备好食物' };

/** 把槽位说成一句中文（模板，不添加槽位外细节） */
export function describeSlots(s: Slots, opts: { withSource?: boolean; withAdvice?: boolean } = {}): string {
  const lead = s.certainty === 'rumor' ? '听说' : s.certainty === 'likely' ? '好像' : '';
  const where = s.area ? areaLabel(s.area) : '有地方';
  const when = s.day ? dayLabel(s.day) : '近期';
  const ev = eventLabel(s.event);
  let body: string;
  if (!s.window) body = `${where}${when}要${ev}，具体时间不清楚`;
  else if (s.window.kind === 'all_day') body = `${where}${when}要${ev}一整天`;
  else if (s.window.kind === 'coarse') body = `${where}${when}${windowLabel(s.window)}${ev}`;
  else body = `${where}${when} ${windowLabel(s.window)} ${ev}`;
  let out = lead + body;
  if (opts.withSource && s.source) out += `（${sourceLabel(s.source)}说的）`;
  if (opts.withAdvice && s.advice?.length) out += `，${s.advice.map((a) => ADVICE[a] ?? a).join('，')}`;
  return out;
}

export const slotsEqual = (a: Slots, b: Slots): boolean => canonical(a) === canonical(b);

export function slotSummary(s: Slots): Array<{ key: string; label: string; value: string }> {
  const rows: Array<{ key: string; label: string; value: string }> = [];
  rows.push({ key: 'event', label: '事件', value: s.event ? eventLabel(s.event) : '—' });
  rows.push({ key: 'area', label: '地点', value: s.area ? areaLabel(s.area) : '—' });
  rows.push({ key: 'day', label: '日期', value: s.day ? `D${String(s.day).padStart(2, '0')} ${weekday(s.day)}` : '—' });
  rows.push({ key: 'window', label: '时段', value: s.window ? windowLabel(s.window) : '—' });
  rows.push({ key: 'source', label: '来源', value: s.source ? sourceLabel(s.source) : '—' });
  rows.push({ key: 'certainty', label: '确定度', value: s.certainty === 'confirmed' ? '确定' : s.certainty === 'likely' ? '可能' : s.certainty === 'rumor' ? '传言' : '—' });
  rows.push({ key: 'advice', label: '建议', value: s.advice?.length ? s.advice.map((a) => ADVICE[a] ?? a).join('、') : '—' });
  return rows;
}
