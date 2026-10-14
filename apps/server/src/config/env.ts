import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const ROOT_ENV_FILE = path.resolve(import.meta.dirname, '../../../../.env');

if (existsSync(ROOT_ENV_FILE)) process.loadEnvFile(ROOT_ENV_FILE);

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const timezone = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'must be a valid IANA timezone');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.url(),
  TRUST_PROXY: z
    .string()
    .regex(/^(true|false|\d+)$/, 'must be true, false or a hop count')
    .default('false'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  TEST_DATABASE_URL: z.url().optional(),
  COOKIE_SECURE: booleanString.default(false),
  SESSION_TTL_HOURS: positiveInt(12),
  SESSION_IDLE_MINUTES: positiveInt(60),
  LOGIN_RATE_LIMIT_MAX: positiveInt(5),
  LOGIN_RATE_LIMIT_WINDOW_MINUTES: positiveInt(15),
  ACCOUNT_LOCKOUT_THRESHOLD: positiveInt(10),
  ACCOUNT_LOCKOUT_MINUTES: positiveInt(15),
  GYM_TIMEZONE: timezone,
  CURRENCY_CODE: z.string().regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code such as PKR'),
});

export class ConfigError extends Error {}

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

/** Tests must never touch development or production data (RULES.md §13). */
export function assertSafeTestDatabase(testUrl: string | undefined, devUrl: string | undefined) {
  if (!testUrl) throw new ConfigError('TEST_DATABASE_URL is not set; refusing to run tests.');
  const name = databaseName(testUrl);
  if (!name.endsWith('_test')) {
    throw new ConfigError(`Test database name must end in "_test" (got "${name}").`);
  }
  if (devUrl && (testUrl === devUrl || databaseName(devUrl) === name)) {
    throw new ConfigError(
      'TEST_DATABASE_URL must point to a different database than DATABASE_URL.',
    );
  }
}

function parseTrustProxy(value: string): boolean | number {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return Number(value);
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Report variable names and rules only — never the values.
    const problems = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new ConfigError(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  const env = result.data;
  const isTest = env.NODE_ENV === 'test';
  const isProduction = env.NODE_ENV === 'production';
  if (isTest) assertSafeTestDatabase(env.TEST_DATABASE_URL, env.DATABASE_URL);

  return {
    nodeEnv: env.NODE_ENV,
    isTest,
    isProduction,
    port: env.PORT,
    webOrigin: new URL(env.WEB_ORIGIN).origin,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    logLevel: env.LOG_LEVEL,
    databaseUrl: isTest ? env.TEST_DATABASE_URL! : env.DATABASE_URL,
    cookieSecure: isProduction ? true : env.COOKIE_SECURE,
    sessionTtlHours: env.SESSION_TTL_HOURS,
    sessionIdleMinutes: env.SESSION_IDLE_MINUTES,
    loginRateLimitMax: env.LOGIN_RATE_LIMIT_MAX,
    loginRateLimitWindowMinutes: env.LOGIN_RATE_LIMIT_WINDOW_MINUTES,
    accountLockoutThreshold: env.ACCOUNT_LOCKOUT_THRESHOLD,
    accountLockoutMinutes: env.ACCOUNT_LOCKOUT_MINUTES,
    gymTimezone: env.GYM_TIMEZONE,
    currencyCode: env.CURRENCY_CODE,
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;

function loadOrExit(): AppConfig {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

export const config: AppConfig = loadOrExit();
