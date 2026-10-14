import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '../api/client';

/**
 * Put server-side field errors (400 details) on the matching inputs.
 * Returns true when at least one field error was applied, so callers can skip a generic toast.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly string[],
): boolean {
  if (!(error instanceof ApiError) || error.details.length === 0) return false;
  let applied = false;
  for (const detail of error.details) {
    if (fields.includes(detail.path)) {
      setError(
        detail.path as Path<T>,
        { type: 'server', message: detail.message },
        { shouldFocus: !applied },
      );
      applied = true;
    }
  }
  return applied;
}
