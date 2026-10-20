import { pino, type Logger } from 'pino';
import { config } from '../config/env';

/** Anything that could carry a secret is redacted before it reaches a log line. */
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.temporaryPassword',
  '*.passwordHash',
  '*.password_hash',
  '*.token',
  '*.tokenHash',
  '*.csrfToken',
  '*.templateRef',
  '*.template_ref',
  '*.deviceKey',
  '*.apiKey',
  '*.secret',
];

export function createLogger(
  options: { level?: string; destination?: NodeJS.WritableStream } = {},
) {
  const level = options.level ?? config.logLevel;
  const pretty = !options.destination && config.nodeEnv === 'development';
  return pino(
    {
      level,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      base: { service: 'gms-server' },
      ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
    },
    options.destination,
  );
}

export const logger: Logger = createLogger();
