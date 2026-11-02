import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    css: false,
    // Typing whole forms with user-event in jsdom can pass 5 s when every file runs in parallel.
    testTimeout: 15_000,
  },
});
