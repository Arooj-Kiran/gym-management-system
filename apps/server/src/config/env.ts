import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const ROOT_ENV_FILE = path.join(REPO_ROOT, '.env');

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
  UPLOAD_DIR: z.string().min(1).default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(50).default(2),
  ACCESS_DUPLICATE_SCAN_WINDOW_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
  ACCESS_DB_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(2000),
  ACCESS_SCAN_RATE_LIMIT_PER_MINUTE: positiveInt(60),
  BIOMETRIC_SIMULATOR_ENABLED: booleanString.default(false),
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
  // PLAN §6.5: a simulated scanner must never be able to open a real gym's door.
  if (isProduction && env.BIOMETRIC_SIMULATOR_ENABLED) {
    throw new ConfigError(
      'BIOMETRIC_SIMULATOR_ENABLED must not be true when NODE_ENV=production; refusing to start.',
    );
  }

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
    /** Relative paths resolve from the repository root, never from the process cwd. */
    uploadDir: path.resolve(REPO_ROOT, env.UPLOAD_DIR),
    maxUploadBytes: Math.round(env.MAX_UPLOAD_MB * 1024 * 1024),
    accessDuplicateWindowSeconds: env.ACCESS_DUPLICATE_SCAN_WINDOW_SECONDS,
    accessDbTimeoutMs: env.ACCESS_DB_TIMEOUT_MS,
    accessScanRateLimitPerMinute: env.ACCESS_SCAN_RATE_LIMIT_PER_MINUTE,
    biometricSimulatorEnabled: env.BIOMETRIC_SIMULATOR_ENABLED,
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
