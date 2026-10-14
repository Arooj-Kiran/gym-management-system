import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const ROOT = path.resolve(import.meta.dirname, '../..');

export default defineConfig(({ mode }) => {
  // The single root .env is shared with the server; only VITE_* values reach the browser bundle.
  const env = { ...loadEnv(mode, ROOT, ''), ...process.env };
  const apiTarget = env.VITE_DEV_API_PROXY_TARGET ?? 'http://localhost:4000';

  return {
    envDir: ROOT,
    plugins: [react(), tailwindcss()],
    server: {
      port: Number(env.WEB_DEV_PORT ?? 5173),
      strictPort: true,
      proxy: { '/api': { target: apiTarget, changeOrigin: false } },
    },
    preview: { port: 4173 },
    build: { sourcemap: false },
  };
});
