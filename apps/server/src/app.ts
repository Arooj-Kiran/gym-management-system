import { existsSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { config } from './config/env';
import { logger as defaultLogger } from './lib/logger';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import type { RateLimitOptions } from './middleware/rate-limits';
import { requestId } from './middleware/request-id';
import { checkOrigin, loadSession } from './middleware/session';
import { accessSettings, type AccessSettings } from './modules/access/access-settings';
import { accessRoutes } from './modules/access/access.routes';
import { attendanceRoutes } from './modules/attendance/attendance.routes';
import { auditRoutes } from './modules/audit/audit.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { biometricRoutes } from './modules/biometrics/biometrics.routes';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes';
import { devicesRoutes } from './modules/devices/devices.routes';
import { healthRoutes } from './modules/health/health.routes';
import { membersRoutes } from './modules/members/members.routes';
import { membershipsRoutes } from './modules/memberships/memberships.routes';
import { plansRoutes } from './modules/plans/plans.routes';
import { portalRoutes } from './modules/portal/portal.routes';
import { settingsRoutes } from './modules/settings/settings.routes';
import { staffRoutes } from './modules/staff/staff.routes';

export interface AppOptions {
  logger?: Logger;
  rateLimits?: Partial<RateLimitOptions>;
  /** Tests shorten timeouts or toggle the simulator; defaults come from the environment. */
  access?: Partial<AccessSettings>;
}

const WEB_DIST = path.resolve(import.meta.dirname, '../../web/dist');

export function createApp(options: AppOptions = {}) {
  const logger = options.logger ?? defaultLogger;
  const rateLimits: RateLimitOptions = {
    loginMax: config.loginRateLimitMax,
    loginWindowMinutes: config.loginRateLimitWindowMinutes,
    ...options.rateLimits,
  };
  const access = accessSettings(options.access);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          path: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => callback(null, origin === config.webOrigin),
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id'],
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(checkOrigin);
  app.use(loadSession);

  const api = Router();
  api.use('/health', healthRoutes());
  api.use('/auth', authRoutes(rateLimits));
  api.use('/staff', staffRoutes());
  api.use('/settings', settingsRoutes());
  api.use('/audit-logs', auditRoutes());
  api.use('/members', membersRoutes());
  api.use('/membership-plans', plansRoutes());
  api.use('/memberships', membershipsRoutes());
  api.use('/access', accessRoutes(access));
  api.use('/attendance', attendanceRoutes(access));
  api.use('/devices', devicesRoutes());
  api.use('/biometric', biometricRoutes());
  api.use('/me', portalRoutes());
  api.use('/dashboard', dashboardRoutes());
  api.use(notFoundHandler);
  app.use('/api/v1', api);
  app.use('/api', notFoundHandler);

  // Production: serve the built SPA from the same origin so cookies stay first-party.
  if (config.isProduction && existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST, { index: false, maxAge: '1h' }));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }

  app.use(errorHandler(logger));
  return app;
}
