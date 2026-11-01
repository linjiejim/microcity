/**
 * 章节（spec v1 §2.6，D25）：把事件流合成“节拍”——一行一句的叙事。
 * key：章节条与报告用的关键时刻；feed：观察工作区“现场”用的逐人叙事（包含 key）。
 * 逐事件喂入（事件已应用到状态之后），前后端同构。聚合节拍（措手不及、信任变化）会被原地更新。
 */
import { clock, type SimTime } from '../core/time.ts';
import { describeSlots, windowLabel } from '../info/slots.ts';
import { CHANNEL_LABEL } from '../info/claims.ts';
import type { DomainEvent } from '../state/events.ts';
import { applyEvent } from '../state/reducer.ts';
import type { WorldState } from '../state/types.ts';
import { DISTRICT_LABEL } from '../world/map.ts';

export type BeatKind =
  | 'publish'
  | 'clarify'
  | 'first_exposure'
  | 'first_belief'
  | 'milestone'
  | 'first_relay'
  | 'rumor'
  | 'distort'
  | 'change'
  | 'service'
  | 'outage'
  | 'restore'
  | 'surprised'
  | 'trust'
  | 'intervention'
  | 'belief'
  | 'relay'
  | 'dm'
  | 'verify'
  | 'blocked'
  | 'hit'
  | 'false_alarm';

export type BeatTone = 'info' | 'good' | 'bad' | 'warn' | 'rumor' | 'neutral';

export interface Beat {
  id: string;
  seq: number;
  t: SimTime;
  kind: BeatKind;
  level: 'key' | 'feed';
  title: string;
  detail?: string;
  agents: string[];
  family?: string;
  tone: BeatTone;
  ref?: { decision?: string; version?: string; news?: string; outage?: string };
}

interface FamState {
  exposed: boolean;
  believed: Set<string>;
  milestones: Set<number>;
  relayed: boolean;
  firstChange: boolean;
  rumor: boolean;
  distort: boolean;
}

const MILESTONES = [0.25, 0.5, 0.75, 1];

export class ChronicleBuilder {
  private placeName: (id: string) => string;
  constructor(opts: { placeName?: (id: string) => string } = {}) {
    this.placeName = opts.placeName ?? ((id) => id);
  }
  private fams = new Map<string, FamState>();
  private surprised = new Map<string, Beat>();
  private trust = new Map<string, { beat: Beat; govUp: Set<string>; govDown: Set<string>; up: number; down: number }>();
  private seenBelief = new Set<string>();
  private services = new Set<string>();

  private fam(f: string): FamState {
    let x = this.fams.get(f);
    if (!x) {
      x = { exposed: false, believed: new Set(), milestones: new Set(), relayed: false, firstChange: false, rumor: false, distort: false };
      this.fams.set(f, x);
    }
    return x;
  }

  /** 喂入一个已应用到 s 的事件，返回新产生的节拍（聚合节拍被更新时也返回它） */
  push(e: DomainEvent, s: WorldState): Beat[] {
    const out: Beat[] = [];
    const name = (id?: string) => (id ? (s.agents[id]?.name ?? id) : '');
    const beat = (b: Omit<Beat, 'id' | 'seq' | 't'> & { t?: SimTime }): Beat => {
      const x: Beat = { id: `b${e.seq}_${out.length}`, seq: e.seq, t: b.t ?? e.t, ...b };
      out.push(x);
      return x;
    };
    const pop = Object.keys(s.agents).length;
    switch (e.type) {
      case 'news_published': {
        const n = e.news;
        const hv = s.versions[n.headline.versionId];
        beat({
          kind: n.correctionOf ? 'clarify' : 'publish',
          level: 'key',
          title: `${n.intervention ? '【干预】' : ''}${n.publisher.name}${n.correctionOf ? '发布澄清' : '发布'}《${n.headline.text}》`,
          detail: `渠道：${n.channels.map((c) => CHANNEL_LABEL[c]).join(' / ')}${hv ? `；只看标题的人会以为「${describeSlots(hv.slots)}」` : ''}`,
          agents: [],
          family: n.familyId,
          tone: 'info',
          ref: { news: n.id },
        });
        break;
      }
      case 'exposure': {
        const f = this.fam(e.family);
        if (!f.exposed) {
          f.exposed = true;
          beat({ kind: 'first_exposure', level: 'key', title: `${name(e.agent)} 第一个接触到这条消息（${CHANNEL_LABEL[e.channel]}）`, agents: [e.agent], family: e.family, tone: 'info' });
        }
        break;
      }
      case 'belief_set': {
        const f = this.fam(e.family);
        const b = e.belief;
        const k = `${e.agent}|${e.family}`;
        const firstTime = !this.seenBelief.has(k);
        this.seenBelief.add(k);
        const st = b.status === 'believe' ? '相信' : b.status === 'doubt' ? '将信将疑' : '不信';
        const src = b.sources[b.sources.length - 1];
        const via = src ? (src.from ? `听${name(src.from)}说` : CHANNEL_LABEL[src.channel]) : '';
        const allDay = b.slots.window?.kind === 'all_day';
        if (b.status === 'believe' && !f.believed.has(e.agent)) {
          f.believed.add(e.agent);
          if (f.believed.size === 1) beat({ kind: 'first_belief', level: 'key', title: `${name(e.agent)} 第一个相信：「${describeSlots(b.slots)}」`, detail: via, agents: [e.agent], family: e.family, tone: 'info' });
          for (const m of MILESTONES) {
            if (f.believed.size >= Math.ceil(pop * m) && !f.milestones.has(m)) {
              f.milestones.add(m);
              beat({ kind: 'milestone', level: 'key', title: m === 1 ? '全镇都相信了' : `${Math.round(m * 100)}% 的人相信了（${f.believed.size}/${pop}）`, agents: [e.agent], family: e.family, tone: 'good' });
            }
          }
        }
        if (firstTime || (e.prev && e.prev.status !== b.status) || (e.prev && e.prev.versionId !== b.versionId && e.reason.includes('时段'))) {
          beat({ kind: 'belief', level: 'feed', title: `${name(e.agent)} ${st}「${describeSlots(b.slots)}」`, detail: `${via}${via ? ' · ' : ''}置信 ${b.confidence}${e.prev ? `（之前 ${e.prev.confidence}）` : ''}`, agents: [e.agent], family: e.family, tone: allDay ? 'rumor' : b.status === 'believe' ? 'info' : 'neutral', ref: { version: b.versionId } });
        }
        break;
      }
      case 'version_created': {
        const v = e.version;
        if (v.origin.kind !== 'relay') break;
        const f = this.fam(v.familyId);
        const fill = v.mutations.find((m) => m.op === 'fill_worst_case');
        const coarse = v.mutations.find((m) => m.slot === 'window' && (m.op === 'coarsen' || m.op === 'drop'));
        if (fill) {
          const first = !f.rumor;
          f.rumor = true;
          beat({ kind: 'rumor', level: first ? 'key' : 'feed', title: `${first ? '谣言出现：' : ''}${name(v.origin.by)} 把时段往最坏处补成了“全天”`, detail: `「${describeSlots(v.slots)}」 · 焦虑 ${fill.because.anxiety ?? ''}`, agents: [v.origin.by], family: v.familyId, tone: 'rumor', ref: { version: v.id } });
        } else if (coarse && !f.distort) {
          f.distort = true;
          const from = coarse.from as Parameters<typeof windowLabel>[0];
          beat({ kind: 'distort', level: 'key', title: `${name(v.origin.by)} 转述时把「${windowLabel(from)}」${coarse.op === 'drop' ? '漏掉了' : `说成了「${windowLabel(v.slots.window)}」`}`, detail: `细节从这里开始走样`, agents: [v.origin.by], family: v.familyId, tone: 'warn', ref: { version: v.id } });
        }
        break;
      }
      case 'transmission': {
        const f = this.fam(e.tr.familyId);
        const v = s.versions[e.tr.versionId];
        if (!f.relayed) {
          f.relayed = true;
          beat({ kind: 'first_relay', level: 'key', title: `${name(e.tr.from)} 第一次把消息告诉别人（→ ${name(e.tr.to)}）`, detail: v ? `「${describeSlots(v.slots)}」 · ${CHANNEL_LABEL[e.tr.channel]}` : undefined, agents: [e.tr.from, e.tr.to], family: e.tr.familyId, tone: 'info' });
        } else if (e.tr.channel !== 'dm') {
          beat({ kind: 'relay', level: 'feed', title: `${name(e.tr.from)} → ${name(e.tr.to)}：「${v ? describeSlots(v.slots) : ''}」`, detail: CHANNEL_LABEL[e.tr.channel], agents: [e.tr.from, e.tr.to], family: e.tr.familyId, tone: v?.slots.window?.kind === 'all_day' ? 'rumor' : 'neutral', ref: { version: e.tr.versionId } });
        }
        break;
      }
      case 'dm_sent': {
        const v = s.versions[e.dm.versionId];
        beat({ kind: 'dm', level: 'feed', title: `${name(e.dm.from)} 给 ${name(e.dm.to)} 发私信提醒`, detail: v ? `「${describeSlots(v.slots)}」` : undefined, agents: [e.dm.from, e.dm.to], family: e.dm.familyId, tone: 'info', ...(e.dm.decisionId ? { ref: { decision: e.dm.decisionId } } : {}) });
        break;
      }
      case 'decision': {
        if (e.phase !== 'committed' || e.kind !== 'reaction') break;
        const chosen = e.chosen ?? '';
        if (chosen === 'keep' || chosen === '') break;
        if (chosen === 'verify') {
          beat({ kind: 'verify', level: 'feed', title: `${name(e.agent)} 上网查证具体时间`, agents: [e.agent], ...(e.family ? { family: e.family } : {}), tone: 'neutral', ref: { decision: e.id } });
          break;
        }
        if (e.outcome === 'invalidated') break;
        const f = e.family ? this.fam(e.family) : undefined;
        const first = !!f && !f.firstChange;
        if (f) f.firstChange = true;
        beat({ kind: 'change', level: first ? 'key' : 'feed', title: `${name(e.agent)} ${first ? '第一个' : ''}改了安排：${e.chosenLabel ?? chosen}`, agents: [e.agent], ...(e.family ? { family: e.family } : {}), tone: 'info', ref: { decision: e.id } });
        break;
      }
      case 'funnel_stop':
        if (e.stop === 'blocked') beat({ kind: 'blocked', level: 'feed', title: `${name(e.agent)} 有意但受阻`, detail: e.reason, agents: [e.agent], family: e.family, tone: 'warn' });
        break;
      case 'place_mode': {
        if (e.mode.kind === 'normal') break;
        const p = e.place;
        const label = e.mode.kind === 'cold_menu' ? '改卖冷饮点心' : '暂停营业';
        const sk = `${p}|${e.mode.kind}|${e.mode.from}|${e.mode.to}`;
        const again = this.services.has(sk);
        this.services.add(sk);
        beat({ kind: 'service', level: again ? 'feed' : 'key', title: `${this.placeName(p)}${label} ${clock(e.mode.from)}–${clock(e.mode.to)}`, detail: `${name(e.mode.by)} 的决定`, agents: [e.mode.by], tone: 'warn', ...(e.decisionId ? { ref: { decision: e.decisionId } } : {}) });
        break;
      }
      case 'plan_set':
        if (e.reason === 'org' && e.note === 'relocate_team') beat({ kind: 'service', level: 'feed', title: `${name(e.agent)} 随团队换地方办公`, agents: [e.agent], tone: 'neutral', ...(e.decisionId ? { ref: { decision: e.decisionId } } : {}) });
        break;
      case 'power':
        beat({ kind: e.on ? 'restore' : 'outage', level: 'key', title: `${DISTRICT_LABEL[e.area]}${e.on ? '恢复供电' : '停电了'}`, agents: [], tone: e.on ? 'good' : 'bad', ...(e.outage ? { ref: { outage: e.outage } } : {}) });
        break;
      case 'false_alarm':
        beat({ kind: 'false_alarm', level: 'key', title: `虚惊一场：${DISTRICT_LABEL[e.area]}的电一直没断`, agents: [], tone: 'warn', ref: { outage: e.outage } });
        break;
      case 'inconvenience': {
        beat({ kind: 'hit', level: 'feed', title: `${name(e.agent)} 被停电影响：${e.reason}`, detail: `${this.placeName(e.place)} · ${Math.round(e.seconds / 60)} 分钟`, agents: [e.agent], tone: e.expected ? 'warn' : 'bad', ...(e.outage ? { ref: { outage: e.outage } } : {}) });
        if (!e.expected) {
          const key = e.outage ?? 'x';
          const agg = this.surprised.get(key);
          if (!agg) {
            const b = beat({ kind: 'surprised', level: 'key', title: `${name(e.agent)} 被停电打了个措手不及`, agents: [e.agent], tone: 'bad', ...(e.outage ? { ref: { outage: e.outage } } : {}) });
            this.surprised.set(key, b);
          } else if (!agg.agents.includes(e.agent)) {
            agg.agents.push(e.agent);
            agg.title = `${agg.agents.length} 人被停电打了个措手不及`;
            agg.detail = agg.agents.map((a) => name(a)).join('、');
            out.push(agg);
          }
        }
        break;
      }
      case 'trust_changed': {
        const key = e.outage ?? 'x';
        let agg = this.trust.get(key);
        if (!agg) {
          const b = beat({ kind: 'trust', level: 'key', title: '真相大白后，人们调整了信任', agents: [], tone: 'warn', ...(e.outage ? { ref: { outage: e.outage } } : {}) });
          agg = { beat: b, govUp: new Set(), govDown: new Set(), up: 0, down: 0 };
          this.trust.set(key, agg);
        } else out.push(agg.beat);
        if (e.target === 'gov') (e.to > e.from ? agg.govUp : agg.govDown).add(e.agent);
        else if (e.to > e.from) agg.up++;
        else agg.down++;
        agg.beat.title = `真相大白：${agg.govUp.size} 人更信官方、${agg.govDown.size} 人更不信；人际信任 ${agg.up} 升 ${agg.down} 降`;
        if (!agg.beat.agents.includes(e.agent)) agg.beat.agents.push(e.agent);
        break;
      }
      case 'intervention':
        if (e.by === 'admin') beat({ kind: 'intervention', level: 'key', title: `管理员干预：${e.note}`, agents: [], tone: 'rumor' });
        break;
      default:
        break;
    }
    return out;
  }
}

/** 对完整事件日志重放，得到全部节拍（服务端用） */
export function chronicle(initial: WorldState, events: DomainEvent[], opts: { level?: 'key' | 'feed'; placeName?: (id: string) => string } = {}): Beat[] {
  const level = opts.level ?? 'key';
  const s = structuredClone(initial);
  const b = new ChronicleBuilder(opts.placeName ? { placeName: opts.placeName } : {});
  const all = new Map<string, Beat>();
  for (const e of events) {
    applyEvent(s, e);
    for (const x of b.push(e, s)) all.set(x.id, x);
  }
  return [...all.values()].filter((x) => level === 'feed' || x.level === 'key').sort((x, y) => x.seq - y.seq || x.id.localeCompare(y.id));
}
