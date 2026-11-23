// 微缩城介绍片的全部文字与数字。改完跑 `bash docs/video/build.sh` 重新配音、渲染。
// 浏览器（comp.html）与 Node（make_vo.mjs）读同一份。
(function (root) {
  // ════════════════════════════════════════════════════════════════════
  // NUMBERS：片子里出现的每一个数字都在这里（旁白与画面共用）。
  // 实验结果（results）是占位，等最终结果出来改这一块即可；
  // spoken 是旁白里念的说法，其余是画面上的数字。
  // ════════════════════════════════════════════════════════════════════
  const NUMBERS = {
    facts: {
      year: 2026, month: 9, // 由来：测试 Jev 的时间
      jevTownResidents: 50, // jev-town 的 AI 居民
      classicMin: 30, classicMax: 60, // 第一版小镇的人数
      reruns: '一百', // “重来一百遍”
      surveyYear: 2018, // 国家统计局时间利用调查
      communities: 4,
      seeds: 5, // 实验台：每个案例的种子数（画面小字）
    },
    results: {
      // 第三次运行（改进后的模型，每个种子换一批人）的最终数字
      rain: { case: '连下一周雨', metric: '老人每天聊天', before: '5.5', after: '3.2', unit: '次', spoken: '约四成', aloneBefore: '2%', aloneAfter: '7%' },
      rumor: { case: '“菜要涨价了”的传言', starters: 6, days: '九', reach: '八成', metric: '人均存粮', before: '5.9', after: '10.6', unit: '份', spoken: '八成', market: '约四分之一' },
      canteen: { case: '活动中心办起社区食堂', price: 9, metric: '饭馆营业额', spoken: '约一成半' },
      // 很小或站不住的
      rent: { case: '房租涨三成', effect: '饭馆的生意只少了约 2%', spokenEffect: '饭馆只少了约百分之二' },
      voucher: { case: '每户发 500 元', effect: '下馆子几乎没变', spoken: '每户发五百元' },
      layoff: { case: '车间裁员', effect: '上班的人心情反而没有变差', note: '模型还缺东西' },
      // 方法：每个案例的种子数；预注册假设的总数与三次运行都成立的条数
      method: { seeds: 5, runs: '三', hypotheses: 25, heldEveryRun: 12 },
    },
  };
  const F = NUMBERS.facts, R = NUMBERS.results;
  const cn = (n) => ({ 2: '二', 9: '九', 30: '三十', 50: '五十', 60: '六十' })[n] ?? String(n);
  const yearCn = (y) => String(y).split('').map((d) => '零一二三四五六七八九'[+d]).join('');

  // ════════════════════════════════════════════════════════════════════
  // 旁白：text 是字幕，read 是给 TTS 念的写法（只在两者不同时写）。
  // beat 是段落；gap 是这一句之前的停顿（秒），不写就用默认。
  // ════════════════════════════════════════════════════════════════════
  const LINES = [
    { id: 'o1', beat: 1, gap: 0.9, text: `${F.year} 年 ${F.month} 月，Jim 在测试 TypeSafe 的快思考模型 Jev。`, read: `${yearCn(F.year)}年${cn(F.month)}月，Jim 在测试 Type Safe 的快思考模型 Jev。` },
    { id: 'o2', beat: 1, text: '它不写文字，只回答选择题。' },
    { id: 'o3', beat: 1, text: `社区项目 jev-town，让 ${F.jevTownResidents} 个 AI 居民同时回应一条广播。`, read: `社区项目 Jev town，让${cn(F.jevTownResidents)}个 AI 居民同时回应一条广播。` },
    { id: 'o4', beat: 1, text: '由此冒出一个问题：社会能被模拟吗？' },
    { id: 'o5', beat: 1, text: `如果能，现实里又贵又慢、甚至做不了的社会实验，就能在微缩的社会里重来${F.reruns}遍，每次只改一个条件。` },
    { id: 'c1', beat: 2, gap: 0.7, text: `第一版是一座 ${F.classicMin} 到 ${F.classicMax} 人的小镇，和一张停电通知：谁先知道，信不信，又告诉了谁。`, read: `第一版是一座${cn(F.classicMin)}到${cn(F.classicMax)}人的小镇，和一张停电通知：谁先知道，信不信，又告诉了谁。` },
    { id: 'c2', beat: 2, text: '在这里重演了狼来了、知沟和传话游戏。' },
    { id: 'c3', beat: 2, text: '结论之一：漏报伤的是当下，虚报伤的是以后。' },
    { id: 'v1', beat: 3, gap: 0.9, text: '后来，它被重做成一个活的小社会。' },
    { id: 'v2', beat: 3, text: '每个居民都有工作和休息、家人朋友、兴趣、物品和钱包；' },
    { id: 'v3', beat: 3, text: '饿了吃饭，闷了出门，到点上班、接孩子。' },
    { id: 'v4', beat: 3, text: '模型不直接改世界，选择由写明的规则做出，每一次都能追问为什么。' },
    { id: 'v5', beat: 3, text: '点一个人，镜头就跟上去；进了屋，墙会让开，也能贴身看。' },
    { id: 'v6', beat: 3, text: '时间轴回放一整天，一分钟看完一天。' },
    { id: 'v7', beat: 3, text: `画像里有人口金字塔、人都在哪、钱从哪来到哪去；校准页对照国家统计局 ${F.surveyYear} 年的时间利用调查。`, read: `画像里有人口金字塔、人都在哪、钱从哪来到哪去；校准页对照国家统计局${yearCn(F.surveyYear)}年的时间利用调查。` },
    { id: 'v8', beat: 3, text: '实验台上，放一件事进去：菜市场关门、一条涨价传言、连日下雨。' },
    { id: 'v9', beat: 3, text: '同一个种子跑两遍，先猜，再看结果；' },
    { id: 'v10', beat: 3, text: '再找出日子过得最不一样的人，把同一天的两条世界线并排看。' },
    { id: 'v11', beat: 3, text: '老城街坊、通勤新小区、城中村、工厂镇，全部在浏览器里算，不需要服务器。' },
    { id: 'r1', beat: 4, gap: 0.8, text: `站得住的有几条：连下一周雨，老人每天聊天少了${R.rain.spoken}；` },
    { id: 'r2', beat: 4, text: `一条“菜要涨价了”的传言，${R.rumor.days}天里传到${R.rumor.reach}的人，家家户户的存粮多了${R.rumor.spoken}；` },
    { id: 'r3', beat: 4, text: `社区食堂，让饭馆的营业额少了${R.canteen.spoken}。` },
    { id: 'r4', beat: 4, gap: 0.5, text: `也有很小的：房租涨三成，饭馆只少了约 2%；每户发 500 元，下馆子几乎没变；`, read: `也有很小的：房租涨三成，${R.rent.spokenEffect}；${R.voucher.spoken}，下馆子几乎没变；` },
    { id: 'r5', beat: 4, text: `车间裁员之后，上班的人心情反而没有变差，说明${R.layoff.note}。` },
    { id: 'r6', beat: 4, gap: 0.6, text: '它不直接给答案，' },
    { id: 'r7', beat: 4, text: '而是在现实付出代价之前，先把你的直觉推翻一次。' },
  ];

  const END = { name: '微缩城', en: 'MicroCity', site: 'microcity.linjiejim.com', repo: 'github.com/linjiejim/microcity' };
  const data = { NUMBERS, LINES, END, DEFAULT_GAP: 0.32, LEAD: 0.6, TAIL: 4.2 };
  root.MC = data;
  if (typeof module === 'object' && module.exports) module.exports = data;
})(typeof window !== 'undefined' ? window : globalThis);
