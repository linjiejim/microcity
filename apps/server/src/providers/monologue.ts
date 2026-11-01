import { CARD_STAGE_TEXT, MOOD_TEXT, type Agent, type PersonCard } from '@microcity/sim';
import { hasModelAccess } from '../config.ts';
import type { ChatClient } from './chat.ts';

export const MONOLOGUE_TEMPLATE_VERSION = 'monologue_tpl_v2';

const TIME_RE = /\d{1,2}[:：]\d{2}/g;
const NUM_RE = /\d+(?:\.\d+)?/g;
const SPOKEN_TIME_RE = /[0-9一二三四五六七八九十两]+\s*点/;

/** 独白只能复述画像里的事实：不许新的时刻、数字，不许凭空的“全天”、口语钟点 */
export function validateMonologue(text: string, facts: string): string[] {
  const p: string[] = [];
  if (!text || text.length > 120) p.push('长度不对');
  const times = new Set([...facts.matchAll(TIME_RE)].map((m) => m[0].replace('：', ':')));
  for (const m of text.matchAll(TIME_RE)) if (!times.has(m[0].replace('：', ':'))) p.push(`多出的时刻 ${m[0]}`);
  const nums = new Set([...facts.replace(TIME_RE, ' ').matchAll(NUM_RE)].map((m) => String(Number(m[0]))));
  for (const m of text.replace(TIME_RE, ' ').matchAll(NUM_RE)) if (!nums.has(String(Number(m[0])))) p.push(`多出的数字 ${m[0]}`);
  if (times.size === 0 && SPOKEN_TIME_RE.test(text)) p.push('凭空说出钟点');
  if (/全天|一整天|整天/.test(text) && !/全天|一整天/.test(facts)) p.push('凭空出现“全天”');
  return p;
}

/**
 * “用他的口吻说”（spec v1 §2.6，D26）：DeepSeek 把画像里的事实改写成一两句内心独白。
 * 只供展示，不回写状态；校验失败或离线时返回模板想法。
 */
export async function monologue(chat: ChatClient, runId: string, a: Agent, card: PersonCard, when: string): Promise<{ text: string; source: 'model' | 'template'; model: string; problems?: string[] }> {
  const facts = [
    `此刻：${when}，${card.activity}`,
    `阶段：${CARD_STAGE_TEXT[card.stage]}`,
    card.belief ? `相信：「${card.belief.text}」（${card.belief.via}）` : '还没形成看法',
    card.changes.length ? `改了安排：${card.changes.join('、')}` : '',
    card.told ? `告诉了 ${card.told} 个人` : '',
    card.surprised ? '停电时措手不及' : '',
    card.overreactMin ? `多挪了 ${card.overreactMin} 分钟的安排` : '',
    Math.abs(card.trustGov - card.trustGov0) >= 0.005 ? `对官方通知的信任${card.trustGov > card.trustGov0 ? '上升' : '下降'}了` : '',
    ...card.trustShifts.map((x) => `对${x.name}的信任${x.to > x.from ? '上升' : '下降'}了`),
    `心情：${MOOD_TEXT[card.thought.mood]}`,
    `模板想法（只作参考，不要照抄）：${card.thought.text}`,
  ].filter(Boolean);
  const factText = facts.join('\n');
  if (!hasModelAccess()) return { text: card.thought.text, source: 'template', model: 'template' };
  const res = await chat.json<{ text?: unknown }>({
    runId,
    purpose: 'monologue',
    tpl: MONOLOGUE_TEMPLATE_VERSION,
    temperature: 0.7,
    maxTokens: 200,
    accept: (d) => typeof d.text === 'string' && validateMonologue(d.text.trim(), factText).length === 0,
    messages: [
      {
        role: 'system',
        content:
          '你替像素小镇里的一位居民写一两句内心独白（第一人称，口语，≤60 字）。要用他自己的说话风格重新说，不要照抄“模板想法”；可以带一点情绪。只能复述“事实”里的内容，不得新增时间、数字、地点、人物或原因。只输出 JSON：{"text":"..."}',
      },
      { role: 'user', content: JSON.stringify({ 人物: { 姓名: a.name, 年龄: a.age, 身份: a.roleLabel, 说话风格: a.speech, 小传: a.bio }, 事实: facts }) },
    ],
  });
  if (!res.ok || typeof res.data.text !== 'string') return { text: card.thought.text, source: 'template', model: 'template', problems: [res.ok ? '格式不对' : res.error] };
  const text = res.data.text.trim();
  const problems = validateMonologue(text, factText);
  if (problems.length) return { text: card.thought.text, source: 'template', model: 'template', problems };
  return { text, source: 'model', model: res.model };
}
