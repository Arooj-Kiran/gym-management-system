import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// E2E runs against its own ports and the TEST database (never gym_dev), so a dev server can stay up.
const API_PORT = 4100;
const WEB_PORT = 5174;
const WEB_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 7_500 },
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'npm run start -w @gms/server',
      cwd: '../..',
      url: `http://localhost:${API_PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        WEB_ORIGIN: WEB_URL,
        COOKIE_SECURE: 'false',
        LOG_LEVEL: 'warn',
        // Every test signs in; the real limit is covered by the API tests.
        LOGIN_RATE_LIMIT_MAX: '1000',
        // Uploaded test photos stay out of the project's uploads folder.
        UPLOAD_DIR: path.join(os.tmpdir(), 'gms-e2e-uploads'),
        // The entrance flow is driven through simulated scanners (never in production).
        BIOMETRIC_SIMULATOR_ENABLED: 'true',
      },
    },
    {
      command: 'npm run dev -w @gms/web',
      cwd: '../..',
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        WEB_DEV_PORT: String(WEB_PORT),
        VITE_DEV_API_PROXY_TARGET: `http://localhost:${API_PORT}`,
      },
    },
  ],
});
