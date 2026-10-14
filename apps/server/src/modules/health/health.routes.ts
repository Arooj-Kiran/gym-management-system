import { ERROR_CODES } from '@gms/shared';
import { sql } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../../db/client';

export function healthRoutes() {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/ready', async (_req, res) => {
    try {
      await db.execute(sql`select 1`);
      res.json({ status: 'ready', database: 'ok' });
    } catch {
      res.status(503).json({
        error: { code: ERROR_CODES.SERVICE_UNAVAILABLE, message: 'Database is not reachable.' },
      });
    }
  });

  return router;
}
