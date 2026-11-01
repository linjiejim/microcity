import { Engine, town30, checkInvariants, checkProvenance, totalMoney, funnelMetrics, beliefCensus, outcomeMetrics, OUTAGE_FAMILY, parseTime, formatTime, type DomainEvent, type DecisionRecord } from '@microcity/sim';
const sc = town30();
const t0 = performance.now();
const e = Engine.create(sc, { seed: 42, decisionMode: 'rule' });
const money0 = totalMoney(e.state);
const events: DomainEvent[] = [];
const recs: DecisionRecord[] = [];
e.onEvent((x) => events.push(x));
e.onRecord((r) => recs.push(r));
const until = parseTime(process.argv[2] ?? 'D04 20:00');
let viol = 0;
for (let t = e.now; t < until; t += 1800) {
  const r = e.advance(Math.min(until, t + 1800));
  if (r.blockedOn) throw new Error('blocked ' + r.blockedOn);
  const v = checkInvariants(e.state, e.map, money0);
  if (v.length) { viol += v.length; if (viol < 20) console.log(formatTime(e.now), v.slice(0, 5)); }
}
const ms = performance.now() - t0;
console.log(`events=${events.length} decisions=${recs.length} violations=${viol} time=${ms.toFixed(0)}ms`);
console.log('provenance', checkProvenance(events).slice(0, 5));
const byType: Record<string, number> = {};
for (const x of events) byType[x.type] = (byType[x.type] ?? 0) + 1;
console.log(byType);
console.log('funnel', funnelMetrics(e.state, OUTAGE_FAMILY));
const c = beliefCensus(e.state, OUTAGE_FAMILY); console.log('census', { ...c, holders: undefined });
console.log('outcome', outcomeMetrics(e.state));
for (const r of recs.slice(0, 40)) console.log(formatTime(r.t), r.agentName, r.kind, '→', r.chosen.join(','), r.commit.outcome, '|', r.candidates.map(x => `${x.id}:${r.probabilities[x.id]}`).join(' '));
