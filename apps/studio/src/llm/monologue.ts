import { chat, type Deps } from './openrouter.ts';
import { loadPrefs } from './prefs.ts';

export const MONOLOGUE_TEMPLATE_VERSION = 'studio_monologue_v1';

export interface MonologueFacts {
  name: string;
  age: number;
  bio: string;
  /** 例如 “周三 18:42，晴” */
  when: string;
  /** 此刻在做什么、在哪 */
  doing: string;
  /** 为什么：选中的理由（用文字） */
  why: string[];
  /** 状态：例如 “有点饿”“很想找人说话” */
  feelings: string[];
  /** 今天发生的事（已经是一句一句的文字） */
  today: string[];
  /** 可以提到的人名 */
  names: string[];
}

const TIME_RE = /\d{1,2}[:：]\d{2}/g;
const NUM_RE = /\d+(?:\.\d+)?/g;

export function factText(f: MonologueFacts): string {
  return [`人物：${f.name}，${f.bio}`, `此刻：${f.when}，${f.doing}`, f.why.length ? `为什么：${f.why.join('；')}` : '', f.feelings.length ? `状态：${f.feelings.join('、')}` : '', f.today.length ? `今天：${f.today.join('；')}` : '']
    .filter(Boolean)
    .join('\n');
}

/** 独白只能复述事实表（沿用 v1 的原则）：不许多出时刻、数字、人名 */
export function validateMonologue(text: string, f: MonologueFacts, allNames: readonly string[]): string[] {
  const facts = factText(f);
  const problems: string[] = [];
  if (!text || text.length > 90) problems.push('长度不对');
  const times = new Set([...facts.matchAll(TIME_RE)].map((m) => m[0].replace('：', ':')));
  for (const m of text.matchAll(TIME_RE)) if (!times.has(m[0].replace('：', ':'))) problems.push(`多出的时刻 ${m[0]}`);
  const nums = new Set([...facts.replace(TIME_RE, ' ').matchAll(NUM_RE)].map((m) => String(Number(m[0]))));
  for (const m of text.replace(TIME_RE, ' ').matchAll(NUM_RE)) if (!nums.has(String(Number(m[0])))) problems.push(`多出的数字 ${m[0]}`);
  const allowed = new Set([f.name, ...f.names]);
  for (const n of allNames) if (!allowed.has(n) && text.includes(n)) problems.push(`提到了事实表里没有的人 ${n}`);
  return problems;
}

/** 不调用模型时的想法：直接用事实拼一句 */
export function templateThought(f: MonologueFacts): string {
  const feel = f.feelings[0] ? `${f.feelings[0]}。` : '';
  const why = f.why[0] ? `${f.why[0]}。` : '';
  return `${f.doing}。${feel}${why}`.slice(0, 88);
}

export type Monologue = { text: string; source: 'model' | 'cache' | 'template'; note?: string };

/**
 * 被跟随者的内心独白：语言模型把事实表改写成一两句第一人称的话。
 * 只供展示，不回写状态；没有密钥、超预算、校验不过时退回模板，并说明原因。
 */
export async function monologue(deps: Deps, f: MonologueFacts, allNames: readonly string[]): Promise<Monologue> {
  const prefs = loadPrefs(deps.kv);
  const res = await chat(deps, {
    model: prefs.languageModel,
    purpose: '内心独白',
    template: MONOLOGUE_TEMPLATE_VERSION,
    maxTokens: 160,
    temperature: 0.8,
    accept: (text) => validateMonologue(text, f, allNames).length === 0,
    messages: [
      { role: 'system', content: '你替一座微缩小社区里的一位居民写一两句内心独白：第一人称，口语，不超过 60 个字，可以带一点情绪。只能复述“事实”里的内容，不得新增时间、数字、地点、人物或原因。只输出这句独白本身，不要引号，不要解释。' },
      { role: 'user', content: `事实：\n${factText(f)}` },
    ],
  });
  if (res.ok) return { text: res.text, source: res.cached ? 'cache' : 'model' };
  const note = res.reason === 'rejected' ? `模型的回答没通过事实校验（${validateMonologue(res.detail, f, allNames).join('、') || '格式不对'}），改用模板` : res.detail;
  return { text: templateThought(f), source: 'template', note };
}
