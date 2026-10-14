import type { StaffRole } from '@gms/shared';
import type { BadgeTone } from '../../components/ui/badge';

/** One-line summaries of what each role can do (mirrors the permission matrix, PLAN §5). */
export const ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  ADMIN: 'Full access, including staff accounts, roles and settings.',
  MANAGER:
    'Runs daily operations, billing and reports; can view staff and settings but not change them.',
  RECEPTIONIST: 'Front desk: members, check-ins and payments at the counter.',
  TRAINER: 'Own classes, attendance and assigned members.',
};

export const ROLE_TONES: Record<StaffRole, BadgeTone> = {
  ADMIN: 'primary',
  MANAGER: 'neutral',
  RECEPTIONIST: 'neutral',
  TRAINER: 'neutral',
};
