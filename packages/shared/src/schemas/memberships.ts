import { z } from 'zod';
import { MEMBERSHIP_STATUSES, type MembershipEventType, type MembershipStatus } from '../enums';
import { MEMBERSHIP_LIMITS } from '../memberships';
import { listQueryBase, optionalIsoDateSchema, reasonSchema, requiredReasonSchema } from './common';

export const membershipStatusSchema = z.enum(MEMBERSHIP_STATUSES, { error: 'Choose a status' });

/**
 * Optimistic locking: a client that read the membership sends the version it saw, and the
 * change is refused when someone else changed the membership in the meantime.
 */
const versionField = { version: z.int().positive().optional() };

export const assignMembershipSchema = z.strictObject({
  memberId: z.uuid({ error: 'Choose a member' }),
  planId: z.uuid({ error: 'Choose a plan' }),
  /** Defaults to today in gym time. */
  startDate: optionalIsoDateSchema,
});
export type AssignMembershipInput = z.input<typeof assignMembershipSchema>;

export const activateMembershipSchema = z.strictObject({
  reason: reasonSchema.optional(),
  ...versionField,
});
export type ActivateMembershipInput = z.input<typeof activateMembershipSchema>;

export const renewMembershipSchema = z.strictObject({
  /** Defaults to the plan of the membership being renewed. */
  planId: z.uuid({ error: 'Choose a plan' }).optional(),
  reason: reasonSchema.optional(),
  ...versionField,
});
export type RenewMembershipInput = z.input<typeof renewMembershipSchema>;

export const extendMembershipSchema = z.strictObject({
  days: z
    .int('Enter a whole number of days')
    .min(1, 'Add at least 1 day')
    .max(MEMBERSHIP_LIMITS.maxExtendDays, `Add at most ${MEMBERSHIP_LIMITS.maxExtendDays} days`),
  reason: requiredReasonSchema,
  ...versionField,
});
export type ExtendMembershipInput = z.input<typeof extendMembershipSchema>;

export const suspendMembershipSchema = z.strictObject({
  reason: requiredReasonSchema,
  ...versionField,
});
export type SuspendMembershipInput = z.input<typeof suspendMembershipSchema>;

export const reactivateMembershipSchema = z.strictObject({
  /** Push the end date back by the days spent suspended. */
  extendBySuspendedDays: z.boolean().default(false),
  reason: requiredReasonSchema,
  ...versionField,
});
export type ReactivateMembershipInput = z.input<typeof reactivateMembershipSchema>;

export const cancelMembershipSchema = z.strictObject({
  reason: requiredReasonSchema,
  ...versionField,
});
export type CancelMembershipInput = z.input<typeof cancelMembershipSchema>;

export const MEMBERSHIP_SORT_FIELDS = ['endDate', 'startDate', 'createdAt', 'memberName'] as const;

export const membershipListQuerySchema = z.strictObject({
  ...listQueryBase,
  sort: z.enum(MEMBERSHIP_SORT_FIELDS).default('endDate'),
  /** Matches the effective status (an ACTIVE membership past its end date counts as EXPIRED). */
  status: membershipStatusSchema.optional(),
  planId: z.uuid({ error: 'Invalid plan' }).optional(),
  memberId: z.uuid({ error: 'Invalid member' }).optional(),
  /** Active memberships ending within N days that have no renewal lined up. */
  expiringWithinDays: z.coerce
    .number()
    .int()
    .min(0)
    .max(MEMBERSHIP_LIMITS.maxExpiringWithinDays)
    .optional(),
  /** Memberships whose period overlaps [from, to]. */
  from: optionalIsoDateSchema,
  to: optionalIsoDateSchema,
});
export type MembershipListQuery = z.input<typeof membershipListQuerySchema>;

export interface MembershipMemberRef {
  id: string;
  memberCode: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
}

/** The membership a member is "on" right now; shown on member lists and cards. */
export interface MembershipBrief {
  id: string;
  planName: string;
  status: MembershipStatus;
  /** What today means for it: ACTIVE past its end date reads as EXPIRED. */
  effectiveStatus: MembershipStatus;
  startDate: string;
  endDate: string;
}

export interface MembershipDto extends MembershipBrief {
  memberId: string;
  planId: string;
  /** Snapshots taken at assignment; later plan edits do not rewrite them. */
  priceMinor: number;
  accessDays: number[] | null;
  accessStartTime: string | null;
  accessEndTime: string | null;
  activatedAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  totalSuspendedDays: number;
  renewedFromId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  member: MembershipMemberRef;
}

export interface MembershipEventDto {
  id: string;
  membershipId: string;
  planName: string;
  eventType: MembershipEventType;
  fromStatus: MembershipStatus | null;
  toStatus: MembershipStatus;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  reason: string | null;
  /** null when the system (the nightly expiry job) made the change. */
  actorName: string | null;
  createdAt: string;
}

/** Portal view: the member's own membership, without staff-only notes or reasons. */
export interface MyMembershipDto {
  id: string;
  planName: string;
  priceMinor: number;
  status: MembershipStatus;
  effectiveStatus: MembershipStatus;
  startDate: string;
  endDate: string;
  accessDays: number[] | null;
  accessStartTime: string | null;
  accessEndTime: string | null;
}

export interface MyMembershipOverview {
  current: MyMembershipDto | null;
  /** A renewal already lined up after the current period. */
  next: MyMembershipDto | null;
  /** Days left including today, for a current period that has started; otherwise null. */
  daysLeft: number | null;
  /** True when the current period ends within the gym's reminder window and nothing follows. */
  expiringSoon: boolean;
}
