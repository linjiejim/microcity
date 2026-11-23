// MiniMax 语音合成（T2A v2）。密钥只从环境变量 MINIMAX_API_KEY 读，从不打印、不写进任何文件。
// 作者的密钥是中国站的（api.minimaxi.com）；国际站用 MINIMAX_HOST=https://api.minimax.io。
import { writeFileSync } from 'node:fs';

const HOST = process.env.MINIMAX_HOST ?? 'https://api.minimaxi.com';
export const MODEL = process.env.MINIMAX_MODEL ?? 'speech-2.8-hd';

// 多音字：念错过或容易念错的词，按 MiniMax 的格式写拼音（声调 1–5）
export const TONES = {
  zh: ['重来/(chong2)(lai2)', '重做/(chong2)(zuo4)', '重演/(chong2)(yan3)'],
  en: [],
};

/**
 * 念一段话，写出 mp3，返回时长（秒）。
 * @param {{ text: string, voice: string, out: string, lang?: 'zh'|'en', speed?: number, pitch?: number, emotion?: string }} o
 */
export async function synth({ text, voice, out, lang = 'zh', speed = 1, pitch = 0, emotion }) {
  const key = (process.env.MINIMAX_API_KEY ?? '').trim();
  if (!key) throw new Error('缺 MINIMAX_API_KEY（只从环境变量读）');
  const vs = { voice_id: voice, speed, vol: 1, pitch };
  if (emotion) vs.emotion = emotion;
  const body = {
    model: MODEL, text, stream: false, output_format: 'hex',
    language_boost: lang === 'zh' ? 'Chinese' : 'English',
    voice_setting: vs,
    audio_setting: { sample_rate: 44100, bitrate: 128000, format: 'mp3', channel: 1 },
  };
  if (TONES[lang]?.length) body.pronunciation_dict = { tone: TONES[lang] };
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(`${HOST}/v1/t2a_v2`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      if (attempt < 2) continue;
      throw new Error('MiniMax 网络请求失败（细节不打印）');
    }
    if (res.status >= 500 && attempt < 2) continue;
    break;
  }
  if (!res.ok) throw new Error(`MiniMax HTTP ${res.status}`);
  const js = await res.json();
  const code = js.base_resp?.status_code ?? 0;
  if (code !== 0) throw new Error(`MiniMax status ${code} ${js.base_resp?.status_msg ?? ''}`);
  writeFileSync(out, Buffer.from(js.data.audio, 'hex'));
  return (js.extra_info?.audio_length ?? 0) / 1000;
}
