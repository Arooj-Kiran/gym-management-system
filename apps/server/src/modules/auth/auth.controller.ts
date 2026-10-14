import { changePasswordSchema, loginSchema } from '@gms/shared';
import type { Request, Response } from 'express';
import { config } from '../../config/env';
import { requestContext, requireAuthContext } from '../../lib/request-context';
import { parseInput } from '../../middleware/validate';
import * as authService from './auth.service';
import { clearSessionCookie, setSessionCookie } from './session-cookie';

export async function login(req: Request, res: Response) {
  const { email, password } = parseInput(loginSchema, req.body);
  const session = await authService.login(email, password, requestContext(req));
  setSessionCookie(res, config, session.token, session.expiresAt);
  res.status(204).end();
}

export async function logout(req: Request, res: Response) {
  await authService.logout(requireAuthContext(req), requestContext(req));
  clearSessionCookie(res, config);
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await authService.me(requireAuthContext(req)));
}

export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = parseInput(changePasswordSchema, req.body);
  await authService.changePassword(
    requireAuthContext(req),
    currentPassword,
    newPassword,
    requestContext(req),
  );
  res.status(204).end();
}
