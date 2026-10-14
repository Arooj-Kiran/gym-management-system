import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { config, databaseName } from '../config/env';
import { closeDb, db } from './client';

export const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, 'migrations');

export async function runMigrations() {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

if (import.meta.main) {
  try {
    await runMigrations();
    console.warn(`Migrations applied to "${databaseName(config.databaseUrl)}".`);
  } finally {
    await closeDb();
  }
}
