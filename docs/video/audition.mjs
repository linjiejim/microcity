// 试音：几个嗓音念同样的几句，写到 .work/audition/<lang>/<voice>.mp3，再用 audition_report.py 量语速与音高起伏。
//   node docs/video/audition.mjs zh o1,o5,r7 "voiceA,voiceB"
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { synth } from './minimax.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const [lang = 'zh', ids = 'o1,o5,r7', voices = ''] = process.argv.slice(2);
const ctx = {};
vm.runInNewContext(readFileSync(resolve(HERE, 'content.js'), 'utf8'), ctx);
const LINES = lang === 'en' ? ctx.MC.LINES_EN : ctx.MC.LINES;
const text = ids.split(',').map((id) => { const L = LINES.find((x) => x.id === id); return L.read ?? L.text; }).join(lang === 'en' ? ' ' : '');
const out = resolve(HERE, `.work/audition/${lang}`);
mkdirSync(out, { recursive: true });
const rs = await Promise.allSettled(voices.split(',').filter(Boolean).map(async (v) => {
  const safe = v.replace(/[^\w-]+/g, '_');
  const d = await synth({ text, voice: v, out: `${out}/${safe}.mp3`, lang });
  console.log(safe.padEnd(44), d.toFixed(2), 's');
}));
rs.forEach((r, i) => r.status === 'rejected' && console.log(voices.split(',').filter(Boolean)[i].padEnd(44), '✗', r.reason.message));
