import type { DomainEvent } from './events.ts';
import type { Agent, FunnelState, OutageStats, PlanItem, WorldState } from './types.ts';

/**
 * 纯状态转换：state 只通过事件改变。前后端共用同一份 reducer（spec D13）。
 * 为性能起见原地修改 state；调用方负责在需要时复制。
 */
export function applyEvent(s: WorldState, e: DomainEvent): void {
  s.meta.t = e.t;
  s.meta.seq = e.seq;
  switch (e.type) {
    case 'run_started':
    case 'day_started':
    case 'conversation':
    case 'org_notice':
    case 'intervention':
    case 'purchase_failed':
      return;
    case 'plan_set': {
      const a = ag(s, e.agent);
      a.plans[e.day] = e.items.map((x) => ({ ...x }));
      // 只保留昨天、今天、明天
      for (const d of Object.keys(a.plans)) if (Number(d) < e.day - 1) delete a.plans[Number(d)];
      if (e.reason === 'revision' || e.reason === 'org') {
        const fam = e.items.find((x) => x.origin?.family)?.origin?.family;
        if (fam) mark(a, fam, 'intended', e.t);
      }
      return;
    }
    case 'item_status': {
      const it = findItem(ag(s, e.agent), e.day, e.itemId);
      if (it) it.status = e.status;
      return;
    }
    case 'walk_started': {
      const a = ag(s, e.agent);
      leavePlace(s, a);
      a.loc = { k: 'walk', walk: e.walk };
      return;
    }
    case 'walk_stopped': {
      const a = ag(s, e.agent);
      a.loc = { k: 'street', tile: e.tile };
      return;
    }
    case 'arrived': {
      const a = ag(s, e.agent);
      leavePlace(s, a);
      a.loc = { k: 'in', place: e.place, tile: e.tile };
      const p = s.places[e.place];
      if (p && !p.occupants.includes(a.id)) p.occupants.push(a.id);
      return;
    }
    case 'activity_started': {
      const a = ag(s, e.agent);
      a.act = { ...e.act };
      if (e.act.itemId) {
        const it = findItemAny(a, e.act.itemId);
        if (it) {
          it.status = 'active';
          if (it.origin?.family && (it.origin.decisionId || it.origin.reason === 'org')) mark(a, it.origin.family, 'acted', e.t);
        }
      }
      return;
    }
    case 'activity_ended': {
      const a = ag(s, e.agent);
      if (a.act && a.act.id === e.actId) a.act = null;
      if (e.itemId) {
        const it = findItemAny(a, e.itemId);
        if (it) it.status = e.outcome === 'done' ? 'done' : e.outcome;
      }
      return;
    }
    case 'woke':
      ag(s, e.agent).wokeAt = e.t;
      return;
    case 'meal':
      ag(s, e.agent).lastMealAt = e.t;
      return;
    case 'phone':
      ag(s, e.agent).phone = { ...e.phone };
      return;
    case 'transfer':
      s.accounts[e.from] = (s.accounts[e.from] ?? 0) - e.amount;
      s.accounts[e.to] = (s.accounts[e.to] ?? 0) + e.amount;
      return;
    case 'stock': {
      const h = (s.stock[e.holder] ??= {});
      h[e.item] = (h[e.item] ?? 0) + e.delta;
      return;
    }
    case 'power':
      for (const id of e.places) {
        const p = s.places[id];
        if (p) p.powered = e.on;
      }
      return;
    case 'place_mode': {
      const p = s.places[e.place];
      if (p) p.mode = e.mode;
      return;
    }
    case 'version_created':
      s.versions[e.version.id] = e.version;
      return;
    case 'news_published':
      s.news[e.news.id] = e.news;
      if (e.news.channels.includes('website') && !s.website.includes(e.news.id)) s.website.push(e.news.id);
      return;
    case 'board_posted': {
      const b = s.boards[e.board];
      if (b && !b.posters.includes(e.news)) b.posters.push(e.news);
      return;
    }
    case 'reached':
      mark(ag(s, e.agent), e.family, 'reached', e.t);
      return;
    case 'exposure': {
      const a = ag(s, e.agent);
      mark(a, e.family, 'reached', e.t);
      mark(a, e.family, 'exposed', e.t);
      const seen = (a.seen[e.family] ??= { count: 0, lastAt: e.t, headlines: [], bodies: [] });
      seen.count += 1;
      seen.lastAt = e.t;
      if (e.news && !seen.headlines.includes(e.news)) seen.headlines.push(e.news);
      if (e.attention.opened) {
        mark(a, e.family, 'attended', e.t);
        if (e.news && (e.fragment === 'body' || e.fragment === 'poster_full') && !seen.bodies.includes(e.news)) seen.bodies.push(e.news);
      }
      return;
    }
    case 'comprehended':
      // 理解必然以注意为前提：只扫了一眼标题但记住了内容，也算“注意到了”（漏斗逐层嵌套）
      if (e.extracted.length > 0) {
        mark(ag(s, e.agent), e.family, 'attended', e.t);
        mark(ag(s, e.agent), e.family, 'comprehended', e.t);
      }
      return;
    case 'belief_set': {
      const a = ag(s, e.agent);
      a.beliefs[e.family] = structuredClone(e.belief);
      if (e.belief.status === 'believe') mark(a, e.family, 'believed', e.t);
      const f = a.funnel[e.family];
      if (f && f.stop && f.stop !== 'no_change' && f.stop !== 'irrelevant' && e.belief.status === 'believe') {
        delete f.stop;
        delete f.stopReason;
      }
      return;
    }
    case 'funnel_stop': {
      const f = (ag(s, e.agent).funnel[e.family] ??= {});
      f.stop = e.stop;
      f.stopReason = e.reason;
      return;
    }
    case 'transmission': {
      const a = ag(s, e.tr.from);
      const told = (a.told[e.tr.familyId] ??= []);
      if (!told.includes(e.tr.to)) told.push(e.tr.to);
      mark(a, e.tr.familyId, 'relayed', e.t);
      return;
    }
    case 'dm_sent':
      s.dms[e.dm.id] = { ...e.dm };
      ag(s, e.dm.to).inbox.push(e.dm.id);
      return;
    case 'dm_read': {
      const dm = s.dms[e.dm];
      if (dm) dm.readAt = e.t;
      const a = ag(s, e.agent);
      a.inbox = a.inbox.filter((x) => x !== e.dm);
      return;
    }
    case 'push_pending': {
      const a = ag(s, e.agent);
      if (!a.pendingPush.includes(e.news)) a.pendingPush.push(e.news);
      return;
    }
    case 'push_cleared': {
      const a = ag(s, e.agent);
      a.pendingPush = a.pendingPush.filter((x) => x !== e.news);
      return;
    }
    case 'decision':
      if (e.phase === 'requested') {
        s.pending[e.id] = { agent: e.agent, kind: e.kind, commitAt: e.commitAt ?? e.t, provider: e.provider, ...(e.family ? { family: e.family } : {}) };
      } else {
        delete s.pending[e.id];
        ag(s, e.agent).dcount[`done:${e.kind}`] = (ag(s, e.agent).dcount[`done:${e.kind}`] ?? 0) + 1;
      }
      return;
    case 'inconvenience': {
      const a = ag(s, e.agent);
      for (const st of [a.stats, e.outage ? outageStats(a, e.outage) : undefined]) {
        if (!st) continue;
        st.inconvenience += 1;
        st.disruptedSec += e.seconds;
        if (!e.expected) {
          st.surprised += 1;
          st.surprisedSec += e.seconds;
        }
      }
      return;
    }
    case 'overreaction': {
      const a = ag(s, e.agent);
      a.stats.overreactSec += e.seconds;
      if (e.outage) outageStats(a, e.outage).overreactSec += e.seconds;
      return;
    }
    case 'trust_changed': {
      const a = ag(s, e.agent);
      if (e.target === 'gov') a.trustGov = e.to;
      else a.trustIn[e.target] = e.to;
      return;
    }
    case 'experience': {
      const a = ag(s, e.agent);
      a.memory = [...(a.memory ?? []), { outage: e.outage, kind: e.kind, text: e.text, t: e.t }];
      return;
    }
    case 'false_alarm':
      return;
    default: {
      const never: never = e;
      throw new Error(`未知事件 ${(never as DomainEvent).type}`);
    }
  }
}

function ag(s: WorldState, id: string): Agent {
  const a = s.agents[id];
  if (!a) throw new Error(`未知居民 ${id}`);
  return a;
}

function outageStats(a: Agent, outage: string): OutageStats {
  return (a.stats.byOutage[outage] ??= { inconvenience: 0, disruptedSec: 0, surprised: 0, surprisedSec: 0, overreactSec: 0 });
}

function leavePlace(s: WorldState, a: Agent): void {
  if (a.loc.k === 'in') {
    const p = s.places[a.loc.place];
    if (p) p.occupants = p.occupants.filter((x) => x !== a.id);
  }
}

function mark(a: Agent, family: string, stage: keyof Omit<FunnelState, 'stop' | 'stopReason'>, t: number): void {
  const f = (a.funnel[family] ??= {});
  if (f[stage] === undefined) f[stage] = t;
}

export function findItem(a: Agent, day: number, id: string): PlanItem | undefined {
  return a.plans[day]?.find((x) => x.id === id);
}

export function findItemAny(a: Agent, id: string): PlanItem | undefined {
  for (const items of Object.values(a.plans)) {
    const it = items.find((x) => x.id === id);
    if (it) return it;
  }
  return undefined;
}

export function applyAll(s: WorldState, events: DomainEvent[]): void {
  for (const e of events) applyEvent(s, e);
}
