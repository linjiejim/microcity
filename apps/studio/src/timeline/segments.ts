import { ACT_BUCKET, dayStart, type ActState, type Bucket, type DomainEvent, type OptionTrace } from '@microcity/society';
import type { DayPack } from '../sim/protocol.ts';

/** 一个人一天里的一段：在做某件事，或者在路上 */
export interface Segment {
  t0: number;
  t1: number;
  bucket: Bucket;
  label: string;
  place: string;
  /** 不在社区里（去城里了） */
  away: boolean;
}

export interface Mark {
  t: number;
  kind: 'chat' | 'pay' | 'earn' | 'tie' | 'fail';
  text: string;
}

export interface DecisionRec {
  t: number;
  n: number;
  options: OptionTrace[];
  chosen: string;
  total: number;
}

export interface DayStory {
  segments: Segment[];
  marks: Mark[];
  decisions: DecisionRec[];
}

/** 把一个人这一天的事件整理成时间轴上的段、记号与决策记录 */
export function dayStory(pack: DayPack, agent: string, nameOf: (id: string) => string, placeName: (id: string) => string): DayStory {
  const d0 = dayStart(pack.day);
  const d1 = dayStart(pack.day + 1);
  const segments: Segment[] = [];
  const marks: Mark[] = [];
  const decisions: DecisionRec[] = [];
  const push = (s: Segment) => {
    if (s.t1 <= s.t0) return;
    const prev = segments[segments.length - 1];
    // 连着做同一件事就并成一段
    if (prev && prev.label === s.label && prev.place === s.place && Math.abs(prev.t1 - s.t0) < 1) prev.t1 = s.t1;
    else segments.push(s);
  };
  const actSeg = (act: ActState, t0: number, t1: number): Segment => ({ t0, t1, bucket: ACT_BUCKET[act.kind], label: act.label, place: act.place, away: !!act.away });

  const start = pack.snapshot.people[agent];
  let act: ActState | null = start?.act ?? null;
  let actFrom = d0;
  let move: { to: string; t0: number } | null = start?.loc.k === 'move' ? { to: start.loc.move.to, t0: d0 } : null;

  for (const e of pack.events as DomainEvent[]) {
    switch (e.type) {
      case 'act_started':
        if (e.agent === agent) {
          act = e.act;
          actFrom = e.t;
        }
        break;
      case 'act_ended':
        if (e.agent === agent && act) {
          push(actSeg(act, actFrom, e.t));
          act = null;
        }
        break;
      case 'move_started':
        if (e.agent === agent) move = { to: e.move.to, t0: e.t };
        break;
      case 'arrived':
        if (e.agent === agent && move) {
          push({ t0: move.t0, t1: e.t, bucket: 'travel', label: `去${placeName(move.to)}`, place: move.to, away: false });
          move = null;
        }
        break;
      case 'decision':
        if (e.agent === agent) decisions.push({ t: e.t, n: e.n, options: e.options, chosen: e.chosen, total: e.total });
        break;
      case 'chat':
        if (e.a === agent || e.b === agent) marks.push({ t: e.t, kind: 'chat', text: `和${nameOf(e.a === agent ? e.b : e.a)}聊了聊（${e.topic}）` });
        break;
      case 'tie_formed':
        if (e.a === agent || e.b === agent) marks.push({ t: e.t, kind: 'tie', text: `认识了${nameOf(e.a === agent ? e.b : e.a)}` });
        break;
      case 'tie_changed':
        if (e.a === agent || e.b === agent) marks.push({ t: e.t, kind: 'tie', text: `和${nameOf(e.a === agent ? e.b : e.a)}成了朋友` });
        break;
      case 'transfer':
        if (e.from === agent && (e.kind === 'purchase' || e.kind === 'lunch')) marks.push({ t: e.t, kind: 'pay', text: `花了 ${fmtYuan(e.amount)}：${e.memo}` });
        else if (e.to === agent && e.kind !== 'family') marks.push({ t: e.t, kind: 'earn', text: `收到 ${fmtYuan(e.amount)}：${e.memo}` });
        break;
      case 'plan_failed':
        if (e.agent === agent) marks.push({ t: e.t, kind: 'fail', text: `${e.label}没成：${e.reason}` });
        break;
      case 'commit_missed':
        if (e.agent === agent) marks.push({ t: e.t, kind: 'fail', text: `错过了${e.label}：${e.reason}` });
        break;
      default:
        break;
    }
  }
  if (act) push(actSeg(act, actFrom, Math.min(d1, Math.max(act.t1, actFrom + 1))));
  if (move) push({ t0: move.t0, t1: d1, bucket: 'travel', label: `去${placeName(move.to)}`, place: move.to, away: false });
  return { segments, marks, decisions };
}

export const fmtYuan = (x: number): string => `¥${Number.isInteger(x) ? x : x.toFixed(1)}`;
