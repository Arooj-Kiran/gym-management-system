export interface StaffProfileValues {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  jobTitle?: string | null;
  hireDate?: string | null;
  notes?: string | null;
}

export const PROFILE_FIELDS = [
  'email',
  'firstName',
  'lastName',
  'phone',
  'jobTitle',
  'hireDate',
  'notes',
] as const;

/** Form values for the profile inputs: nulls become empty strings. */
export function profileFormValues(
  staff?: Partial<Record<(typeof PROFILE_FIELDS)[number], string | null>>,
) {
  return {
    email: staff?.email ?? '',
    firstName: staff?.firstName ?? '',
    lastName: staff?.lastName ?? '',
    phone: staff?.phone ?? '',
    jobTitle: staff?.jobTitle ?? '',
    hireDate: staff?.hireDate ?? '',
    notes: staff?.notes ?? '',
  };
}
