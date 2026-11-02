import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

/** Uploaded test photos go to a throwaway folder, never the real UPLOAD_DIR. */
const TEST_UPLOAD_DIR = path.join(os.tmpdir(), 'gms-test-uploads');
// Global setup runs in this process and empties the folder before and after the run.
process.env.UPLOAD_DIR = TEST_UPLOAD_DIR;

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/setup/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      UPLOAD_DIR: TEST_UPLOAD_DIR,
      MAX_UPLOAD_MB: '1',
      // Fixed so access tests do not depend on a developer's .env.
      BIOMETRIC_SIMULATOR_ENABLED: 'true',
      ACCESS_DUPLICATE_SCAN_WINDOW_SECONDS: '60',
      ACCESS_DB_TIMEOUT_MS: '2000',
      ACCESS_SCAN_RATE_LIMIT_PER_MINUTE: '60',
      // No notification channel is ever configured in tests, so nothing can reach a provider.
      SMTP_HOST: '',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      SMTP_FROM: '',
      TWILIO_ACCOUNT_SID: '',
      TWILIO_AUTH_TOKEN: '',
      TWILIO_SMS_FROM: '',
      TWILIO_WHATSAPP_FROM: '',
    },
    // Integration tests share one test database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
