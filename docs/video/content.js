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
      reruns: '一百', rerunsN: 100, // “重来一百遍”（念的 / 画面上的）
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
    { id: 'o1', beat: 1, gap: 0.9, text: `${F.year} 年 ${F.month} 月，我在测试快思考模型 Jev：它不写文字，只答选择题。`, read: `${yearCn(F.year)}年${cn(F.month)}月，我在测试快思考模型 Jev：它不写文字，只答选择题。` },
    { id: 'o3', beat: 1, text: `社区里有个项目 jev-town，让 ${F.jevTownResidents} 个 AI 居民同时回应一条广播。`, read: `社区里有个项目 Jev town，让${cn(F.jevTownResidents)}个 AI 居民同时回应一条广播。` },
    { id: 'o4', beat: 1, text: '我想知道：社会，能被模拟吗？' },
    { id: 'o5', beat: 1, text: `如果能，现实里又贵又慢、做不了的实验，就能在这里重来${F.reruns}遍，每次只改一个条件。` },
    { id: 'c1', beat: 2, gap: 0.6, text: '我做的第一版：一座小镇，一张停电通知，谁先知道、信不信、告诉了谁。' },
    { id: 'c2', beat: 2, text: '它重演了狼来了、知沟、传话游戏。' },
    { id: 'c3', beat: 2, text: '漏报伤的是当下，虚报伤的是以后。' },
    { id: 'v1', beat: 3, gap: 0.8, text: '后来，我把它重做成一个活的小社会。' },
    { id: 'v2', beat: 3, text: '每个居民有工作和休息、家人朋友、兴趣、物品、钱包；' },
    { id: 'v3', beat: 3, text: '饿了吃饭，闷了出门，到点上班、接孩子。' },
    { id: 'v4', beat: 3, text: '模型不直接改世界，选择由写明的规则做出，每一次都能问为什么。' },
    { id: 'v5', beat: 3, text: '点一个人就跟上去，进屋墙会让开，也能贴身看；' },
    { id: 'v6', beat: 3, gap: 0.2, text: '一分钟看完一天。' },
    { id: 'v7', beat: 3, text: `画像看人口、去处和钱的流向，校准对照统计局 ${F.surveyYear} 年的时间利用调查。`, read: `画像看人口、去处和钱的流向，校准对照统计局${yearCn(F.surveyYear)}年的时间利用调查。` },
    { id: 'v8', beat: 3, text: '实验台上放一件事：菜市场关门、涨价传言、连日下雨，' },
    { id: 'v9', beat: 3, text: '同一个种子跑两遍，先猜再看；' },
    { id: 'v10', beat: 3, text: '找出日子过得最不一样的人，两条世界线并排看。' },
    { id: 'v11', beat: 3, text: `${F.communities} 种社区，都在浏览器里算，不需要服务器。`, read: `四种社区，都在浏览器里算，不需要服务器。` },
    { id: 'r1', beat: 4, gap: 0.7, text: `站得住的：连下一周雨，老人聊天少了${R.rain.spoken}；` },
    { id: 'r2', beat: 4, text: `涨价传言${R.rumor.days}天传到${R.rumor.reach}的人，存粮多了${R.rumor.spoken}；` },
    { id: 'r3', beat: 4, text: `社区食堂让饭馆营业额少了${R.canteen.spoken}。` },
    { id: 'r4', beat: 4, gap: 0.45, text: '很小的：房租涨三成，饭馆只少约 2%；发 500 元，下馆子几乎没变；', read: `很小的：房租涨三成，饭馆只少约百分之二；发五百元，下馆子几乎没变；` },
    { id: 'r5', beat: 4, text: `裁员后，上班的人心情没变差：${R.layoff.note}。` },
    { id: 'r6', beat: 4, gap: 0.55, text: '它不直接给答案，' },
    { id: 'r7', beat: 4, text: '而是在现实付出代价之前，先把你的直觉推翻一次。' },
  ];

  // ════════════════════════════════════════════════════════════════════
  // 英文版（comp.html?lang=en）：同一个片子，换旁白、字幕和画面上的字。
  // 每句的 id 与中文一一对应；k 是“意思相同的词”（中文词 → 英文词），
  // 画面按这些词把中文时间线映射到英文旁白上（句子的起止总是对齐的）。
  // 英文用美式拼写，不用破折号；数字与落地页、实验记录一致。
  // ════════════════════════════════════════════════════════════════════
  const LINES_EN = [
    { id: 'o1', text: 'In September 2026, I was testing Jev, a fast-thinking model that only answers multiple-choice questions.', k: { 测试: 'testing', 只答: 'only answers' } },
    { id: 'o3', text: `In a community project, jev-town, ${F.jevTownResidents} AI residents answered one broadcast at once.`, read: 'In a community project, Jev town, fifty AI residents answered one broadcast at once.', k: { 同时: 'answered' } },
    { id: 'o4', text: 'I wondered: can a society be simulated?', k: { 社会: 'can a society' } },
    { id: 'o5', text: 'If so, experiments too costly, slow or impossible in real life could run a hundred times here, one change at a time.', k: { 就能: 'could run', 每次只改: 'one change' } },
    { id: 'c1', text: 'My first version: a small town and a power-outage notice. Who hears first, who believes, who tells whom.', k: { 一张停电通知: 'a power-outage', 谁先知道: 'Who hears' } },
    { id: 'c2', text: 'It replayed crying wolf, the knowledge gap and the telephone game.', k: { 狼来了: 'crying wolf', 知沟: 'the knowledge', 传话游戏: 'the telephone' } },
    { id: 'c3', text: 'Missed warnings hurt the present; false alarms hurt the future.', k: { 虚报: 'false alarms' } },
    { id: 'v1', text: 'Later, I rebuilt it as a living little society.' },
    { id: 'v2', text: 'Every resident has work and rest, family and friends, hobbies, belongings and a wallet.', k: { 工作: 'work', 兴趣: 'hobbies', 钱包: 'wallet' } },
    { id: 'v3', text: 'They eat when hungry, go out when bored, and head off to work or school pickup.', k: { 闷了: 'go out', 到点: 'head off' } },
    { id: 'v4', text: 'Models never change the world directly. Written rules make each choice, and you can always ask why.', k: { 问为什么: 'ask why' } },
    { id: 'v5', text: 'Click someone to follow. Indoors, walls step aside; or ride along up close.', k: { 进屋: 'Indoors', 贴身: 'ride along' } },
    { id: 'v6', text: 'A day in a minute.' },
    { id: 'v7', text: `Portraits show population, where people go and where money flows, calibrated against China's ${F.surveyYear} time-use survey.`, k: { 校准: 'calibrated' } },
    { id: 'v8', text: 'In the lab, drop in one event: the market closes, a price rumor, days of rain.', k: { 菜市场: 'the market', 涨价传言: 'a price rumor', 连日下雨: 'days of rain' } },
    { id: 'v9', text: 'Run the same seed twice. Guess first, then look.', k: { 先猜: 'Guess', 再看: 'then look' } },
    { id: 'v10', text: 'Find whose days changed most, and watch both timelines side by side.', k: { 两条: 'both timelines' } },
    { id: 'v11', text: 'Four kinds of community, all computed in your browser. No server needed.', k: { 都在: 'all computed', 不需要: 'No server' } },
    { id: 'r1', text: "What held up: a week of rain cut older people's chats by about 40%.", k: { 少了: 'by about' } },
    { id: 'r2', text: 'A price rumor reached 80% of people in nine days; food stored at home rose 80%.', k: { 存粮: 'food stored' } },
    { id: 'r3', text: 'A community canteen cut restaurant takings by about 15%.', k: { 少了: 'by about' } },
    { id: 'r4', text: 'Small effects: a 30% rent rise cost restaurants only about 2%; a 500-yuan grant barely changed eating out.', k: { 发: 'a 500' } },
    { id: 'r5', text: "After layoffs, workers' mood didn't drop. The model is missing something." },
    { id: 'r6', text: "It doesn't hand you answers." },
    { id: 'r7', text: 'Instead, before reality makes you pay, it proves your intuition wrong.', k: { 推翻: 'proves' } },
  ];

  // 画面上的字：中文原文 → 英文（comp.html 的 text / chip / measure 在 ?lang=en 时查这张表）
  const rain = R.rain, rum = R.rumor, can = R.canteen, M = R.method;
  const UI_EN = {
    // 1 · 由来
    照常出门: 'Go out as usual', 先问问邻居: 'Ask a neighbor first', 改天再去: 'Go another day', 告诉家人: 'Tell the family',
    'TypeSafe 的快思考模型': "TypeSafe's fast-thinking model",
    '听到这条广播，你会怎么做？': 'You hear this broadcast. What do you do?',
    只回答选择题: 'Multiple choice only',
    [`jev-town · ${F.jevTownResidents} 个 AI 居民`]: `jev-town · ${F.jevTownResidents} AI residents`,
    '社会，能被模拟吗？': 'Can a society be simulated?',
    只改一个条件: 'Change one condition',
    '左边不变，右边改了': 'Left unchanged, right changed',
    // 2 · 第一版
    [`第一版 · ${F.classicMin} 到 ${F.classicMax} 人的小镇`]: `Version one · a town of ${F.classicMin} to ${F.classicMax} people`,
    停电通知: 'Outage notice',
    '明天 14:00 至 16:00 北区停电': 'North side, no power 2 to 4 pm',
    还不知道: 'Not heard yet', 听说了: 'Heard it', 相信了: 'Believe it',
    '实验广场 · 先猜，再看': 'Experiment gallery · guess, then look',
    第一版的结论之一: 'One finding of the first version',
    漏报伤的是: 'Missed warnings hurt ', '当下，': 'the present;',
    虚报伤的是: 'False alarms hurt ', '以后。': 'the future.',
    // 3 · 活的小社会（标签）
    '俯瞰 · 一天的日与夜': 'Overview · a day from dawn to night',
    '每个居民：工作、家人、需求、钱包': 'Every resident: work, family, needs, wallet',
    '为什么 · 每个候选的理由与概率': 'Why · every option, its reasons and odds',
    '点一个人，镜头跟上去': 'Click a person, the camera follows',
    '进屋，墙会让开': 'Indoors, the walls step aside',
    贴身视角: 'Ride-along view',
    '时间轴 · 一分钟看完一天': 'Timeline · a day in a minute',
    '画像 · 人口金字塔': 'Portrait · population pyramid',
    '画像 · 一天里人都在哪': 'Portrait · where people are, hour by hour',
    '画像 · 钱从哪来到哪去': 'Portrait · where the money comes from and goes',
    [`校准 · 对照国家统计局 ${F.surveyYear} 年时间利用调查`]: `Calibration · against China's ${F.surveyYear} national time-use survey`,
    '实验台 · 放一件事进去，同一个种子跑两遍': 'Lab · drop in one event, run the same seed twice',
    '同一个人，同一天，两条世界线': 'Same person, same day, two timelines',
    [`${F.communities} 种社区`]: `${F.communities} kinds of community`,
    '全部在浏览器里算，不需要服务器': 'All computed in your browser, no server',
    老城街坊: 'Old town', 通勤新小区: 'Commuter estate', 城中村: 'Urban village', 工厂镇: 'Factory town',
    // 4 · 结果与边界
    实验台: 'Lab',
    每个案例跑两条世界线: 'Each case runs two timelines,',
    '一条没有这件事，一条有': 'one without the event, one with it',
    站得住: 'Held up',
    [rain.case]: 'A week of rain',
    [`${rain.metric}（${rain.unit}）`]: 'Chats per older resident a day',
    [`少了${rain.spoken}`]: 'About 40% fewer',
    [`一整天没说上话的老人 ${rain.aloneBefore} → ${rain.aloneAfter}`]: `Elders alone all day: ${rain.aloneBefore} → ${rain.aloneAfter}`,
    [rum.case]: 'A price rumor',
    [`${rum.metric}（${rum.unit}）`]: 'Food at home per person (portions)',
    [`多了${rum.spoken}`]: 'About 80% more',
    [`${rum.starters} 个人起头，${rum.days}天传到${rum.reach}的人；菜市场生意涨了${rum.market}`]: `From ${rum.starters} people to 80% in nine days; market takings up about a quarter`,
    [`社区食堂（一顿 ${can.price} 元）`]: `A canteen (${can.price} yuan a meal)`,
    [can.metric]: 'Restaurant takings',
    [`少了${can.spoken}`]: 'About 15% less',
    [can.case]: 'Opened at the activity center',
    很小: 'Small',
    [R.rent.case]: 'Rent up 30%',
    [R.rent.effect]: 'Restaurants lose only about 2%',
    [R.voucher.case]: '500 yuan per household',
    [R.voucher.effect]: 'Eating out barely changes',
    模型缺的: 'Missing from the model',
    [R.layoff.case]: 'Workshop layoffs',
    [R.layoff.effect]: "Workers' mood does not get worse",
    [`说明${R.layoff.note}`]: 'Something is still missing',
    [`每个案例 ${M.seeds} 个种子，每个种子换一批人；${M.hypotheses} 条事先写下的假设，${M.runs}次运行都成立的有 ${M.heldEveryRun} 条`]:
      `${M.seeds} seeds per case, a new population per seed. Of ${M.hypotheses} hypotheses written in advance, ${M.heldEveryRun} held in all three runs.`,
    结果: 'Result', 你的直觉: 'Your intuition', 这次猜错了: 'Wrong this time', 会更高: 'Higher', 会更低: 'Lower',
  };

  const END = { name: '微缩城', en: 'MicroCity', tagline: '一个可以暂停、倒带、分叉的小社会', taglineEn: 'A small society you can pause, rewind and fork', site: 'microcity.linjiejim.com', repo: 'github.com/linjiejim/microcity' };
  const data = { NUMBERS, LINES, LINES_EN, UI_EN, END, DEFAULT_GAP: 0.26, LEAD: 0.8, TAIL: 3.4 };
  root.MC = data;
  if (typeof module === 'object' && module.exports) module.exports = data;
})(typeof window !== 'undefined' ? window : globalThis);
