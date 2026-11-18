import { EXT, householdAccount } from '../model/def.ts';
import type { Engine } from '../engine/engine.ts';
import { GOODS_LABEL, OCCUPATIONS } from '../data/tables.ts';

/**
 * 经济：进货与拨款（每天）、房租水电零花钱（每周一）、发薪与分红（每周五）、养老金（每月）。
 * 钱守恒（D67）：社区外的收支都记在外部账户上。
 */

/** 每天清晨：财政拨款、外地货款到账；店铺把货补满 */
export function restock(e: Engine): void {
  for (const f of e.def.firms) {
    if (f.externalDaily > 0) e.pay(EXT, f.id, f.externalDaily, 'grant', f.kind === 'public' ? '财政拨款' : '外地货款');
    for (const o of f.offers) {
      const qty = Math.floor(o.restockTo - (e.state.stock[f.id]?.[o.item] ?? 0));
      if (qty <= 0) continue;
      e.emit({ type: 'stock', holder: f.id, item: o.item, delta: qty, memo: '进货' });
      e.pay(f.id, EXT, qty * o.price * o.cost, 'restock', `进货：${GOODS_LABEL[o.item] ?? o.item} × ${qty}`);
    }
  }
}

/** 每周一：房租、水电、孩子的零花钱；家里钱紧时，手头宽裕的大人再补一点 */
export function weekly(e: Engine): void {
  for (const h of e.def.households) {
    const acc = householdAccount(h.id);
    if (h.rentWeekly > 0) e.pay(acc, EXT, h.rentWeekly, 'rent', '房租');
    e.pay(acc, EXT, e.params.utilitiesBase + e.params.utilitiesPer * h.members.length, 'utilities', '水电燃气');
    for (const m of h.members) {
      const p = e.P[m]!;
      if (p.age < 18) e.pay(acc, m, p.age < 13 ? e.params.allowance : e.params.allowance * 2, 'allowance', '零花钱');
    }
    if (e.balance(acc) < 800)
      for (const m of h.members) {
        const p = e.P[m]!;
        if (p.age >= 18 && e.balance(m) > 1500) e.pay(m, acc, (e.balance(m) - 1500) * 0.5, 'family', '补贴家用');
      }
  }
}

/** 每周五傍晚：按本周出勤天数发薪；店主提走超出备用金的一部分；各人把一部分交给家里 */
export function payroll(e: Engine): void {
  for (const p of e.def.people) {
    if (!p.job) continue;
    const days = e.state.people[p.id]!.workedDays;
    if (days <= 0) continue;
    const amount = p.job.wage * days;
    e.pay(p.job.firm === 'city' ? EXT : p.job.firm, p.id, amount, 'wage', `${OCCUPATIONS[p.job.occupation]!.label}，${days} 天`);
    e.pay(p.id, householdAccount(p.household), amount * e.params.shareWorker, 'family', '交给家里');
  }
  for (const f of e.def.firms) {
    if (f.kind !== 'private' || !f.owner) continue;
    const extra = e.balance(f.id) - f.cash;
    if (extra <= 0) continue;
    const draw = Math.floor(extra * e.params.profitDraw);
    e.pay(f.id, f.owner, draw, 'profit', `${f.name}的利润`);
    e.pay(f.owner, householdAccount(e.P[f.owner]!.household), draw * e.params.shareWorker, 'family', '交给家里');
  }
}

/** 每月：养老金与补助 */
export function pensions(e: Engine): void {
  for (const p of e.def.people) {
    if (p.pension <= 0) continue;
    e.pay(EXT, p.id, p.pension, 'pension', p.stage === 'retired' ? '养老金' : '补助');
    e.pay(p.id, householdAccount(p.household), p.pension * e.params.sharePension, 'family', '交给家里');
  }
}
