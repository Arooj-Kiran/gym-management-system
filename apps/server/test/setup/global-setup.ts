/** Runs once per `vitest run`: guard → reset → migrate the test database. */
export default async function globalSetup() {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  const { resetTestDatabase } = await import('./reset-db');
  const { closeDb } = await import('../../src/db/client');
  try {
    await resetTestDatabase();
  } finally {
    await closeDb();
  }
}
