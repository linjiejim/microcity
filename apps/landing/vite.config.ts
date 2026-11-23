import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// 落地页（D100）：纯静态，挂在根路径；介绍视频从 docs/assets/v5/video 引入，构建时带哈希拷进来
export default defineConfig({
  server: {
    port: Number(process.env.MICROCITY_LANDING_PORT ?? 5330),
    strictPort: true,
    host: '127.0.0.1',
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
  preview: { port: Number(process.env.MICROCITY_LANDING_PORT ?? 5330) },
  build: { target: 'es2023', assetsInlineLimit: 0 },
});
