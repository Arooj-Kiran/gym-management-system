import { z } from 'zod';
import { MEMBER_ACCOUNT_STATUSES, type MemberAccountStatus } from '../enums';
import {
  emailSchema,
  isoDateSchema,
  listQueryBase,
  nameSchema,
  normalizePhone,
  optionalEmailSchema,
  optionalIsoDateSchema,
  optionalPhoneSchema,
  optionalTextSchema,
  passwordSchema,
  phoneSchema,
  queryBooleanSchema,
  reasonSchema,
  requiredReasonSchema,
} from './common';

export const memberAccountStatusSchema = z.enum(MEMBER_ACCOUNT_STATUSES, {
  error: 'Choose an account status',
});

const emergencyContactFields = {
  emergencyContactName: optionalTextSchema(80),
  emergencyContactPhone: optionalPhoneSchema,
  emergencyContactRelation: optionalTextSchema(40),
};

const memberProfileFields = {
  firstName: nameSchema,
  lastName: nameSchema,
  email: optionalEmailSchema,
  phone: phoneSchema,
  ...emergencyContactFields,
  registrationDate: optionalIsoDateSchema,
  notes: optionalTextSchema(2000),
};

/** C2: a shared phone number is saved only after an explicit, reasoned confirmation. */
const duplicatePhoneOverrideFields = {
  confirmDuplicatePhone: z.boolean().optional(),
  duplicatePhoneReason: reasonSchema.optional(),
};

function requireOverrideReason(
  value: { confirmDuplicatePhone?: boolean; duplicatePhoneReason?: string },
  ctx: z.RefinementCtx,
) {
  if (value.confirmDuplicatePhone && (value.duplicatePhoneReason ?? '').length < 3) {
    ctx.addIssue({
      code: 'custom',
      path: ['duplicatePhoneReason'],
      message: 'Say why this phone number is shared (at least 3 characters)',
    });
  }
}

export const createMemberSchema = z
  .strictObject({ ...memberProfileFields, ...duplicatePhoneOverrideFields })
  .superRefine(requireOverrideReason);
export type CreateMemberInput = z.input<typeof createMemberSchema>;

const OVERRIDE_KEYS = new Set(Object.keys(duplicatePhoneOverrideFields));

export const updateMemberSchema = z
  .strictObject({
    ...memberProfileFields,
    registrationDate: isoDateSchema,
    accountStatus: memberAccountStatusSchema,
  })
  .partial()
  .extend(duplicatePhoneOverrideFields)
  .refine(
    (value) => Object.keys(value).some((key) => !OVERRIDE_KEYS.has(key)),
    'Change at least one field',
  )
  .superRefine(requireOverrideReason);
export type UpdateMemberInput = z.input<typeof updateMemberSchema>;

export const archiveMemberSchema = z.strictObject({ reason: requiredReasonSchema });
export type ArchiveMemberInput = z.input<typeof archiveMemberSchema>;

export const restoreMemberSchema = z.strictObject({ reason: reasonSchema.optional() });

export const accessBlockSchema = z.strictObject({ reason: requiredReasonSchema });
export type AccessBlockInput = z.input<typeof accessBlockSchema>;

export const accessUnblockSchema = z.strictObject({ reason: reasonSchema.optional() });

export const createPortalAccountSchema = z.strictObject({ temporaryPassword: passwordSchema });
export type CreatePortalAccountInput = z.input<typeof createPortalAccountSchema>;

/** The pre-check is advisory: unparseable values simply match nothing. */
export const checkDuplicateQuerySchema = z.strictObject({
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((value) => {
      const parsed = emailSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    }),
  phone: z
    .string()
    .trim()
    .max(32)
    .optional()
    .transform((value) => (value ? normalizePhone(value) : null)),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  excludeId: z.uuid({ error: 'Invalid id' }).optional(),
});
export type CheckDuplicateQuery = z.input<typeof checkDuplicateQuerySchema>;

export const MEMBER_SORT_FIELDS = ['name', 'memberCode', 'registrationDate', 'createdAt'] as const;
export const MEMBER_LIST_VIEWS = ['current', 'archived', 'all'] as const;

export const memberListQuerySchema = z.strictObject({
  ...listQueryBase,
  sort: z.enum(MEMBER_SORT_FIELDS).default('createdAt'),
  view: z.enum(MEMBER_LIST_VIEWS).default('current'),
  accountStatus: memberAccountStatusSchema.optional(),
  accessBlocked: queryBooleanSchema.optional(),
  registeredFrom: optionalIsoDateSchema,
  registeredTo: optionalIsoDateSchema,
});
export type MemberListQuery = z.input<typeof memberListQuerySchema>;

/** A member the duplicate check matched. Only identifying fields, never contact details. */
export interface MemberMatch {
  id: string;
  memberCode: string;
  firstName: string;
  lastName: string;
  /** Same first and last name as well as the same phone: may be the same person. */
  sameName: boolean;
}

export interface DuplicateCheckResult {
  emailConflict: Omit<MemberMatch, 'sameName'> | null;
  phoneMatches: MemberMatch[];
}

export interface MemberSummaryDto {
  id: string;
  memberCode: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  photoUrl: string | null;
  registrationDate: string;
  accountStatus: MemberAccountStatus;
  accessBlocked: boolean;
  hasPortalAccount: boolean;
  archivedAt: string | null;
  isDemo: boolean;
  createdAt: string;
}

export interface MemberPortalAccount {
  email: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

export interface MemberDto extends MemberSummaryDto {
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  notes: string | null;
  accessBlockReason: string | null;
  accessBlockedAt: string | null;
  portalAccount: MemberPortalAccount | null;
  updatedAt: string;
}
