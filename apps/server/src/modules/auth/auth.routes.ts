import { Router } from 'express';
import {
  createLoginLimiters,
  createPasswordChangeLimiter,
  type RateLimitOptions,
} from '../../middleware/rate-limits';
import { requireAuth, requireCsrf } from '../../middleware/session';
import * as controller from './auth.controller';

/** These routes deliberately skip the forced-password-change gate so users can complete it. */
export function authRoutes(limits: RateLimitOptions) {
  const router = Router();
  router.post('/login', ...createLoginLimiters(limits), controller.login);
  router.post('/logout', requireAuth, requireCsrf, controller.logout);
  router.get('/me', requireAuth, controller.me);
  router.post(
    '/change-password',
    requireAuth,
    requireCsrf,
    createPasswordChangeLimiter(limits),
    controller.changePassword,
  );
  return router;
}
