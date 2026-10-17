import type { MemberMatch } from '@gms/shared';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError, errorMessage } from '../../api/client';
import { applyServerErrors } from '../../lib/forms';

export interface PhoneWarning {
  message: string;
  matches: MemberMatch[];
}

/** The C2 warning carried by a 409 DUPLICATE_PHONE_WARNING, or null for any other error. */
export function phoneWarning(error: unknown): PhoneWarning | null {
  if (!(error instanceof ApiError) || error.code !== 'DUPLICATE_PHONE_WARNING') return null;
  const matches = Array.isArray(error.extra.matches) ? (error.extra.matches as MemberMatch[]) : [];
  return { message: error.message, matches };
}

/**
 * Shared error handling for member saves: the phone warning goes to the confirm step, a taken
 * email is a hard block on the email field, field errors land on their inputs, the rest is a toast.
 */
export function handleMemberSaveError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly string[],
  onPhoneWarning: (warning: PhoneWarning) => void,
) {
  const warning = phoneWarning(error);
  if (warning) return onPhoneWarning(warning);
  if (error instanceof ApiError && error.code === 'DUPLICATE_EMAIL') {
    setError('email' as Path<T>, { type: 'server', message: error.message }, { shouldFocus: true });
    return;
  }
  if (!applyServerErrors(error, setError, fields)) toast.error(errorMessage(error));
}
