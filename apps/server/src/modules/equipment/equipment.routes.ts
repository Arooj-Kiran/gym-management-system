import {
  createEquipmentSchema,
  equipmentListQuerySchema,
  equipmentStatusSchema,
  idParamSchema,
  maintenanceDueQuerySchema,
  recordMaintenanceSchema,
  updateEquipmentSchema,
} from '@gms/shared';
import { Router, type Request } from 'express';
import { requestContext, requireAuthContext } from '../../lib/request-context';
import { requirePermission, requireStaffRole } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import { parseInput } from '../../middleware/validate';
import * as equipment from './equipment.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const auth = (req: Request) => requireAuthContext(req);

/** /equipment — register, status and maintenance records (PLAN §4.9). */
export function equipmentRoutes() {
  const router = Router();
  router.use(...authenticated, requireStaffRole, requirePermission('equipment:read'));
  router.get('/', async (req, res) => {
    const query = parseInput(equipmentListQuerySchema, req.query);
    res.json(await equipment.listEquipment(query, auth(req)));
  });
  // Before /:id so "maintenance-due" is never read as an id.
  router.get('/maintenance-due', async (req, res) => {
    const { days } = parseInput(maintenanceDueQuerySchema, req.query);
    res.json(await equipment.maintenanceDue(days, auth(req)));
  });
  router.get('/:id', async (req, res) => {
    res.json(await equipment.getEquipment(idOf(req), auth(req)));
  });
  router.get('/:id/maintenance', async (req, res) => {
    res.json(await equipment.listMaintenance(idOf(req), auth(req)));
  });
  router.post('/', requirePermission('equipment:manage'), async (req, res) => {
    const input = parseInput(createEquipmentSchema, req.body);
    res.status(201).json(await equipment.createEquipment(input, requestContext(req)));
  });
  router.patch('/:id', requirePermission('equipment:manage'), async (req, res) => {
    const id = idOf(req);
    const input = parseInput(updateEquipmentSchema, req.body);
    res.json(await equipment.updateEquipment(id, input, requestContext(req)));
  });
  router.post('/:id/status', requirePermission('equipment:manage'), async (req, res) => {
    const id = idOf(req);
    const input = parseInput(equipmentStatusSchema, req.body);
    res.json(await equipment.changeStatus(id, input, requestContext(req)));
  });
  router.post('/:id/maintenance', requirePermission('equipment:manage'), async (req, res) => {
    const id = idOf(req);
    const input = parseInput(recordMaintenanceSchema, req.body);
    res.status(201).json(await equipment.recordMaintenance(id, input, requestContext(req)));
  });
  return router;
}
