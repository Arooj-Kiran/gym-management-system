import { sql } from 'drizzle-orm';
import { databaseName } from '../../src/config/env';

/**
 * Drop everything the app role owns in the TEST database and re-apply all migrations.
 * Both the env guard and a server-side database-name check must pass first.
 */
export async function resetTestDatabase() {
  const { config } = await import('../../src/config/env');
  if (!config.isTest || !databaseName(config.databaseUrl).endsWith('_test')) {
    throw new Error('Refusing to reset a database that is not the test database.');
  }
  const { db } = await import('../../src/db/client');
  const { runMigrations } = await import('../../src/db/migrate');

  const result = await db.execute<{ name: string }>(sql`select current_database() as name`);
  const actual = result.rows[0]?.name ?? '';
  if (!actual.endsWith('_test')) throw new Error(`Connected to "${actual}", not a test database.`);

  await db.execute(sql`drop owned by current_user cascade`);
  await runMigrations();
}
