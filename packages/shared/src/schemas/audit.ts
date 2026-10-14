import { z } from 'zod';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, type AuditAction } from '../enums';
import type { Role } from '../roles';
import { isoDateSchema, listQueryBase } from './common';

export const auditListQuerySchema = z
  .strictObject({
    ...listQueryBase,
    action: z.enum(AUDIT_ACTIONS).optional(),
    entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
    entityId: z.uuid().optional(),
    actorUserId: z.uuid().optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: '"From" must be on or before "To"',
    path: ['to'],
  });
export type AuditListQuery = z.input<typeof auditListQuerySchema>;

export interface AuditLogDto {
  id: string;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  actor: { id: string; name: string; email: string } | null;
  actorRole: Role | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}
