import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const ROOT = path.resolve(import.meta.dirname, '../..');

export default defineConfig(({ command, mode }) => {
  // The root .env says NODE_ENV=development for the server. Vite would apply that to builds too
  // and ship React's development build (slower and twice the size). Marking the .env value as
  // already handled keeps builds production builds; a NODE_ENV set in the shell still wins.
  if (command === 'build') process.env.VITE_USER_NODE_ENV ??= '';
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
    build: {
      sourcemap: false,
      rolldownOptions: {
        output: {
          // Screens load per route (router.tsx). The libraries every screen needs go in their
          // own long-lived chunks, so an app update does not re-download React or validation.
          codeSplitting: {
            groups: [
              { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
              { name: 'router', test: /node_modules[\\/]react-router[\\/]/ },
              { name: 'validation', test: /node_modules[\\/](zod|libphonenumber-js)[\\/]/ },
            ],
          },
        },
      },
    },
  };
});
