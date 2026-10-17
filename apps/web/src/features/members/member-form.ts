import type { MemberAccountStatus, MemberDto } from '@gms/shared';

export interface MemberFormValues {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelation?: string | null;
  registrationDate?: string | null;
  notes?: string | null;
  accountStatus?: MemberAccountStatus;
}

export const MEMBER_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'emergencyContactName',
  'emergencyContactPhone',
  'emergencyContactRelation',
  'registrationDate',
  'notes',
] as const;

export const MEMBER_EDIT_FIELDS = [...MEMBER_FIELDS, 'accountStatus'] as const;

/** Form values for the member inputs: nulls become empty strings. */
export function memberFormValues(member?: MemberDto, registrationDate = '') {
  return {
    firstName: member?.firstName ?? '',
    lastName: member?.lastName ?? '',
    email: member?.email ?? '',
    phone: member?.phone ?? '',
    emergencyContactName: member?.emergencyContactName ?? '',
    emergencyContactPhone: member?.emergencyContactPhone ?? '',
    emergencyContactRelation: member?.emergencyContactRelation ?? '',
    registrationDate: member?.registrationDate ?? registrationDate,
    notes: member?.notes ?? '',
  };
}

export function memberEditValues(member: MemberDto) {
  return { ...memberFormValues(member), accountStatus: member.accountStatus };
}
