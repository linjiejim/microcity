/** 模拟时间：从 D01 00:00 起的整数秒。D01 为周一。 */
export type SimTime = number;

export const MIN = 60;
export const HOUR = 3600;
export const DAY = 86400;

/** D01 → 1 */
export const dayOf = (t: SimTime): number => Math.floor(t / DAY) + 1;
/** 当天 00:00 起的秒数 */
export const timeOfDay = (t: SimTime): number => ((t % DAY) + DAY) % DAY;
/** 某天某时刻的绝对时间 */
export const at = (day: number, hh: number, mm = 0, ss = 0): SimTime => (day - 1) * DAY + hh * HOUR + mm * MIN + ss;
/** 当天内的时刻（秒） */
export const hm = (hh: number, mm = 0): number => hh * HOUR + mm * MIN;
export const dayStart = (day: number): SimTime => (day - 1) * DAY;

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;
export const weekday = (day: number): string => WEEKDAYS[(day - 1) % 7]!;
export const isWeekend = (day: number): boolean => (day - 1) % 7 >= 5;

const pad = (n: number) => String(n).padStart(2, '0');

/** '08:14' */
export function clock(t: SimTime): string {
  const s = timeOfDay(t);
  return `${pad(Math.floor(s / HOUR))}:${pad(Math.floor((s % HOUR) / MIN))}`;
}

/** 'D03 08:14' */
export function formatTime(t: SimTime): string {
  return `D${pad(dayOf(t))} ${clock(t)}`;
}

/** 解析 'D03 08:05' 或 'D03 08:05:30' */
export function parseTime(s: string): SimTime {
  const m = /^D(\d+)\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  if (!m) throw new Error(`无法解析模拟时间: ${s}`);
  return at(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0));
}

/** 时段内秒数转 'HH:MM' */
export function hhmm(secOfDay: number): string {
  return `${pad(Math.floor(secOfDay / HOUR))}:${pad(Math.floor((secOfDay % HOUR) / MIN))}`;
}

/** 区间重叠秒数 */
export function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}
