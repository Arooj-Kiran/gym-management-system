import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import { auditLogs } from '../../src/db/schema';
import { signIn, testApp, type Session } from '../setup/auth';
import { resetTables } from '../setup/db';
import { createUser } from '../setup/factories';
import { api, gymDate } from '../setup/scheduling';

const app = testApp();

let admin: Session;
let manager: Session;
let reception: Session;
let trainer: Session;

beforeEach(async () => {
  await resetTables();
  admin = await signIn(app, await createUser({ role: 'ADMIN' }));
  manager = await signIn(app, await createUser({ role: 'MANAGER' }));
  reception = await signIn(app, await createUser({ role: 'RECEPTIONIST' }));
  trainer = await signIn(app, await createUser({ role: 'TRAINER' }));
});
afterAll(closeDb);

const treadmill = (overrides: object = {}) => ({
  name: 'Treadmill T5',
  category: 'CARDIO',
  brand: 'Life Fitness',
  serialNumber: 'LF-T5-001234',
  location: 'Cardio floor',
  purchaseDate: '2025-02-10',
  purchaseCostMinor: 85_000_000,
  condition: 'GOOD',
  maintenanceIntervalDays: 90,
  ...overrides,
});

async function create(overrides: object = {}) {
  const res = await api(manager).post('/equipment', treadmill(overrides));
  expect(res.status).toBe(201);
  return res.body as { id: string; assetTag: string; nextMaintenanceDate: string | null };
}

describe('equipment register', () => {
  it('creates with an asset tag and a first due date one interval away', async () => {
    const item = await create();
    expect(item).toMatchObject({
      assetTag: expect.stringMatching(/^EQ-/),
      status: 'IN_SERVICE',
      condition: 'GOOD',
      purchaseCostMinor: 85_000_000,
      nextMaintenanceDate: gymDate(90),
      daysUntilMaintenance: 90,
      lastMaintenanceOn: null,
    });
    const audit = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'EQUIPMENT_CREATED'), eq(auditLogs.entityId, item.id)));
    expect(audit).toHaveLength(1);
  });

  it('refuses a duplicate serial number', async () => {
    await create();
    const res = await api(manager).post('/equipment', treadmill({ name: 'Second treadmill' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_SERIAL_NUMBER');
  });

  it('hides costs from roles that cannot manage equipment', async () => {
    const item = await create();
    await api(manager).post(`/equipment/${item.id}/maintenance`, {
      type: 'REPAIR',
      description: 'Replaced the running belt',
      costMinor: 1_200_000,
      conditionAfter: 'GOOD',
    });
    for (const session of [reception, trainer]) {
      const read = await api(session).get(`/equipment/${item.id}`);
      expect(read.status).toBe(200);
      expect(read.body.purchaseCostMinor).toBeNull();
      const records = await api(session).get(`/equipment/${item.id}/maintenance`);
      expect(records.body[0].costMinor).toBeNull();
    }
    expect((await api(admin).get(`/equipment/${item.id}/maintenance`)).body[0].costMinor).toBe(
      1_200_000,
    );
    const write = await api(reception).post('/equipment', treadmill({ serialNumber: 'X-1' }));
    expect(write.status).toBe(403);
  });

  it('searches and filters', async () => {
    await create();
    await create({
      name: 'Adjustable Bench',
      category: 'FREE_WEIGHTS',
      serialNumber: null,
      location: 'Free weights area',
      condition: 'FAIR',
    });
    const search = await api(trainer).get('/equipment?q=bench');
    expect(search.body.data.map((e: { name: string }) => e.name)).toEqual(['Adjustable Bench']);
    const fair = await api(trainer).get('/equipment?condition=FAIR');
    expect(fair.body.total).toBe(1);
    const cardio = await api(trainer).get('/equipment?category=CARDIO');
    expect(cardio.body.data.map((e: { name: string }) => e.name)).toEqual(['Treadmill T5']);
  });

  it('updates details with an audit diff', async () => {
    const item = await create();
    const res = await api(manager).patch(`/equipment/${item.id}`, { location: 'Mezzanine' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ location: 'Mezzanine', name: 'Treadmill T5' });
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'EQUIPMENT_UPDATED'), eq(auditLogs.entityId, item.id)));
    expect(audit).toMatchObject({
      before: { location: 'Cardio floor' },
      after: { location: 'Mezzanine' },
    });
  });
});

describe('status', () => {
  it('needs a reason out of service, clears it back in service, and retired is final', async () => {
    const item = await create();
    const noReason = await api(manager).post(`/equipment/${item.id}/status`, {
      status: 'OUT_OF_SERVICE',
    });
    expect(noReason.status).toBe(400);

    const out = await api(manager).post(`/equipment/${item.id}/status`, {
      status: 'OUT_OF_SERVICE',
      reason: 'Belt slipping under load',
    });
    expect(out.body).toMatchObject({
      status: 'OUT_OF_SERVICE',
      outOfServiceReason: 'Belt slipping under load',
    });
    const back = await api(manager).post(`/equipment/${item.id}/status`, { status: 'IN_SERVICE' });
    expect(back.body).toMatchObject({ status: 'IN_SERVICE', outOfServiceReason: null });

    const retired = await api(manager).post(`/equipment/${item.id}/status`, {
      status: 'RETIRED',
      reason: 'Motor beyond repair',
    });
    expect(retired.body).toMatchObject({ status: 'RETIRED', daysUntilMaintenance: null });
    for (const call of [
      () => api(manager).patch(`/equipment/${item.id}`, { location: 'Store room' }),
      () => api(manager).post(`/equipment/${item.id}/status`, { status: 'IN_SERVICE' }),
      () =>
        api(manager).post(`/equipment/${item.id}/maintenance`, {
          type: 'INSPECTION',
          description: 'Final check',
          conditionAfter: 'POOR',
        }),
    ]) {
      const res = await call();
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EQUIPMENT_RETIRED');
    }

    const statusAudit = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.action, 'EQUIPMENT_STATUS_CHANGED'), eq(auditLogs.entityId, item.id)),
      );
    expect(statusAudit).toHaveLength(3);
  });
});

describe('maintenance records', () => {
  it('updates condition and the next due date from the latest record only', async () => {
    const item = await create({ condition: 'FAIR' });
    const recent = await api(manager).post(`/equipment/${item.id}/maintenance`, {
      type: 'PREVENTIVE',
      performedOn: gymDate(-1),
      performedByName: 'FitServe Technicians',
      description: 'Lubricated deck, calibrated speed sensor',
      conditionAfter: 'EXCELLENT',
      costMinor: 450_000,
    });
    expect(recent.status).toBe(201);
    expect(recent.body).toMatchObject({
      nextMaintenanceDate: gymDate(89),
      conditionAfter: 'EXCELLENT',
      costMinor: 450_000,
    });
    let read = await api(manager).get(`/equipment/${item.id}`);
    expect(read.body).toMatchObject({
      condition: 'EXCELLENT',
      nextMaintenanceDate: gymDate(89),
      lastMaintenanceOn: gymDate(-1),
    });

    // An older visit entered afterwards is kept but does not move the item back.
    const older = await api(manager).post(`/equipment/${item.id}/maintenance`, {
      type: 'INSPECTION',
      performedOn: gymDate(-20),
      description: 'Monthly safety check',
      conditionAfter: 'FAIR',
    });
    expect(older.status).toBe(201);
    read = await api(manager).get(`/equipment/${item.id}`);
    expect(read.body).toMatchObject({ condition: 'EXCELLENT', nextMaintenanceDate: gymDate(89) });

    const history = await api(trainer).get(`/equipment/${item.id}/maintenance`);
    expect(history.body.map((r: { performedOn: string }) => r.performedOn)).toEqual([
      gymDate(-1),
      gymDate(-20),
    ]);

    const audit = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'MAINTENANCE_RECORDED'));
    expect(audit).toHaveLength(2);
  });

  it('refuses future work and a next date that is not after the work', async () => {
    const item = await create();
    const future = await api(manager).post(`/equipment/${item.id}/maintenance`, {
      type: 'REPAIR',
      performedOn: gymDate(1),
      description: 'Not yet done',
      conditionAfter: 'GOOD',
    });
    expect(future.status).toBe(400);
    const backwards = await api(manager).post(`/equipment/${item.id}/maintenance`, {
      type: 'REPAIR',
      description: 'Fixed console',
      conditionAfter: 'GOOD',
      nextMaintenanceDate: gymDate(0),
    });
    expect(backwards.status).toBe(400);
    expect(backwards.body.error.details[0].path).toBe('nextMaintenanceDate');
  });

  it('lists items due within the window, overdue first, and never retired ones', async () => {
    const overdue = await create({
      name: 'Rowing Machine',
      serialNumber: 'C2-1',
      nextMaintenanceDate: gymDate(-3),
    });
    const soon = await create({
      name: 'Leg Press',
      serialNumber: 'LP-1',
      nextMaintenanceDate: gymDate(5),
    });
    await create({ name: 'Spin Bike', serialNumber: 'SB-1', nextMaintenanceDate: gymDate(30) });
    const retired = await create({
      name: 'Old Stepper',
      serialNumber: 'ST-1',
      nextMaintenanceDate: gymDate(-10),
    });
    await api(manager).post(`/equipment/${retired.id}/status`, {
      status: 'RETIRED',
      reason: 'Replaced',
    });

    const due = await api(reception).get('/equipment/maintenance-due');
    expect(due.status).toBe(200);
    expect(due.body.map((e: { id: string }) => e.id)).toEqual([overdue.id, soon.id]);
    expect(due.body[0].daysUntilMaintenance).toBe(-3);

    const wider = await api(reception).get('/equipment/maintenance-due?days=30');
    expect(wider.body).toHaveLength(3);
    const flagged = await api(reception).get('/equipment?maintenanceDue=true');
    expect(flagged.body.total).toBe(2);
  });
});
