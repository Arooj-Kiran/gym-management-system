import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config/env';
import * as schema from './schema';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.isTest ? 5 : 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

export const db = drizzle(pool, { schema, casing: 'snake_case' });

export type Database = NodePgDatabase<typeof schema>;
/** A transaction handle or the root db; services accept either so they can join a caller's transaction. */
export type DbExecutor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export async function closeDb() {
  await pool.end();
}
