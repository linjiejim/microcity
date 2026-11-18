import { clock, dayOf, timeOfDay, weekday, NEEDS, NEED_LABEL, OCCUPATIONS, type NeedKey, type PersonDef, type TieKind, type Weather } from '@microcity/society';

export const fmtDay = (t: number): string => `第 ${dayOf(t)} 天 ${weekday(dayOf(t))}`;
export const fmtClock = (t: number): string => clock(Math.floor(t));
export const fmtMoney = (x: number): string => `¥${Math.round(x).toLocaleString('zh-CN')}`;
export const WEATHER_LABEL: Record<Weather, string> = { sun: '晴', cloud: '阴', rain: '雨' };
export const TIE_LABEL: Record<TieKind, string> = { family: '家人', partner: '伴侣', friend: '朋友', coworker: '同事', classmate: '同学', neighbor: '邻居', acquaintance: '熟人' };
export const STAGE_LABEL: Record<PersonDef['stage'], string> = { child: '小学生', student: '中学生', worker: '在职', homemaker: '持家', retired: '退休', jobless: '待业' };

export const roleOf = (p: PersonDef): string => (p.job ? OCCUPATIONS[p.job.occupation]!.label : STAGE_LABEL[p.stage]);

/** 决策记录里各项因子的说法 */
export const FACTOR_LABEL: Record<string, string> = {
  need: '此刻需要',
  like: '本来就喜欢',
  habit: '习惯的时段',
  company: '有熟人、同好在',
  travel: '路程',
  cost: '花费',
  weather: '天气',
  repeat: '今天做过了',
  late: '太晚了',
  base: '性格与惯性',
};

/** 把需求值说成一句感受；都不缺时返回空数组 */
export function feelings(n: readonly number[]): string[] {
  const words: Record<NeedKey, [string, string]> = { hunger: ['饿了', '有点饿'], energy: ['很困', '有点累'], social: ['很想找人说说话', '想找人聊聊'], fun: ['闷得慌', '有点闷'] };
  const out: string[] = [];
  NEEDS.forEach((k, i) => {
    const v = n[i] ?? 1;
    if (v < 0.2) out.push(words[k][0]);
    else if (v < 0.4) out.push(words[k][1]);
  });
  return out;
}

export { NEEDS, NEED_LABEL, timeOfDay };
