import { clamp01 } from '../core/rng.ts';
import { SHIFTS } from '../data/tables.ts';
import { householdAccount, type PersonDef } from '../model/def.ts';
import type { Engine } from '../engine/engine.ts';

/**
 * 预算感（D98）：一个人觉得手头紧不紧，以及钱让心里压着多少事。
 * 不只看钱包余额，还看余钱能撑几周、每周进来的钱减去房租水电买菜还剩多少、是不是刚丢了工作。
 * 这样房租涨了、被裁了，人立刻会省着花；发一笔钱，只是让余钱多撑几天。
 */
export interface Budget {
  /** 自己的钱包加上家里账户按人头的一份 */
  liquid: number;
  /** 余钱能撑几周 */
  runway: number;
  /** 家里每人每周可支配的收入（收入减去房租、水电、买菜） */
  disposable: number;
  /** 0–1：越大越省着花 */
  tight: number;
  /** 0–1 的心情上要扣掉的处境分 */
  stress: number;
}

/** 一个人每周大概进来多少钱 */
export function weeklyIncome(e: Engine, p: PersonDef): number {
  const ps = e.state.people[p.id]!;
  if (p.job && !ps.laidOff) return p.job.wage * (SHIFTS[p.job.shift]!.rest === 'weekend' ? 5 : 6);
  let monthly = p.pension;
  if (ps.laidOff) monthly += e.params.joblessAid;
  return (monthly * 7) / 30;
}

export function budgetOf(e: Engine, p: PersonDef, day: number): Budget {
  const P = e.params;
  const hh = e.hh(p);
  const n = hh.members.length;
  const fixed = hh.rentWeekly * e.rules.rentFactor(day) + P.utilitiesBase + P.utilitiesPer * n + P.foodWeekly * n;
  let income = 0;
  for (const id of hh.members) income += weeklyIncome(e, e.P[id]!);
  const liquid = e.balance(p.id) + e.balance(householdAccount(hh.id)) / n;
  const runway = liquid / (fixed / n + P.personalWeekly);
  const disposable = (income - fixed) / n;
  const laidOff = !!e.state.people[p.id]!.laidOff;
  const tight = clamp01(clamp01(1 - runway / P.runwayComfort) + P.incomeWeight * clamp01(1 - disposable / P.incomeRef) + (laidOff ? P.laidOffTight : 0));
  const stress = (laidOff ? P.stressJobless : 0) + P.stressBroke * clamp01(1 - runway / 2);
  return { liquid, runway, disposable, tight, stress };
}
