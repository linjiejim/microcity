import type { Agent, WorldState } from '@microcity/sim';
import type { KnowState } from '../theme/palette.ts';

/** 知情三态（与人物卡的阶段一致）：没接触 → 还不知道；接触了但没信（瞥见、怀疑、不信）→ 听说了；相信（含改了安排、照做了）→ 相信了 */
export function knowState(a: Agent, fam: string): KnowState {
  const f = a.funnel[fam];
  if (!f?.exposed) return 'unaware';
  const b = a.beliefs[fam];
  if (!b || b.status === 'disbelieve' || b.status === 'doubt') return 'heard';
  return 'believe';
}

/** 三态计数 */
export function knowCounts(s: WorldState, fam: string): Record<KnowState, number> {
  const out: Record<KnowState, number> = { unaware: 0, heard: 0, believe: 0 };
  for (const a of Object.values(s.agents)) out[knowState(a, fam)]++;
  return out;
}

export const KNOW_LABEL: Record<KnowState, string> = { unaware: '还不知道', heard: '听说了', believe: '相信了' };
