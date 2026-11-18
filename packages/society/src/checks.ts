import type { CommunityDef } from './model/def.ts';
import type { WorldState } from './model/state.ts';

/** 不变量：任何时刻都应成立。返回违反的条目（空数组表示通过）。 */
export function checkInvariants(def: CommunityDef, state: WorldState, total0: number): string[] {
  const bad: string[] = [];
  // 钱守恒（D67）
  let total = 0;
  for (const k in state.accounts) total += state.accounts[k]!;
  if (Math.abs(total - total0) > 0.5) bad.push(`钱不守恒：期初 ${total0.toFixed(2)}，现在 ${total.toFixed(2)}`);
  // 个人钱包不为负；库存与存粮不为负
  for (const p of def.people) if ((state.accounts[p.id] ?? 0) < -0.005) bad.push(`${p.name} 的钱包为负`);
  for (const f in state.stock) for (const item in state.stock[f]) if (state.stock[f]![item]! < -1e-6) bad.push(`${f} 的 ${item} 库存为负`);
  for (const h in state.households) if (state.households[h]!.food < -1e-6 || state.households[h]!.supplies < -1e-6) bad.push(`${h} 的存粮为负`);
  // 一个人只在一个地方；活动的地点与所在一致；需求在 0–1
  const seen = new Map<string, string>();
  for (const pl in state.here)
    for (const id of state.here[pl]!) {
      if (seen.has(id)) bad.push(`${id} 同时在 ${seen.get(id)} 和 ${pl}`);
      seen.set(id, pl);
    }
  for (const p of def.people) {
    const ps = state.people[p.id]!;
    if (ps.loc.k === 'in') {
      if (seen.get(p.id) !== ps.loc.place) bad.push(`${p.name} 的位置与地点名单不一致`);
      if (ps.act && ps.act.place !== ps.loc.place) bad.push(`${p.name} 的活动地点与所在不一致`);
    } else {
      if (seen.has(p.id)) bad.push(`${p.name} 在路上却还在某地的名单里`);
      if (ps.act) bad.push(`${p.name} 在路上却有活动`);
    }
    for (const v of ps.needs.v) if (!(v >= 0 && v <= 1)) bad.push(`${p.name} 的需求越界`);
  }
  // 一个站位只有一个人，且占位的人确实在那里做事
  for (const pl in state.occupied)
    for (const a in state.occupied[pl]) {
      const id = state.occupied[pl]![Number(a)]!;
      const act = state.people[id]?.act;
      if (!act || act.place !== pl || String(act.anchor) !== a) bad.push(`${pl} 的站位 ${a} 记着 ${id}，但对不上`);
    }
  return bad;
}

export function totalMoney(state: WorldState): number {
  let total = 0;
  for (const k in state.accounts) total += state.accounts[k]!;
  return total;
}
