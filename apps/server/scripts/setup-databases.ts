/**
 * One-time local setup: creates the `gym_app` role and the `gym_dev` / `gym_test` databases,
 * installs the required extensions, and writes the connection strings into the root .env.
 * The PostgreSQL superuser password is typed by you (hidden) and is never stored or printed.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import pg from 'pg';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const ENV_FILE = path.join(ROOT, '.env');
const ENV_EXAMPLE = path.join(ROOT, '.env.example');
const APP_ROLE = 'gym_app';
const DATABASES = ['gym_dev', 'gym_test'];
const EXTENSIONS = ['pgcrypto', 'citext', 'pg_trgm', 'btree_gist'];

async function ask(question: string, fallback: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question(`${question} [${fallback}]: `)).trim();
  rl.close();
  return answer || fallback;
}

function askHidden(question: string): Promise<string> {
  if (!stdin.isTTY) throw new Error('Run this script in an interactive terminal.');
  stdout.write(`${question}: `);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  let value = '';
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stdout.write('\n');
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          cleanup();
          reject(new Error('Cancelled.'));
          return;
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

function upsertEnv(text: string, values: Record<string, string>): string {
  let next = text;
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    next = pattern.test(next) ? next.replace(pattern, line) : `${next.trimEnd()}\n${line}\n`;
  }
  return next;
}

function readEnvValue(text: string, key: string): string | undefined {
  return new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1]?.trim();
}

async function main() {
  console.log('\nGym Management System — local database setup\n');
  const host = await ask('PostgreSQL host', 'localhost');
  const port = Number(await ask('PostgreSQL port', '5432'));
  const superuser = await ask('Superuser name', 'postgres');
  const superPassword =
    process.env.PGPASSWORD || (await askHidden(`Password for "${superuser}" (hidden)`));

  const appPassword = randomBytes(24).toString('base64url');
  const admin = new pg.Client({
    host,
    port,
    user: superuser,
    password: superPassword,
    database: 'postgres',
  });
  await admin.connect();
  try {
    const role = await admin.query('select 1 from pg_roles where rolname = $1', [APP_ROLE]);
    // base64url passwords contain only [A-Za-z0-9_-], so inlining them in DDL is safe.
    const roleSql = `LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE`;
    await admin.query(
      role.rowCount
        ? `ALTER ROLE ${APP_ROLE} WITH ${roleSql}`
        : `CREATE ROLE ${APP_ROLE} ${roleSql}`,
    );
    console.log(`Role "${APP_ROLE}" ${role.rowCount ? 'updated with a new password' : 'created'}.`);

    for (const name of DATABASES) {
      const exists = await admin.query('select 1 from pg_database where datname = $1', [name]);
      if (exists.rowCount) {
        await admin.query(`ALTER DATABASE ${name} OWNER TO ${APP_ROLE}`);
        console.log(`Database "${name}" already exists; owner set to ${APP_ROLE}.`);
      } else {
        await admin.query(`CREATE DATABASE ${name} OWNER ${APP_ROLE} ENCODING 'UTF8'`);
        console.log(`Database "${name}" created.`);
      }
      const dbClient = new pg.Client({
        host,
        port,
        user: superuser,
        password: superPassword,
        database: name,
      });
      await dbClient.connect();
      try {
        for (const extension of EXTENSIONS)
          await dbClient.query(`CREATE EXTENSION IF NOT EXISTS ${extension}`);
      } finally {
        await dbClient.end();
      }
    }
  } finally {
    await admin.end();
  }

  const envText = existsSync(ENV_FILE)
    ? readFileSync(ENV_FILE, 'utf8')
    : readFileSync(ENV_EXAMPLE, 'utf8');
  const updates: Record<string, string> = {
    DATABASE_URL: `postgres://${APP_ROLE}:${appPassword}@${host}:${port}/gym_dev`,
    TEST_DATABASE_URL: `postgres://${APP_ROLE}:${appPassword}@${host}:${port}/gym_test`,
  };

  const currentSeedPassword = readEnvValue(envText, 'SEED_ADMIN_PASSWORD') ?? '';
  if (!currentSeedPassword || currentSeedPassword.includes('CHANGE_ME')) {
    updates.SEED_ADMIN_EMAIL = await ask(
      'Email for the first Admin account',
      readEnvValue(envText, 'SEED_ADMIN_EMAIL') ?? 'admin@example.test',
    );
    for (;;) {
      const first = await askHidden('Initial Admin password, min. 12 characters (hidden)');
      const second = await askHidden('Repeat the password');
      if (first.length >= 12 && first === second && !/\s/.test(first)) {
        updates.SEED_ADMIN_PASSWORD = first;
        break;
      }
      console.log(
        'Passwords must match, contain no spaces and be at least 12 characters. Try again.',
      );
    }
  }

  writeFileSync(ENV_FILE, upsertEnv(envText, updates));
  console.log('\n.env updated (secrets are not shown). Next steps:');
  console.log('  npm run db:migrate');
  console.log('  npm run db:seed\n');
}

main().catch((error: unknown) => {
  console.error(`\nSetup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
