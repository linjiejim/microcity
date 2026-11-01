import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = `http://127.0.0.1:${process.env.MICROCITY_PORT ?? 5317}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.MICROCITY_WEB_PORT ?? 5318),
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': { target: api, ws: true, changeOrigin: true },
    },
  },
  preview: { port: Number(process.env.MICROCITY_WEB_PORT ?? 5318), proxy: { '/api': { target: api, ws: true } } },
  build: { target: 'es2023', chunkSizeWarningLimit: 2000 },
});
