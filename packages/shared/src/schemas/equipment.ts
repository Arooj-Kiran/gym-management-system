import { z } from 'zod';
import { BILLING_LIMITS } from '../billing';
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CONDITIONS,
  EQUIPMENT_STATUSES,
  MAINTENANCE_TYPES,
  type EquipmentCategory,
  type EquipmentCondition,
  type EquipmentStatus,
  type MaintenanceType,
} from '../enums';
import {
  listQueryBase,
  nameSchema,
  optionalIsoDateSchema,
  optionalTextSchema,
  queryBooleanSchema,
  reasonSchema,
} from './common';

export const EQUIPMENT_LIMITS = {
  shortTextMax: 80,
  notesMax: 1000,
  descriptionMax: 1000,
  maxIntervalDays: 730,
  /** Default look-ahead for the maintenance-due list and reminders. */
  defaultDueDays: 7,
  maxDueDays: 90,
} as const;

const costSchema = z
  .int('Enter the amount in whole paisa')
  .min(0, 'Cannot be negative')
  .max(BILLING_LIMITS.maxAmountMinor, 'Amount is too high');

const intervalSchema = z.coerce
  .number({ error: 'Enter a number of days' })
  .int('Enter whole days')
  .min(1, 'At least 1 day')
  .max(EQUIPMENT_LIMITS.maxIntervalDays, `At most ${EQUIPMENT_LIMITS.maxIntervalDays} days`);

const equipmentFields = {
  name: nameSchema,
  category: z.enum(EQUIPMENT_CATEGORIES, { error: 'Choose a category' }),
  brand: optionalTextSchema(EQUIPMENT_LIMITS.shortTextMax),
  model: optionalTextSchema(EQUIPMENT_LIMITS.shortTextMax),
  serialNumber: optionalTextSchema(EQUIPMENT_LIMITS.shortTextMax),
  location: optionalTextSchema(EQUIPMENT_LIMITS.shortTextMax),
  purchaseDate: optionalIsoDateSchema,
  purchaseCostMinor: costSchema.nullish(),
  condition: z.enum(EQUIPMENT_CONDITIONS, { error: 'Choose a condition' }),
  maintenanceIntervalDays: intervalSchema.nullish(),
  nextMaintenanceDate: optionalIsoDateSchema,
  notes: optionalTextSchema(EQUIPMENT_LIMITS.notesMax),
};

export const createEquipmentSchema = z.strictObject(equipmentFields);
export type CreateEquipmentInput = z.input<typeof createEquipmentSchema>;

/** Status changes go through /equipment/:id/status so they always carry a reason. */
export const updateEquipmentSchema = z.strictObject(equipmentFields).partial();
export type UpdateEquipmentInput = z.input<typeof updateEquipmentSchema>;

export const equipmentStatusSchema = z
  .strictObject({
    status: z.enum(EQUIPMENT_STATUSES, { error: 'Choose a status' }),
    reason: reasonSchema.optional(),
  })
  .refine((input) => input.status === 'IN_SERVICE' || (input.reason?.length ?? 0) >= 3, {
    path: ['reason'],
    message: 'Give a short reason (at least 3 characters)',
  });
export type EquipmentStatusInput = z.input<typeof equipmentStatusSchema>;

export const equipmentListQuerySchema = z.strictObject({
  ...listQueryBase,
  category: z.enum(EQUIPMENT_CATEGORIES).optional(),
  status: z.enum(EQUIPMENT_STATUSES).optional(),
  condition: z.enum(EQUIPMENT_CONDITIONS).optional(),
  /** Only items whose next maintenance falls within the default look-ahead (or is overdue). */
  maintenanceDue: queryBooleanSchema.optional(),
});
export type EquipmentListQuery = z.input<typeof equipmentListQuerySchema>;

export const maintenanceDueQuerySchema = z.strictObject({
  days: z.coerce
    .number()
    .int()
    .min(0)
    .max(EQUIPMENT_LIMITS.maxDueDays)
    .default(EQUIPMENT_LIMITS.defaultDueDays),
});
export type MaintenanceDueQuery = z.input<typeof maintenanceDueQuerySchema>;

export const recordMaintenanceSchema = z.strictObject({
  type: z.enum(MAINTENANCE_TYPES, { error: 'Choose a type' }),
  /** Defaults to today in gym time; never in the future. */
  performedOn: optionalIsoDateSchema,
  performedByName: optionalTextSchema(EQUIPMENT_LIMITS.shortTextMax),
  costMinor: costSchema.nullish(),
  description: z
    .string({ error: 'Describe the work done' })
    .trim()
    .min(3, 'Describe the work done (at least 3 characters)')
    .max(
      EQUIPMENT_LIMITS.descriptionMax,
      `Must be ${EQUIPMENT_LIMITS.descriptionMax} characters or fewer`,
    ),
  repairNotes: optionalTextSchema(EQUIPMENT_LIMITS.notesMax),
  conditionAfter: z.enum(EQUIPMENT_CONDITIONS, { error: 'Choose the condition after' }),
  /** Defaults to the performed date plus the item's interval, when it has one. */
  nextMaintenanceDate: optionalIsoDateSchema,
});
export type RecordMaintenanceInput = z.input<typeof recordMaintenanceSchema>;

export interface EquipmentDto {
  id: string;
  assetTag: string;
  name: string;
  category: EquipmentCategory;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  location: string | null;
  purchaseDate: string | null;
  purchaseCostMinor: number | null;
  condition: EquipmentCondition;
  status: EquipmentStatus;
  outOfServiceReason: string | null;
  maintenanceIntervalDays: number | null;
  nextMaintenanceDate: string | null;
  /** Negative when overdue; null without a next date. */
  daysUntilMaintenance: number | null;
  lastMaintenanceOn: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceRecordDto {
  id: string;
  equipmentId: string;
  type: MaintenanceType;
  performedOn: string;
  performedByName: string | null;
  costMinor: number | null;
  description: string;
  repairNotes: string | null;
  conditionAfter: EquipmentCondition;
  nextMaintenanceDate: string | null;
  recordedByName: string | null;
  createdAt: string;
}
