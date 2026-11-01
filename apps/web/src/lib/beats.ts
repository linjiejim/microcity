import { PAL } from '../theme/palette.ts';
import type { Beat, BeatKind, BeatTone } from '@microcity/sim';
import type { IconName } from '../ui/icons.ts';

export const BEAT_ICON: Record<BeatKind, IconName> = {
  publish: 'news',
  clarify: 'news',
  first_exposure: 'eye',
  first_belief: 'bulb',
  milestone: 'check',
  first_relay: 'talk',
  rumor: 'rumor',
  distort: 'warn',
  change: 'list',
  service: 'org',
  outage: 'boltOff',
  restore: 'bolt',
  surprised: 'boltOff',
  trust: 'link',
  intervention: 'flag',
  belief: 'bulb',
  relay: 'talk',
  dm: 'dm',
  verify: 'search',
  blocked: 'cross',
  hit: 'boltOff',
  false_alarm: 'bolt',
};

export const TONE_COLOR: Record<BeatTone, string> = {
  info: 'var(--info)',
  good: 'var(--ok)',
  bad: 'var(--bad)',
  warn: 'var(--warn)',
  rumor: 'var(--rumor)',
  neutral: 'var(--fg-3)',
};
export const TONE_HEX: Record<BeatTone, string> = { info: PAL.info, good: PAL.ok, bad: PAL.bad, warn: PAL.warn, rumor: PAL.rumor, neutral: PAL.ink3 };

export type BeatFilter = 'all' | 'key' | 'spread' | 'decide' | 'impact';
const SPREAD = new Set<BeatKind>(['publish', 'clarify', 'first_exposure', 'first_belief', 'milestone', 'first_relay', 'rumor', 'distort', 'belief', 'relay', 'dm']);
const DECIDE = new Set<BeatKind>(['change', 'verify', 'blocked', 'service']);
const IMPACT = new Set<BeatKind>(['outage', 'restore', 'surprised', 'hit', 'trust', 'false_alarm']);

export function beatMatches(b: Beat, f: BeatFilter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'key':
      return b.level === 'key';
    case 'spread':
      return SPREAD.has(b.kind);
    case 'decide':
      return DECIDE.has(b.kind);
    case 'impact':
      return IMPACT.has(b.kind);
  }
}
