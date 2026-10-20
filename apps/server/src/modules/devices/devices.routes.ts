import {
  createDeviceSchema,
  deviceActionSchema,
  deviceHeartbeatSchema,
  idParamSchema,
  updateDeviceSchema,
} from '@gms/shared';
import { Router, type Request } from 'express';
import { requestContext } from '../../lib/request-context';
import { requirePermission, requireStaffRole } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import { parseInput } from '../../middleware/validate';
import { requireDevice } from '../access/device-auth';
import * as devicesService from './devices.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;

export function devicesRoutes() {
  const router = Router();

  // The agent's heartbeat authenticates with the device key, not a session.
  router.post('/heartbeat', requireDevice, async (req, res) => {
    const input = parseInput(deviceHeartbeatSchema, req.body);
    res.json(await devicesService.recordHeartbeat(req.device!, input));
  });

  router.use(...authenticated, requireStaffRole, requirePermission('devices:manage'));
  router.get('/', async (_req, res) => {
    res.json({ data: await devicesService.listDevices() });
  });
  router.post('/', async (req, res) => {
    const input = parseInput(createDeviceSchema, req.body);
    res.status(201).json(await devicesService.createDevice(input, requestContext(req)));
  });
  router.get('/:id', async (req, res) => {
    res.json(await devicesService.getDevice(idOf(req)));
  });
  router.patch('/:id', async (req, res) => {
    const id = idOf(req);
    const input = parseInput(updateDeviceSchema, req.body);
    res.json(await devicesService.updateDevice(id, input, requestContext(req)));
  });
  router.post('/:id/rotate-key', async (req, res) => {
    const id = idOf(req);
    const { reason } = parseInput(deviceActionSchema, req.body ?? {});
    res.json(await devicesService.rotateDeviceKey(id, reason, requestContext(req)));
  });
  router.post('/:id/disable', async (req, res) => {
    const id = idOf(req);
    const { reason } = parseInput(deviceActionSchema, req.body ?? {});
    res.json(await devicesService.setDeviceStatus(id, 'DISABLED', reason, requestContext(req)));
  });
  router.post('/:id/enable', async (req, res) => {
    const id = idOf(req);
    const { reason } = parseInput(deviceActionSchema, req.body ?? {});
    res.json(await devicesService.setDeviceStatus(id, 'ACTIVE', reason, requestContext(req)));
  });
  return router;
}
