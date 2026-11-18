import { EXT, householdAccount } from '../model/def.ts';
import { describeIntervention, RUMORS } from '../model/intervention.ts';
import type { Engine } from '../engine/engine.ts';

/**
 * 干预到点时要做的事（D88）。
 * 有起止的干预（停业、调价、房租、开伙、天气）靠 Rules 的查询生效，这里只在时间轴上留个记号；
 * 一次性的（发钱、裁员、传言）在这里发事件。
 */
export function applyIntervention(e: Engine, index: number, phase: 'start' | 'end'): void {
  const iv = e.rules.list[index];
  if (!iv) return;
  const label = describeIntervention(iv, (ref) => e.rules.placeName(ref));
  e.emit({ type: 'intervention', index, kind: iv.kind, phase, label });
  if (phase === 'end') return;
  switch (iv.kind) {
    case 'grant':
      for (const h of e.def.households) if (!iv.households || iv.households.includes(h.type)) e.pay(EXT, householdAccount(h.id), iv.amount, 'grant', '发到家里的补贴');
      break;

    case 'layoff': {
      const place = e.rules.target(index);
      const firm = place ? e.firmAt(place) : undefined;
      if (!firm) break;
      // 店主不裁；其余的人按固定的顺序抽
      const staff = firm.staff.filter((id) => id !== firm.owner && !e.state.people[id]!.laidOff).sort((a, b) => e.rand('layoff', index, a) - e.rand('layoff', index, b));
      for (const id of staff.slice(0, Math.round(staff.length * iv.fraction))) e.emit({ type: 'laid_off', agent: id, firm: firm.id });
      e.forgetCommits();
      break;
    }

    case 'canteen': {
      // 开伙第一天先备好货，之后每天清晨补
      const place = e.rules.target(index);
      const firm = place ? e.firmAt(place) : undefined;
      const offer = place ? e.rules.canteenAt(place, iv.from) : undefined;
      if (!firm || !offer || firm.offers.some((o) => o.item === offer.item)) break;
      const have = e.state.stock[firm.id]?.[offer.item] ?? 0;
      if (have < offer.restockTo) {
        e.emit({ type: 'stock', holder: firm.id, item: offer.item, delta: offer.restockTo - have, memo: '食堂备货' });
        e.pay(firm.id, EXT, (offer.restockTo - have) * offer.price * offer.cost, 'restock', '食堂备货');
      }
      break;
    }

    case 'rumor': {
      if (!RUMORS[iv.topic]) break;
      const adults = e.def.people.filter((p) => p.age >= 18).sort((a, b) => e.rand('rumor-seed', index, a.id) - e.rand('rumor-seed', index, b.id));
      for (const p of adults.slice(0, iv.seeds)) if (e.state.people[p.id]!.heard[iv.topic] === undefined) e.emit({ type: 'heard', agent: p.id, topic: iv.topic });
      break;
    }

    default:
      break;
  }
}
