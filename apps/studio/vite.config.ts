import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 纯静态应用（D69）：没有服务端，也没有代理
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.MICROCITY_STUDIO_PORT ?? 5320),
    strictPort: true,
    host: '127.0.0.1',
  },
  preview: { port: Number(process.env.MICROCITY_STUDIO_PORT ?? 5320) },
  worker: { format: 'es' },
  build: { target: 'es2023', chunkSizeWarningLimit: 2000 },
});
