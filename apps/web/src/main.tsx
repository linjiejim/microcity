import { createRoot } from 'react-dom/client';
import './theme/tokens.css';
import './ui/ui.css';
import './app.css';
import { App } from './App.tsx';
import { contentHash } from '@microcity/sim';
import { useApp } from './store.ts';

// 调试/验收钩子：前端用同构 reducer 重建的状态哈希（E2E 用它和服务端比对）
(window as unknown as { __microcity: unknown }).__microcity = {
  stateHash: () => {
    const s = useApp.getState().state;
    return s ? { seq: s.meta.seq, hash: contentHash(s) } : null;
  },
};

// r3f 场景里的 drei <Html> 各自持有 React 根，StrictMode 的双重挂载会让它们在渲染中被卸载，所以不用 StrictMode
createRoot(document.getElementById('root')!).render(<App />);
