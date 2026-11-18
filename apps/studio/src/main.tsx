import { createRoot } from 'react-dom/client';

// 样片与验收页（/?demo=1）单独分包，不进主应用
const demo = new URLSearchParams(location.search).has('demo');
const root = createRoot(document.getElementById('root')!);

if (demo) void import('./demo/Demo.tsx').then(({ Demo }) => root.render(<Demo />));
else void import('./App.tsx').then(({ App }) => root.render(<App />));
