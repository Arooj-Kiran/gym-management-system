import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CONDITIONS,
  EQUIPMENT_STATUSES,
  MAINTENANCE_TYPES,
} from '@gms/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  pgEnum,
  pgSequence,
  pgTable,
  smallint,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { citext, primaryId, timestamps, timestamptz } from './columns';
import { users } from './users';

export const equipmentCategoryEnum = pgEnum('equipment_category', EQUIPMENT_CATEGORIES);
export const equipmentConditionEnum = pgEnum('equipment_condition', EQUIPMENT_CONDITIONS);
export const equipmentStatusEnum = pgEnum('equipment_status', EQUIPMENT_STATUSES);
export const maintenanceTypeEnum = pgEnum('maintenance_type', MAINTENANCE_TYPES);

export const equipmentTagSeq = pgSequence('equipment_tag_seq', { startWith: 1, increment: 1 });

/** Equipment register (PLAN §3.10). Never deleted: RETIRED keeps the history. */
export const equipment = pgTable(
  'equipment',
  {
    id: primaryId(),
    assetTag: varchar('asset_tag', { length: 16 })
      .notNull()
      .default(sql`'EQ-' || lpad(nextval('equipment_tag_seq')::text, 6, '0')`),
    name: varchar('name', { length: 80 }).notNull(),
    category: equipmentCategoryEnum('category').notNull(),
    brand: varchar('brand', { length: 80 }),
    model: varchar('model', { length: 80 }),
    serialNumber: citext('serial_number'),
    location: varchar('location', { length: 80 }),
    purchaseDate: date('purchase_date', { mode: 'string' }),
    purchaseCostMinor: bigint('purchase_cost_minor', { mode: 'number' }),
    condition: equipmentConditionEnum('condition').notNull().default('GOOD'),
    status: equipmentStatusEnum('status').notNull().default('IN_SERVICE'),
    outOfServiceReason: varchar('out_of_service_reason', { length: 500 }),
    maintenanceIntervalDays: smallint('maintenance_interval_days'),
    nextMaintenanceDate: date('next_maintenance_date', { mode: 'string' }),
    notes: varchar('notes', { length: 1000 }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('equipment_asset_tag_key').on(t.assetTag),
    uniqueIndex('equipment_serial_number_key')
      .on(t.serialNumber)
      .where(sql`${t.serialNumber} is not null`),
    index('equipment_status_idx').on(t.status),
    index('equipment_next_maintenance_idx').on(t.nextMaintenanceDate),
    index('equipment_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
    check(
      'equipment_purchase_cost',
      sql`${t.purchaseCostMinor} is null or ${t.purchaseCostMinor} >= 0`,
    ),
    check(
      'equipment_interval',
      sql`${t.maintenanceIntervalDays} is null or ${t.maintenanceIntervalDays} between 1 and 730`,
    ),
    check(
      'equipment_out_of_service_reason',
      sql`(${t.status} = 'IN_SERVICE') = (${t.outOfServiceReason} is null)`,
    ),
  ],
);

/** Append-only (trigger in the migrations): a mistake is corrected by a new record. */
export const maintenanceRecords = pgTable(
  'maintenance_records',
  {
    id: primaryId(),
    equipmentId: uuid('equipment_id')
      .notNull()
      .references(() => equipment.id, { onDelete: 'restrict' }),
    type: maintenanceTypeEnum('type').notNull(),
    performedOn: date('performed_on', { mode: 'string' }).notNull(),
    performedByName: varchar('performed_by_name', { length: 80 }),
    costMinor: bigint('cost_minor', { mode: 'number' }),
    description: varchar('description', { length: 1000 }).notNull(),
    repairNotes: varchar('repair_notes', { length: 1000 }),
    conditionAfter: equipmentConditionEnum('condition_after').notNull(),
    nextMaintenanceDate: date('next_maintenance_date', { mode: 'string' }),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('maintenance_records_equipment_idx').on(t.equipmentId, t.performedOn.desc()),
    check('maintenance_records_cost', sql`${t.costMinor} is null or ${t.costMinor} >= 0`),
    check(
      'maintenance_records_next_date',
      sql`${t.nextMaintenanceDate} is null or ${t.nextMaintenanceDate} > ${t.performedOn}`,
    ),
  ],
);
