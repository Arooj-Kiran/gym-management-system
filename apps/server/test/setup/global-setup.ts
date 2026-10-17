import { rm } from 'node:fs/promises';

/** Runs once per `vitest run`: guard → reset → migrate the test database, empty test uploads. */
export default async function globalSetup() {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  const uploadDir = process.env.UPLOAD_DIR;
  if (!uploadDir?.includes('gms-test-uploads')) {
    throw new Error('UPLOAD_DIR must be the throwaway test folder (see vitest.config.ts).');
  }
  const emptyUploads = () => rm(uploadDir, { recursive: true, force: true });
  await emptyUploads();
  const { resetTestDatabase } = await import('./reset-db');
  const { closeDb } = await import('../../src/db/client');
  try {
    await resetTestDatabase();
  } finally {
    await closeDb();
  }
  return emptyUploads;
}
