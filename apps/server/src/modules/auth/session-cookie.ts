import type { CookieOptions, Request, Response } from 'express';
import type { AppConfig } from '../../config/env';

/** `__Host-` prefix (Secure, path=/, no Domain) whenever the cookie is Secure. */
export function sessionCookieName(config: AppConfig) {
  return config.cookieSecure ? '__Host-gms_session' : 'gms_session';
}

function baseOptions(config: AppConfig): CookieOptions {
  return { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/' };
}

export function setSessionCookie(res: Response, config: AppConfig, token: string, expiresAt: Date) {
  res.cookie(sessionCookieName(config), token, { ...baseOptions(config), expires: expiresAt });
}

export function clearSessionCookie(res: Response, config: AppConfig) {
  res.clearCookie(sessionCookieName(config), baseOptions(config));
}

export function readSessionToken(req: Request, config: AppConfig): string | undefined {
  const value: unknown = req.cookies?.[sessionCookieName(config)];
  return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : undefined;
}
