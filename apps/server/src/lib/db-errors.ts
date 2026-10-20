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

/** The Postgres SQLSTATE of the error (or its cause), if any. */
export function pgErrorCode(error: unknown): string | undefined {
  return pgError(error)?.code;
}

/**
 * A failed query as it may be logged: Drizzle puts the bound parameters into the error (and its
 * message), and those can hold sensitive values such as a device user ID. Keep only the SQL text
 * with its placeholders and the Postgres code.
 */
export function loggableError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('params' in error && 'query' in error)) {
    return error;
  }
  const pg = pgError(error) as (PgError & { message?: string }) | undefined;
  return {
    type: 'DatabaseQueryError',
    query: String((error as { query: unknown }).query),
    code: pg?.code,
    constraint: pg?.constraint,
    message: pg?.message ?? 'Query failed',
    stack: (error as { stack?: string }).stack?.split('\n').slice(1).join('\n'),
  };
}
