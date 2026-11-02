import { idParamSchema, notificationListQuerySchema } from '@gms/shared';
import { Router, type Request } from 'express';
import { requireAuthContext } from '../../lib/request-context';
import { requirePermission, requireStaffRole } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import { parseInput } from '../../middleware/validate';
import * as notifications from './notifications.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const userIdOf = (req: Request) => requireAuthContext(req).user.id;

/** /notifications — every role, always the signed-in user's own (PLAN §4.8). */
export function notificationsRoutes() {
  const router = Router();
  router.use(...authenticated);

  router.get(
    '/channels',
    requireStaffRole,
    requirePermission('settings:read'),
    async (_req, res) => {
      res.json(await notifications.channelStatuses());
    },
  );

  router.use(requirePermission('notifications:read'));
  router.get('/', async (req, res) => {
    const query = parseInput(notificationListQuerySchema, req.query);
    res.json(await notifications.listNotifications(userIdOf(req), query));
  });
  router.get('/unread-count', async (req, res) => {
    res.json(await notifications.unreadCount(userIdOf(req)));
  });
  router.post('/read-all', async (req, res) => {
    res.json(await notifications.markAllRead(userIdOf(req)));
  });
  router.post('/:id/read', async (req, res) => {
    res.json(await notifications.markRead(userIdOf(req), idOf(req)));
  });

  return router;
}
