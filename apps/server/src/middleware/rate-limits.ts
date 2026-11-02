import { ERROR_CODES } from '@gms/shared';
import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

export interface RateLimitOptions {
  loginMax: number;
  loginWindowMinutes: number;
  /** Report and chart requests per signed-in user per minute (each runs several aggregates). */
  reportsPerMinute: number;
}

const rejectWith429: Parameters<typeof rateLimit>[0] = {
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Too many attempts. Please wait and try again.',
      },
    });
  },
};

function emailKey(req: Request): string {
  const email: unknown = req.body?.email;
  return typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : '';
}

/** Login is throttled per IP and per account; successful sign-ins do not count. */
export function createLoginLimiters({
  loginMax,
  loginWindowMinutes,
}: RateLimitOptions): RequestHandler[] {
  const windowMs = loginWindowMinutes * 60_000;
  const perIp = rateLimit({
    ...rejectWith429,
    windowMs,
    limit: loginMax,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  });
  const perAccount = rateLimit({
    ...rejectWith429,
    windowMs,
    limit: loginMax,
    skipSuccessfulRequests: true,
    skip: (req) => emailKey(req) === '',
    keyGenerator: (req) => `account:${emailKey(req)}`,
  });
  return [perIp, perAccount];
}

/** Password changes: per signed-in user, to slow down guessing of the current password. */
export function createPasswordChangeLimiter({ loginMax, loginWindowMinutes }: RateLimitOptions) {
  return rateLimit({
    ...rejectWith429,
    windowMs: loginWindowMinutes * 60_000,
    limit: loginMax * 2,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `user:${req.auth?.user.id ?? ipKeyGenerator(req.ip ?? '')}`,
  });
}

/** Reports and dashboard charts: per signed-in user, so one session cannot load the database. */
export function createReportLimiter({ reportsPerMinute }: RateLimitOptions) {
  return rateLimit({
    ...rejectWith429,
    windowMs: 60_000,
    limit: reportsPerMinute,
    keyGenerator: (req) => `user:${req.auth?.user.id ?? ipKeyGenerator(req.ip ?? '')}`,
  });
}
