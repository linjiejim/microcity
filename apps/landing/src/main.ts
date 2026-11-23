import './style.css';
import { COPY, LINKS, type Copy, type Lang } from './content.ts';

// 图片：构建时带哈希；视频：中英各一份（英文版没有就退回中文），都没有就显示一句说明
const IMGS = import.meta.glob<string>('./img/*.webp', { eager: true, query: '?url', import: 'default' });
const MEDIA = import.meta.glob<string>(
  [
    '../../../docs/assets/v5/video/microcity-intro.mp4',
    '../../../docs/assets/v5/video/microcity-intro-poster.jpg',
    '../../../docs/assets/v5/video/microcity-intro-en.mp4',
    '../../../docs/assets/v5/video/microcity-intro-en-poster.jpg',
  ],
  { eager: true, query: '?url', import: 'default' },
);
const img = (name: string): string => IMGS[`./img/${name}.webp`] ?? '';
const media = (name: string): string | undefined => Object.entries(MEDIA).find(([k]) => k.endsWith(`/${name}`))?.[1];
const film = (lang: Lang): { video?: string; poster: string } => {
  const suf = lang === 'en' && media('microcity-intro-en.mp4') ? '-en' : '';
  return { video: media(`microcity-intro${suf}.mp4`), poster: media(`microcity-intro${suf}-poster.jpg`) ?? img('hero') };
};

// 开发时新版应用在另一个端口
const appUrl = (href: string): string => (import.meta.env.DEV && href.startsWith('/app/') ? `http://127.0.0.1:5320/${href.slice(5)}` : href);
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PLAY = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
const GH = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2"/></svg>';

function render(lang: Lang): string {
  const c: Copy = COPY[lang];
  const other: Lang = lang === 'zh' ? 'en' : 'zh';
  const { video: VIDEO, poster: POSTER } = film(lang);
  const btn = (href: string, label: string, kind: 'primary' | 'ghost' = 'primary', icon = ARROW) => `<a class="btn ${kind}" href="${esc(appUrl(href))}">${label}${icon}</a>`;
  return `
  <header class="nav">
    <a class="brand serif" href="#top">${lang === 'zh' ? '微缩城' : 'MicroCity'}</a>
    <nav>
      <a href="#video">${c.nav.video}</a><a href="#story">${c.nav.story}</a><a href="#features">${c.nav.features}</a><a href="#results">${c.nav.results}</a><a href="#classic">${c.nav.classic}</a>
    </nav>
    <div class="nav-end">
      <button class="lang" type="button" data-lang="${other}" aria-label="${other === 'en' ? 'English' : '中文'}">${other === 'en' ? 'EN' : '中文'}</button>
      <a class="icon-link" href="${LINKS.github}" aria-label="GitHub">${GH}</a>
      ${btn(LINKS.app, c.nav.open)}
    </div>
  </header>

  <section class="hero" id="top">
    <img class="hero-img" src="${img('hero')}" alt="" fetchpriority="high" />
    <div class="hero-shade"></div>
    <div class="hero-text">
      <div class="eyebrow">${c.hero.eyebrow}</div>
      <h1 class="serif">${c.hero.title}</h1>
      <p class="lead">${c.hero.lead}</p>
      <div class="row">
        ${btn(LINKS.app, c.hero.open)}
        <a class="btn ghost light" href="#video">${c.hero.watch}${PLAY}</a>
      </div>
      <div class="meta">${c.hero.meta}</div>
    </div>
  </section>

  <section class="video-sec" id="video">
    <div class="wrap">
      <h2 class="serif">${c.video.title}</h2>
      <p class="sub">${c.video.lead}</p>
      ${
        VIDEO
          ? `<div class="video-frame"><video controls playsinline preload="metadata" poster="${POSTER}" src="${VIDEO}"></video></div>`
          : `<div class="video-frame empty"><img src="${POSTER}" alt="" /><span>${c.video.missing}</span></div>`
      }
    </div>
  </section>

  <section class="story" id="story">
    <div class="wrap narrow">
      <h2 class="serif">${c.story.title}</h2>
      ${c.story.paras.map((p) => `<p>${p}</p>`).join('')}
    </div>
  </section>

  <section class="features" id="features">
    <div class="wrap">
      <h2 class="serif">${c.features.title}</h2>
      <p class="sub">${c.features.lead}</p>
      ${c.features.items
        .map(
          (f, i) => `
        <article class="feature${i % 2 ? ' flip' : ''}">
          <figure><img src="${img(f.img)}" alt="${esc(f.title)}" loading="lazy" /></figure>
          <div class="feature-text">
            <div class="kicker">${f.kicker}</div>
            <h3 class="serif">${f.title}</h3>
            <p>${f.text}</p>
            ${f.link ? `<a class="more" href="${esc(appUrl(f.link.href))}">${f.link.label}${ARROW}</a>` : ''}
          </div>
        </article>`,
        )
        .join('')}
    </div>
  </section>

  <section class="how">
    <div class="wrap">
      <h2 class="serif">${c.how.title}</h2>
      <div class="how-grid">
        ${c.how.items.map((h, i) => `<div class="how-item"><span class="num serif">${i + 1}</span><h3>${h.title}</h3><p>${h.text}</p></div>`).join('')}
      </div>
    </div>
  </section>

  <section class="results" id="results">
    <div class="wrap">
      <h2 class="serif">${c.results.title}</h2>
      <p class="sub">${c.results.lead}</p>
      <div class="finding-grid">
        ${c.results.findings.map((f) => `<div class="finding ${f.tone}"><b class="serif">${f.big}</b><span class="unit">${f.unit}</span><p>${f.text}</p></div>`).join('')}
      </div>
      <p class="method">${c.results.method}</p>
      <a class="more" href="${LINKS.record}">${c.results.record}${ARROW}</a>
    </div>
  </section>

  <section class="classic" id="classic">
    <div class="wrap classic-grid">
      <figure><img src="${img('classic-wall')}" alt="" loading="lazy" /></figure>
      <div>
        <h2 class="serif">${c.classic.title}</h2>
        <p>${c.classic.text}</p>
        <ul>${c.classic.findings.map((f) => `<li>${f}</li>`).join('')}</ul>
        <a class="btn ghost" href="${LINKS.classic}">${c.classic.open}${ARROW}</a>
      </div>
    </div>
  </section>

  <section class="limits">
    <div class="wrap narrow">
      <h2 class="serif">${c.limits.title}</h2>
      <ul>${c.limits.items.map((x) => `<li>${x}</li>`).join('')}</ul>
    </div>
  </section>

  <section class="cta">
    <img class="cta-img" src="${img('apartment')}" alt="" loading="lazy" />
    <div class="cta-shade"></div>
    <div class="wrap narrow cta-text">
      <h2 class="serif">${c.cta.title}</h2>
      <p>${c.cta.text}</p>
      <div class="row">
        ${btn(LINKS.app, c.cta.open)}
        <a class="btn ghost light" href="${LINKS.github}">${c.cta.github}${GH}</a>
        <a class="btn ghost light" href="${LINKS.blog[lang]}">${c.cta.blog}${ARROW}</a>
      </div>
    </div>
  </section>

  <footer class="foot"><div class="wrap">${c.footer}</div></footer>`;
}

function pickLang(): Lang {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'zh' || q === 'en') return q;
  const saved = localStorage.getItem('microcity.lang');
  if (saved === 'zh' || saved === 'en') return saved;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function mount(lang: Lang): void {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.title = lang === 'zh' ? '微缩城 MicroCity：一个可以暂停、倒带、分叉的小社会' : 'MicroCity: a small society you can pause, rewind and fork';
  const root = document.getElementById('root')!;
  root.innerHTML = render(lang);
  root.querySelector<HTMLButtonElement>('.lang')?.addEventListener('click', (e) => {
    const next = (e.currentTarget as HTMLButtonElement).dataset.lang as Lang;
    localStorage.setItem('microcity.lang', next);
    const y = window.scrollY;
    mount(next);
    window.scrollTo(0, y);
  });
  // 滚到哪一节，导航上就亮哪一节；图片进入视口时淡入
  const io = new IntersectionObserver((entries) => entries.forEach((en) => en.isIntersecting && en.target.classList.add('in')), { rootMargin: '0px 0px -10% 0px' });
  root.querySelectorAll('.feature, .finding, .how-item, .video-frame').forEach((el) => io.observe(el));
  onScroll();
}

function onScroll(): void {
  document.querySelector('.nav')?.classList.toggle('solid', window.scrollY > 40);
}
window.addEventListener('scroll', onScroll, { passive: true });

mount(pickLang());
