import { ERROR_CODES } from '@gms/shared';
import type { RequestHandler } from 'express';
import { config } from '../config/env';
import { AppError, unauthenticated } from '../lib/errors';
import { safeEqual } from '../lib/tokens';
import { readSessionToken } from '../modules/auth/session-cookie';
import { resolveSession } from '../modules/auth/session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Attaches `req.auth` when the session cookie maps to a live session. Never rejects on its own. */
export const loadSession: RequestHandler = async (req, _res, next) => {
  const token = readSessionToken(req, config);
  if (token) req.auth = (await resolveSession(token)) ?? undefined;
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) throw unauthenticated();
  next();
};

/** Synchronizer-token CSRF check for unsafe methods on authenticated requests. */
export const requireCsrf: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method) || !req.auth) return next();
  const header = req.get('x-csrf-token');
  if (!header || !safeEqual(header, req.auth.csrfToken)) {
    throw new AppError(
      403,
      ERROR_CODES.CSRF_INVALID,
      'Your session token is missing or invalid. Reload the page and try again.',
    );
  }
  next();
};

/** Accounts with a temporary or seeded password may only change it (or sign out) until they do. */
export const requirePasswordChanged: RequestHandler = (req, _res, next) => {
  if (req.auth?.user.mustChangePassword) {
    throw new AppError(
      403,
      ERROR_CODES.PASSWORD_CHANGE_REQUIRED,
      'Change your password to continue.',
    );
  }
  next();
};

/** Browsers always send Origin on unsafe requests; a foreign origin is rejected outright. */
export const checkOrigin: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== config.webOrigin) {
    throw new AppError(403, ERROR_CODES.ORIGIN_NOT_ALLOWED, 'Request origin is not allowed.');
  }
  next();
};

/** Session gate used by every protected router. */
export const authenticated = [requireAuth, requireCsrf, requirePasswordChanged];
