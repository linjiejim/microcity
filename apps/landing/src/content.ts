/**
 * 落地页的文字，中英两份。数字都来自实验记录：
 * docs/experiments/20261119-v5-impact-cases.md（第三次运行，5.4–5.5）与经典版的 20260929-classic-cases.md。
 * 改数字要先改实验记录。界面文字不用“他 / 她”指代居民。
 */
export type Lang = 'zh' | 'en';

export interface Feature {
  img: string;
  kicker: string;
  title: string;
  text: string;
  link?: { href: string; label: string };
}

export interface Finding {
  big: string;
  unit: string;
  text: string;
  tone: 'ok' | 'warn';
}

export interface Copy {
  nav: { video: string; story: string; features: string; results: string; classic: string; github: string; open: string };
  hero: { eyebrow: string; title: string; lead: string; open: string; watch: string; meta: string };
  video: { title: string; lead: string; missing: string };
  story: { title: string; paras: string[] };
  features: { title: string; lead: string; items: Feature[] };
  how: { title: string; items: Array<{ title: string; text: string }> };
  results: { title: string; lead: string; findings: Finding[]; method: string; record: string };
  classic: { title: string; text: string; findings: string[]; open: string };
  limits: { title: string; items: string[] };
  cta: { title: string; text: string; open: string; github: string; blog: string };
  footer: string;
}

const APP = '/app/';

export const COPY: Record<Lang, Copy> = {
  zh: {
    nav: { video: '视频', story: '由来', features: '能做什么', results: '结果', classic: '经典版', github: 'GitHub', open: '打开微缩城' },
    hero: {
      eyebrow: '微缩城 MicroCity',
      title: '一个可以暂停、倒带、<br />分叉的小社会',
      lead: '一座在浏览器里过日子的社区。每个居民有工作和休息、家人朋友、兴趣、物品和钱包。往里放一件事，同一个种子跑两遍，看日子怎么变。',
      open: '打开微缩城',
      watch: '看介绍视频',
      meta: '开源 · 免费 · 不需要注册，也不需要服务器',
    },
    video: { title: '一段视频看懂微缩城', lead: '它从哪来，能做什么，在里面做的实验得到了什么。', missing: '视频还在制作中。' },
    story: {
      title: '由来',
      paras: [
        '2026 年 9 月，TypeSafe 发布了快思考模型 Jev：它不写文字，只回答你事先出好的选择题。社区里有个项目 jev-town，让 50 个 AI 居民同时回应一条广播。看完之后冒出一个问题：社会能被模拟吗？',
        '如果能，就可以在微缩的社会里做社会实验。现实里又贵又慢、甚至根本做不了的实验，在这里可以重来一百遍，每次只改一个条件。',
        '第一版是一座 30 到 60 人的小镇和一张停电通知，用来看消息怎么传、人信不信。后来它被重做成了一个过日子的社区：不只看一条通知，而是看一件事落进日常生活之后，宏观的数字和具体的人各怎么变。',
      ],
    },
    features: {
      title: '能做什么',
      lead: '四个社区，约两百个居民，全部在你的浏览器里算。',
      items: [
        { img: 'follow', kicker: '跟着一个人', title: '点谁，就跟着谁过一天', text: '镜头跟上去，进了屋，墙会让开。右边写着此刻在做什么、为什么：候选有哪些，各项理由加减多少，选中的概率是多少。', link: { href: `${APP}?t=D02%2018:40&who=p001`, label: '跟着一位居民回家吃晚饭' } },
        { img: 'pov', kicker: '贴身视角', title: '站在这个人身后看', text: '早点铺里吃早饭的人、街上骑车上班的人、广场上跳舞的人，都是模型里真的在那里的人。窗亮，是因为家里有人醒着。' },
        { img: 'street', kicker: '一分钟看完一天', title: '回放任意一天', text: '底部的时间轴按活动着色，拖到哪一刻都行。“一分钟看完一天”会在睡觉、上班时快进，在路上、聊天、花钱时放慢。' },
        { img: 'portrait', kicker: '画像', title: '这是个什么样的社区', text: '人口金字塔，家庭类型，一天里人都在哪儿，钱从哪来到哪去，谁和谁熟。每天还有一页社区日报，每一句都来自当天的统计。', link: { href: `${APP}?v=portrait`, label: '看和平里的画像' } },
        { img: 'calibration', kicker: '校准', title: '模型里的一天，和调查里的一天差多少', text: '把居民的时间利用和国家统计局 2018 年时间利用调查并排放，差多少直接写出来。只摆出差距，不为了对上去调参数。' },
        { img: 'lab', kicker: '实验台', title: '放一件事进去，先猜，再看', text: '停业、调价、发钱、裁员、涨房租、办食堂、连日下雨、一条传言。同一个种子跑两遍，一遍没有这件事，一遍有；自动找出日子过得最不一样的人，把同一天的两条世界线并排放。', link: { href: `${APP}?v=lab`, label: '打开实验台' } },
        { img: 'community', kicker: '四个社区', title: '老城街坊、通勤新小区、城中村、工厂镇', text: '可以直接挑一个，也可以拖参数自己配，或者用一句话让语言模型来配。同一个链接，永远打开同一个世界的同一刻。', link: { href: `${APP}?c=factory`, label: '去红星厂看看' } },
      ],
    },
    how: {
      title: '它是怎么做到“可以追问为什么”的',
      items: [
        { title: '规则裁决世界', text: '营业、库存、工资、房租都由写明的规则执行，钱一分不少地守恒。居民只能在合法的选项里选，每一次选择都留下记录。' },
        { title: '模型只答选择题', text: '居民不靠语言模型“演戏”。语言模型只负责把事实改写成一句心里话，决策模型只给出第二意见，都不改世界。' },
        { title: '先算后看', text: '整个社区在浏览器的后台线程里算完若干天，观看全是回放。同一个种子永远得到同一个世界，所以可以分叉、对照、倒带。' },
        { title: '结论要过几道关', text: '假设写在实验之前，单独提交。每个案例跑多个种子，每个种子换一批人，只看逐种子配对的方向。' },
      ],
    },
    results: {
      title: '在里面做了什么实验',
      lead: '七件日常会遇到的事，每件 5 个种子、每个种子一批不同的人，跑了三次。下面是站得住的，和站不住的。',
      findings: [
        { big: '−41%', unit: '老人每天的聊天', text: '连下一周雨，公园和广场没法待了。老人每天聊天从 5.5 次降到 3.2 次，一整天没和人说上话的老人从 2% 升到 7%。茶馆只多接住了一成半的人。', tone: 'ok' },
        { big: '+80%', unit: '家家户户的存粮', text: '一条“菜要涨价了”的传言从 6 个人起头，九天里传到八成的人。存粮从人均 5.9 份涨到 10.6 份，菜市场的生意涨了约四分之一。', tone: 'ok' },
        { big: '−15%', unit: '饭馆的营业额', text: '活动中心办起一顿 9 元的社区食堂，抢走的主要是在家吃的那几顿，也抢了小饭馆的生意。', tone: 'ok' },
        { big: '约 2%', unit: '房租涨三成后饭馆少掉的生意', text: '钱对开销的影响很小：每户发 500 元，下馆子几乎没变；车间裁员一半，上班的人心情反而没有变差。这说明模型里“闲着”太舒服，还缺东西。', tone: 'warn' },
      ],
      method: '25 条事先写下的假设，三次运行里每次都成立的有 12 条。几步才传过去的效果（菜市场关门让老人少聊天，食堂让孤单的老人变少）时有时无。',
      record: '看完整的实验记录',
    },
    classic: {
      title: '经典版：一张停电通知',
      text: '第一版是一座 30 到 60 人的小镇。发一条停电通知进去，看每个人怎样得知、信不信、改不改安排、又告诉了谁。它还在，可以照常使用。',
      findings: ['狼来了：漏报伤的是当下，虚报伤的是以后。', '知沟：同一条通知，放在推送里先到年轻人手里，贴在公告栏上先到老人眼里。', '传话游戏：只要官方原文还在，走样就有上限。'],
      open: '打开经典版的实验广场',
    },
    limits: {
      title: '它还说不了什么',
      items: [
        '小镇里的结论，都只是“这个模型下的结论”，不是对现实的预测。',
        '居民是合成出来的。需求、性格、预算感的参数没有用现实数据校准过；校准页上，自由支配的时间仍比调查多一个半到两个半小时。',
        '居民过日子只用规则；决策模型目前只给出第二意见，影响案例也只在规则心智下跑过。',
        '信息只有“知道 / 不知道”两种状态；经典版里转述走样、信任变化那一套，还没有搬进新版。',
      ],
    },
    cta: { title: '来试试', text: '打开就是一个在过日子的社区。不需要注册，不需要密钥；想让居民说一句心里话，可以在设置里填自己的 OpenRouter 密钥，它只存在你的浏览器里。', open: '打开微缩城', github: '源码与实验记录', blog: '读一读它的来历' },
    footer: '微缩城 MicroCity · MIT 协议 · 由 Jim Lin 与 coding agent 一起做',
  },
  en: {
    nav: { video: 'Video', story: 'Origin', features: 'Features', results: 'Results', classic: 'Classic', github: 'GitHub', open: 'Open MicroCity' },
    hero: {
      eyebrow: 'MicroCity',
      title: 'A small society you can<br />pause, rewind and fork',
      lead: 'A neighborhood that lives its days in your browser. Every resident has work and rest, family and friends, hobbies, belongings and a wallet. Drop one event in, run the same seed twice, and see how life changes.',
      open: 'Open MicroCity',
      watch: 'Watch the video',
      meta: 'Open source · free · no sign-up, no server',
    },
    video: { title: 'MicroCity in one short film', lead: 'Where it came from, what it does, and what the experiments found. Narration is in Chinese with Chinese subtitles.', missing: 'The video is still being made.' },
    story: {
      title: 'Origin',
      paras: [
        'In September 2026 TypeSafe released Jev, a fast-thinking model that writes no text and only answers multiple-choice questions you set. A community project, jev-town, had 50 AI residents respond to one broadcast. It raised a question: can a society be simulated?',
        'If it can, you can run social experiments in a miniature society. Experiments that are slow, expensive or impossible in real life can be rerun a hundred times here, changing one condition at a time.',
        'The first version was a town of 30 to 60 people and a power-outage notice, built to watch how news spreads and whether people believe it. It was later rebuilt as a neighborhood that lives its days: not one notice, but what happens to the numbers and to individual people when an event lands in everyday life.',
      ],
    },
    features: {
      title: 'What it does',
      lead: 'Four communities, about two hundred residents, all computed in your browser.',
      items: [
        { img: 'follow', kicker: 'Follow anyone', title: 'Click a resident, spend the day together', text: 'The camera follows; walk indoors and the walls step aside. The side panel says what they are doing and why: the options, how much each reason added or subtracted, and the probability of the choice.', link: { href: `${APP}?t=D02%2018:40&who=p001`, label: 'Follow someone home for dinner' } },
        { img: 'pov', kicker: 'Over the shoulder', title: 'See it from right behind them', text: 'The people eating at the breakfast stall, riding to work, dancing in the square are all people the model actually put there. A window is lit because someone at home is awake.' },
        { img: 'street', kicker: 'A day in a minute', title: 'Replay any day', text: 'The timeline is colored by activity; drag to any moment. "A day in a minute" fast-forwards through sleep and work and slows down on the road, in conversation and at the till.' },
        { img: 'portrait', kicker: 'Portrait', title: 'What kind of community is this', text: 'Population pyramid, household types, where everyone is through the day, where money comes from and goes, who knows whom. Plus a daily community paper where every line comes from that day’s statistics.', link: { href: `${APP}?v=portrait`, label: 'See the portrait' } },
        { img: 'calibration', kicker: 'Calibration', title: 'A model day next to a surveyed day', text: 'Residents’ time use sits next to China’s 2018 national time-use survey, gaps stated plainly. The gaps are shown, not tuned away.' },
        { img: 'lab', kicker: 'Experiment bench', title: 'Drop an event in, guess, then look', text: 'Closures, price changes, cash grants, layoffs, rent rises, a canteen, a week of rain, a rumor. The same seed runs twice, with and without the event; the bench finds the residents whose days changed most and lays the two timelines side by side.', link: { href: `${APP}?v=lab`, label: 'Open the bench' } },
        { img: 'community', kicker: 'Four communities', title: 'Old town, commuter estate, urban village, factory town', text: 'Pick one, drag the sliders to make your own, or describe it in a sentence and let a language model set it up. A link always opens the same world at the same moment.', link: { href: `${APP}?c=factory`, label: 'Visit the factory town' } },
      ],
    },
    how: {
      title: 'How "why?" stays answerable',
      items: [
        { title: 'Rules run the world', text: 'Opening hours, stock, wages and rent follow written rules, and money is conserved to the cent. Residents choose only among legal options, and every choice is recorded.' },
        { title: 'Models only answer questions', text: 'Residents are not role-played by a language model. The language model only rewrites facts into a line of inner voice; the decision model only gives a second opinion. Neither changes the world.' },
        { title: 'Compute first, then watch', text: 'The whole community is computed for days in a background thread; watching is replay. The same seed always gives the same world, so you can fork, compare and rewind.' },
        { title: 'Conclusions pass several gates', text: 'Hypotheses are written and committed before running. Each case runs several seeds with a different population per seed, and only the paired direction counts.' },
      ],
    },
    results: {
      title: 'What the experiments found',
      lead: 'Seven everyday events, 5 seeds each with a different population per seed, run three times. What held up, and what did not.',
      findings: [
        { big: '−41%', unit: 'daily chats among older residents', text: 'A week of rain empties the park and the square. Older residents’ daily chats fall from 5.5 to 3.2, and the share who talk to nobody all day rises from 2% to 7%. The teahouse absorbs only 15% more visits.', tone: 'ok' },
        { big: '+80%', unit: 'food stored at home', text: 'A rumor that food prices will rise starts with 6 people and reaches 80% of residents in nine days. Food at home goes from 5.9 to 10.6 portions per person; the market’s takings rise by about a quarter.', tone: 'ok' },
        { big: '−15%', unit: 'restaurant takings', text: 'A 9-yuan community canteen at the activity centre mostly replaces meals at home, and it also takes business from the small restaurants.', tone: 'ok' },
        { big: '~2%', unit: 'restaurant takings lost after a 30% rent rise', text: 'Money barely moves spending: a 500-yuan grant per household hardly changes eating out, and after half a workshop is laid off, workers’ mood does not drop. Idle time is too pleasant in this model; something is missing.', tone: 'warn' },
      ],
      method: 'Of 25 pre-registered hypotheses, 12 held in all three runs. Effects that travel several steps (a market closing makes older people chat less; a canteen makes lonely elders fewer) come and go.',
      record: 'Read the full experiment record',
    },
    classic: {
      title: 'The classic version: one outage notice',
      text: 'The first version was a town of 30 to 60 people. Send a power-outage notice in and watch who hears, who believes, who changes plans and whom they tell. It is still here and works as before.',
      findings: ['Cry wolf: missed warnings hurt the present, false alarms hurt the future.', 'Knowledge gap: by push, a notice reaches the young first; on the notice board, the old.', 'Telephone game: while the official text is around, distortion has a ceiling.'],
      open: 'Open the classic experiment gallery',
    },
    limits: {
      title: 'What it cannot tell you yet',
      items: [
        'Every conclusion is a conclusion about this model, not a forecast of reality.',
        'Residents are synthetic. Their needs, traits and sense of budget are not calibrated on real data; free time is still 1.5 to 2.5 hours a day above the survey.',
        'Residents live by rules only; the decision model gives just a second opinion, and the impact cases have run under the rule mind only.',
        'Information is only "heard / not heard"; the classic version’s model of distortion and trust has not been ported yet.',
      ],
    },
    cta: { title: 'Try it', text: 'It opens on a neighborhood already living its day. No sign-up, no key. To hear a resident’s inner voice, add your own OpenRouter key in settings; it stays in your browser.', open: 'Open MicroCity', github: 'Code and experiment records', blog: 'The story behind it (Chinese)' },
    footer: 'MicroCity · MIT license · built by Jim Lin with coding agents',
  },
};

export const LINKS = {
  app: APP,
  classic: '/classic/',
  github: 'https://github.com/linjiejim/microcity',
  record: 'https://github.com/linjiejim/microcity/blob/main/docs/experiments/20261119-v5-impact-cases.md',
  blog: { zh: 'https://jimlin.me/writing/microcity-can-society-be-simulated', en: 'https://jimlin.me/en/writing/microcity-can-society-be-simulated' },
};
