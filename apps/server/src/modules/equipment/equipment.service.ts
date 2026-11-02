import {
  addDays,
  daysBetween,
  ERROR_CODES,
  EQUIPMENT_LIMITS,
  hasPermission,
  type EquipmentDto,
  type MaintenanceRecordDto,
  type Paginated,
  type createEquipmentSchema,
  type equipmentListQuerySchema,
  type equipmentStatusSchema,
  type recordMaintenanceSchema,
  type updateEquipmentSchema,
} from '@gms/shared';
import { and, asc, count, desc, eq, lte, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { db, type DbExecutor } from '../../db/client';
import { equipment, maintenanceRecords, users } from '../../db/schema';
import { diffFields, recordAudit } from '../../lib/audit';
import { gymToday } from '../../lib/dates';
import { isUniqueViolation } from '../../lib/db-errors';
import { conflict, notFound, validationFailed } from '../../lib/errors';
import { likePattern, pageOffset, paginated } from '../../lib/pagination';
import type { RequestContext } from '../../lib/request-context';
import { qualified } from '../memberships/current-membership';

type CreateEquipment = z.output<typeof createEquipmentSchema>;
type UpdateEquipment = z.output<typeof updateEquipmentSchema>;
type EquipmentStatusInput = z.output<typeof equipmentStatusSchema>;
type EquipmentListQuery = z.output<typeof equipmentListQuerySchema>;
type RecordMaintenance = z.output<typeof recordMaintenanceSchema>;
type EquipmentRow = typeof equipment.$inferSelect;
type Auth = Express.AuthContext;

/** Costs are management information: only roles that manage equipment see them. */
const seesCosts = (auth: Auth) => hasPermission(auth.user.role, 'equipment:manage');

const lastMaintenanceSql = sql<string | null>`(select max(mr.performed_on)::text
  from maintenance_records mr where mr.equipment_id = ${qualified(equipment.id)})`;

function selectEquipment(executor: DbExecutor = db) {
  return executor
    .select({ item: equipment, lastMaintenanceOn: lastMaintenanceSql })
    .from(equipment);
}

type EquipmentSelectRow = Awaited<ReturnType<typeof selectEquipment>>[number];

function toDto(row: EquipmentSelectRow, showCosts: boolean, today = gymToday()): EquipmentDto {
  const { item } = row;
  return {
    id: item.id,
    assetTag: item.assetTag,
    name: item.name,
    category: item.category,
    brand: item.brand,
    model: item.model,
    serialNumber: item.serialNumber,
    location: item.location,
    purchaseDate: item.purchaseDate,
    purchaseCostMinor: showCosts ? item.purchaseCostMinor : null,
    condition: item.condition,
    status: item.status,
    outOfServiceReason: item.outOfServiceReason,
    maintenanceIntervalDays: item.maintenanceIntervalDays,
    nextMaintenanceDate: item.nextMaintenanceDate,
    daysUntilMaintenance:
      item.nextMaintenanceDate && item.status !== 'RETIRED'
        ? daysBetween(today, item.nextMaintenanceDate)
        : null,
    lastMaintenanceOn: row.lastMaintenanceOn,
    notes: item.notes,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function writeError(error: unknown): unknown {
  if (isUniqueViolation(error, 'equipment_serial_number_key')) {
    return conflict(
      ERROR_CODES.DUPLICATE_SERIAL_NUMBER,
      'Another item already has this serial number.',
    );
  }
  return error;
}

async function requireEquipment(executor: DbExecutor, id: string, forUpdate = false) {
  const query = executor.select().from(equipment).where(eq(equipment.id, id)).limit(1);
  const [row] = forUpdate ? await query.for('update') : await query;
  if (!row) throw notFound('Equipment');
  return row;
}

async function readEquipment(executor: DbExecutor, id: string, showCosts: boolean) {
  const [row] = await selectEquipment(executor).where(eq(equipment.id, id)).limit(1);
  if (!row) throw notFound('Equipment');
  return toDto(row, showCosts);
}

function assertNotRetired(row: EquipmentRow) {
  if (row.status === 'RETIRED') {
    throw conflict(ERROR_CODES.EQUIPMENT_RETIRED, 'This item is retired and can no longer change.');
  }
}

/** Not retired, with a next maintenance date on or before `until` (overdue included). */
const dueBy = (until: string) =>
  and(ne(equipment.status, 'RETIRED'), lte(equipment.nextMaintenanceDate, until));

// --- Reads --------------------------------------------------------------------------------

export async function listEquipment(
  query: EquipmentListQuery,
  auth: Auth,
): Promise<Paginated<EquipmentDto>> {
  const today = gymToday();
  const search = query.q ? likePattern(query.q) : null;
  const where = and(
    query.category ? eq(equipment.category, query.category) : undefined,
    query.status ? eq(equipment.status, query.status) : undefined,
    query.condition ? eq(equipment.condition, query.condition) : undefined,
    query.maintenanceDue ? dueBy(addDays(today, EQUIPMENT_LIMITS.defaultDueDays)) : undefined,
    search
      ? sql`(${equipment.name} ilike ${search} or ${equipment.assetTag} ilike ${search}
          or ${equipment.serialNumber}::text ilike ${search} or ${equipment.location} ilike ${search})`
      : undefined,
  );
  const [rows, [total]] = await Promise.all([
    selectEquipment()
      .where(where)
      .orderBy(sql`${equipment.status} = 'RETIRED'`, asc(equipment.name), asc(equipment.assetTag))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db.select({ count: count() }).from(equipment).where(where),
  ]);
  const showCosts = seesCosts(auth);
  return paginated(
    rows.map((row) => toDto(row, showCosts, today)),
    query.page,
    query.pageSize,
    total?.count ?? 0,
  );
}

/** Items due for maintenance within `days` (overdue first). */
export async function maintenanceDue(days: number, auth: Auth): Promise<EquipmentDto[]> {
  const today = gymToday();
  const rows = await selectEquipment()
    .where(dueBy(addDays(today, days)))
    .orderBy(asc(equipment.nextMaintenanceDate), asc(equipment.name))
    .limit(200);
  const showCosts = seesCosts(auth);
  return rows.map((row) => toDto(row, showCosts, today));
}

export async function getEquipment(id: string, auth: Auth): Promise<EquipmentDto> {
  return readEquipment(db, id, seesCosts(auth));
}

const recorder = alias(users, 'maintenance_recorder');

function selectRecords() {
  return db
    .select({
      record: maintenanceRecords,
      firstName: recorder.firstName,
      lastName: recorder.lastName,
    })
    .from(maintenanceRecords)
    .leftJoin(recorder, eq(recorder.id, maintenanceRecords.recordedBy));
}

function toRecordDto(
  { record, firstName, lastName }: Awaited<ReturnType<typeof selectRecords>>[number],
  showCosts: boolean,
): MaintenanceRecordDto {
  return {
    id: record.id,
    equipmentId: record.equipmentId,
    type: record.type,
    performedOn: record.performedOn,
    performedByName: record.performedByName,
    costMinor: showCosts ? record.costMinor : null,
    description: record.description,
    repairNotes: record.repairNotes,
    conditionAfter: record.conditionAfter,
    nextMaintenanceDate: record.nextMaintenanceDate,
    recordedByName: firstName ? `${firstName} ${lastName}` : null,
    createdAt: record.createdAt.toISOString(),
  };
}

export async function listMaintenance(id: string, auth: Auth): Promise<MaintenanceRecordDto[]> {
  await requireEquipment(db, id);
  const rows = await selectRecords()
    .where(eq(maintenanceRecords.equipmentId, id))
    .orderBy(desc(maintenanceRecords.performedOn), desc(maintenanceRecords.createdAt));
  const showCosts = seesCosts(auth);
  return rows.map((row) => toRecordDto(row, showCosts));
}

// --- Writes -------------------------------------------------------------------------------

/** Without a next date, an item with an interval is first due one interval from today. */
export async function createEquipment(
  input: CreateEquipment,
  ctx: RequestContext,
): Promise<EquipmentDto> {
  const nextMaintenanceDate =
    input.nextMaintenanceDate ??
    (input.maintenanceIntervalDays ? addDays(gymToday(), input.maintenanceIntervalDays) : null);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(equipment)
        .values({
          ...input,
          purchaseCostMinor: input.purchaseCostMinor ?? null,
          maintenanceIntervalDays: input.maintenanceIntervalDays ?? null,
          nextMaintenanceDate,
          createdBy: ctx.actorUserId,
        })
        .returning({ id: equipment.id, assetTag: equipment.assetTag });
      await recordAudit(tx, ctx, {
        action: 'EQUIPMENT_CREATED',
        entityType: 'EQUIPMENT',
        entityId: row!.id,
        after: { assetTag: row!.assetTag, name: input.name, category: input.category },
      });
      return readEquipment(tx, row!.id, true);
    });
  } catch (error) {
    throw writeError(error);
  }
}

export async function updateEquipment(
  id: string,
  input: UpdateEquipment,
  ctx: RequestContext,
): Promise<EquipmentDto> {
  try {
    return await db.transaction(async (tx) => {
      const current = await requireEquipment(tx, id, true);
      assertNotRetired(current);
      const diff = diffFields(current, input);
      if (Object.keys(diff.after).length > 0) {
        await tx
          .update(equipment)
          .set(diff.after as Partial<EquipmentRow>)
          .where(eq(equipment.id, id));
        await recordAudit(tx, ctx, {
          action: 'EQUIPMENT_UPDATED',
          entityType: 'EQUIPMENT',
          entityId: id,
          before: diff.before,
          after: diff.after,
        });
      }
      return readEquipment(tx, id, true);
    });
  } catch (error) {
    throw writeError(error);
  }
}

/** Out of service and retired always carry a reason; back in service clears it. */
export async function changeStatus(
  id: string,
  input: EquipmentStatusInput,
  ctx: RequestContext,
): Promise<EquipmentDto> {
  return db.transaction(async (tx) => {
    const current = await requireEquipment(tx, id, true);
    assertNotRetired(current);
    const reason = input.status === 'IN_SERVICE' ? null : (input.reason ?? null);
    if (current.status === input.status && current.outOfServiceReason === reason) {
      return readEquipment(tx, id, true);
    }
    await tx
      .update(equipment)
      .set({ status: input.status, outOfServiceReason: reason })
      .where(eq(equipment.id, id));
    await recordAudit(tx, ctx, {
      action: 'EQUIPMENT_STATUS_CHANGED',
      entityType: 'EQUIPMENT',
      entityId: id,
      before: { status: current.status },
      after: { status: input.status },
      reason: input.reason,
    });
    return readEquipment(tx, id, true);
  });
}

/**
 * Append a maintenance record. The next date defaults to the performed date plus the item's
 * interval. The item's condition and next date follow the most recent record, so entering an
 * older visit afterwards does not move them back.
 */
export async function recordMaintenance(
  id: string,
  input: RecordMaintenance,
  ctx: RequestContext,
): Promise<MaintenanceRecordDto> {
  const today = gymToday();
  const performedOn = input.performedOn ?? today;
  if (performedOn > today) {
    throw validationFailed([{ path: 'performedOn', message: 'Cannot be in the future' }]);
  }
  const record = await db.transaction(async (tx) => {
    const current = await requireEquipment(tx, id, true);
    assertNotRetired(current);
    const nextMaintenanceDate =
      input.nextMaintenanceDate ??
      (current.maintenanceIntervalDays
        ? addDays(performedOn, current.maintenanceIntervalDays)
        : null);
    if (nextMaintenanceDate && nextMaintenanceDate <= performedOn) {
      throw validationFailed([
        { path: 'nextMaintenanceDate', message: 'Must be after the maintenance date' },
      ]);
    }
    const [latest] = await tx
      .select({ performedOn: maintenanceRecords.performedOn })
      .from(maintenanceRecords)
      .where(eq(maintenanceRecords.equipmentId, id))
      .orderBy(desc(maintenanceRecords.performedOn))
      .limit(1);
    const [row] = await tx
      .insert(maintenanceRecords)
      .values({
        equipmentId: id,
        type: input.type,
        performedOn,
        performedByName: input.performedByName,
        costMinor: input.costMinor ?? null,
        description: input.description,
        repairNotes: input.repairNotes,
        conditionAfter: input.conditionAfter,
        nextMaintenanceDate,
        recordedBy: ctx.actorUserId,
      })
      .returning();
    const isLatest = !latest || performedOn >= latest.performedOn;
    if (isLatest) {
      await tx
        .update(equipment)
        .set({ condition: input.conditionAfter, nextMaintenanceDate })
        .where(eq(equipment.id, id));
    }
    await recordAudit(tx, ctx, {
      action: 'MAINTENANCE_RECORDED',
      entityType: 'MAINTENANCE_RECORD',
      entityId: row!.id,
      before: isLatest
        ? { condition: current.condition, nextMaintenanceDate: current.nextMaintenanceDate }
        : undefined,
      after: {
        equipmentId: id,
        type: input.type,
        performedOn,
        conditionAfter: input.conditionAfter,
        nextMaintenanceDate,
        updatedItem: isLatest,
      },
    });
    return row!;
  });
  const [row] = await selectRecords().where(eq(maintenanceRecords.id, record.id)).limit(1);
  return toRecordDto(row!, true);
}
