import type { EquipmentCondition, EquipmentDto, EquipmentStatus } from '@gms/shared';
import { z } from 'zod';
import type { BadgeTone } from '../../components/ui/badge';

export const CONDITION_TONES: Record<EquipmentCondition, BadgeTone> = {
  EXCELLENT: 'success',
  GOOD: 'primary',
  FAIR: 'warning',
  POOR: 'danger',
};

export const STATUS_TONES: Record<EquipmentStatus, BadgeTone> = {
  IN_SERVICE: 'success',
  OUT_OF_SERVICE: 'warning',
  RETIRED: 'neutral',
};

/** Items whose next maintenance falls within this many days are "due soon". */
export const DUE_SOON_DAYS = 7;

const days = (count: number) => (count === 1 ? '1 day' : `${count} days`);

/** How urgent the next maintenance is, or null when nothing is scheduled. */
export function maintenanceDue(
  item: Pick<EquipmentDto, 'daysUntilMaintenance' | 'status'>,
): { label: string; tone: BadgeTone; urgent: boolean } | null {
  const left = item.daysUntilMaintenance;
  if (left === null || item.status === 'RETIRED') return null;
  if (left < 0) return { label: `Overdue by ${days(-left)}`, tone: 'danger', urgent: true };
  if (left === 0) return { label: 'Due today', tone: 'warning', urgent: true };
  if (left <= DUE_SOON_DAYS)
    return { label: `Due in ${days(left)}`, tone: 'warning', urgent: true };
  return { label: `In ${days(left)}`, tone: 'neutral', urgent: false };
}

const AMOUNT = /^\d+(\.\d{1,2})?$/;

/**
 * An optional amount typed in major units ("45000", "45,000.50") → minor units, or null when
 * left empty. Zero is allowed (a free repair under warranty).
 */
export const optionalMoneyInput = z
  .string()
  .trim()
  .refine((value) => value === '' || AMOUNT.test(value.replace(/[,\s]/g, '')), {
    message: 'Enter an amount such as 45000 or 45000.50',
  })
  .transform((value) =>
    value === '' ? null : Math.round(Number(value.replace(/[,\s]/g, '')) * 100),
  );

/** Optional number inputs: an empty box means "no value", not zero. */
export const emptyToNull = (value: unknown) => (value === '' ? null : value);
