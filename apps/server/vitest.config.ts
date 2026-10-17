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
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', UPLOAD_DIR: TEST_UPLOAD_DIR, MAX_UPLOAD_MB: '1' },
    // Integration tests share one test database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
