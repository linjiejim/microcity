import { r3 } from '../core/rng.ts';
import { HOBBIES } from '../data/tables.ts';
import { tieKey, type PersonDef } from '../model/def.ts';
import type { ActState, PersonState } from '../model/state.ts';
import { closenessAt } from '../reduce.ts';
import type { Engine } from '../engine/engine.ts';

/**
 * 关系的变化（改规则要升 SOCIAL_RULES_VERSION）：
 * - 同处一地、在做能聊天的事，就可能聊起来；认识的人更容易聊；
 * - 聊天涨亲密度（越熟涨得越慢）；
 * - 陌生人聊过几次成为熟人；熟人、邻居、同事、同学的亲密度过线成为朋友。
 */

/** 这段活动属于哪种“场合”；不能聊天返回 undefined */
function scene(act: ActState, home: string): string | undefined {
  if (act.away || act.chatted) return undefined;
  switch (act.kind) {
    case 'hobby': {
      const h = act.hobby ? HOBBIES[act.hobby] : undefined;
      return h && h.social >= 0.1 && act.place !== home ? 'leisure' : undefined;
    }
    case 'eat_out':
      return 'eat';
    case 'shop':
      return 'shop';
    case 'work':
      return 'work';
    case 'school':
      return 'school';
    case 'escort':
      return 'school-gate';
    default:
      return undefined;
  }
}

const TOPIC: Record<string, string> = { eat: '吃饭', shop: '买东西', work: '干活', school: '上课', 'school-gate': '接送孩子' };

export function maybeChat(e: Engine, p: PersonDef, ps: PersonState): void {
  const act = ps.act;
  if (!act) return;
  const sc = scene(act, p.home);
  if (!sc) return;
  const t = e.now;
  let best: { id: string; score: number; closeness: number; known: boolean } | undefined;
  for (const other of e.state.here[act.place]!) {
    if (other === p.id) continue;
    const oa = e.state.people[other]!.act;
    if (!oa || scene(oa, e.P[other]!.home) !== sc) continue;
    const tie = e.state.ties[tieKey(p.id, other)];
    const c = tie ? closenessAt(tie, t, e.params) : 0;
    const sameHobby = act.kind === 'hobby' && oa.hobby === act.hobby;
    // 家里人不在这里算（一家人吃饭的社交回报已经在需求里）
    if (tie && (tie.kind === 'family' || tie.kind === 'partner') && sc !== 'leisure') continue;
    const score = c * 2 + (sameHobby ? 0.5 : 0) + e.rand('chat-pick', p.id, act.id, other) * 0.3;
    if (!best || score > best.score) best = { id: other, score, closeness: c, known: !!tie };
  }
  if (!best) return;
  const o = e.P[best.id]!;
  const sameHobby = act.kind === 'hobby' && e.state.people[best.id]!.act?.hobby === act.hobby;
  const base = sc === 'work' || sc === 'school' ? 0.3 : 1;
  const prob = best.known ? base * (0.45 + 0.4 * best.closeness + 0.2 * (p.traits.social - 0.5)) : base * e.params.strangerChat * (p.traits.social + o.traits.social) * (sameHobby ? 1.7 : 1);
  if (e.rand('chat', p.id, act.id) >= prob) return;
  const topic = act.kind === 'hobby' && act.hobby ? HOBBIES[act.hobby]!.label : TOPIC[sc]!;
  const d = best.known ? r3(e.params.chatCloseness * Math.pow(1 - best.closeness, 1.5)) : 0;
  e.emit({ type: 'chat', a: p.id, b: best.id, place: act.place, topic, d });
  const key = tieKey(p.id, best.id);
  const tie = e.state.ties[key];
  if (!tie) {
    if ((e.state.co[key] ?? 0) >= e.params.acquaintAfter) e.emit({ type: 'tie_formed', a: p.id, b: best.id, kind: 'acquaintance', via: topic });
  } else if (tie.kind !== 'family' && tie.kind !== 'partner' && tie.kind !== 'friend' && tie.closeness >= e.params.friendAt) {
    e.emit({ type: 'tie_changed', a: p.id, b: best.id, from: tie.kind, to: 'friend' });
  }
}
