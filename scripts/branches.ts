import { Engine, town30, branchScript, defaultManifest, parseTime, funnelMetrics, beliefCensus, outcomeMetrics, timeToShare, OUTAGE_FAMILY, OUTAGE_PUBLISH_AT, contentHash, at } from '@microcity/sim';
const seeds = (process.argv[2] ?? '42,7,2026').split(',').map(Number);
for (const seed of seeds) {
  const m = defaultManifest(seed, 'rule');
  const sc = town30();
  const base = Engine.create(sc, { seed, decisionMode: 'rule' });
  base.advance(parseTime(m.forkAt));
  const snap = base.snapshot();
  const forkHash = contentHash(snap.state);
  const rows: string[] = [];
  for (const [name, spec] of Object.entries(m.branches)) {
    const e = Engine.restore(snap, sc, { script: branchScript(sc, spec) });
    if (contentHash(e.state) !== forkHash) throw new Error('fork hash mismatch');
    e.advance(at(4, 14, 0));
    const census = beliefCensus(e.state, OUTAGE_FAMILY);
    e.advance(parseTime(m.until));
    const f = funnelMetrics(e.state, OUTAGE_FAMILY);
    const o = outcomeMetrics(e.state);
    const t50 = timeToShare(f, 0.5, OUTAGE_PUBLISH_AT);
    rows.push(`${name} ${spec.label.padEnd(18)} aware@14:00=${census.aware} allDay=${census.allDay} exact=${census.exact} | t50=${t50 === null ? '未达到' : (t50 / 3600).toFixed(1) + 'h'} believed=${f.stages.believed} intended=${f.stages.intended} acted=${f.stages.acted} | surprised=${o.surprisedItems}项/${o.surprisedPeople}人 (${o.surprisedMin}min) all=${o.inconvenienceItems} over=${o.overreactMin}min`);
  }
  console.log(`seed ${seed}  fork=${forkHash.slice(0, 10)}`);
  for (const r of rows) console.log('  ' + r);
}
