interface PgError {
  code?: string;
  constraint?: string;
}

function pgError(error: unknown): PgError | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as PgError & { cause?: unknown };
  if (candidate.code) return candidate;
  return candidate.cause ? pgError(candidate.cause) : undefined;
}

/** True when the error (or its cause, as wrapped by Drizzle) is a unique violation on `constraint`. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pg = pgError(error);
  return pg?.code === '23505' && pg.constraint === constraint;
}

/** True when the error is an exclusion-constraint violation (e.g. overlapping periods). */
export function isExclusionViolation(error: unknown, constraint: string): boolean {
  const pg = pgError(error);
  return pg?.code === '23P01' && pg.constraint === constraint;
}
