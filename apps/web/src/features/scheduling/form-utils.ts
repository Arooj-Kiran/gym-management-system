import { ApiError, errorMessage } from '../../api/client';

export type Errors = Partial<Record<string, string>>;

/**
 * Splits a failed save into field errors (400 details, shown on the inputs) or one message for
 * the form (409 conflicts such as "the trainer is already booked then"), so the dialog stays
 * open with the reason next to what needs changing.
 */
export function splitServerError(error: unknown): { fields: Errors; problem: string | null } {
  if (error instanceof ApiError && error.details.length > 0) {
    return {
      fields: Object.fromEntries(error.details.map((detail) => [detail.path, detail.message])),
      problem: null,
    };
  }
  return { fields: {}, problem: errorMessage(error) };
}

/** Whole minutes from a text input, or null. */
export function parseWhole(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}
