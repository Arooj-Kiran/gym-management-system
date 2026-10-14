import type { z } from 'zod';
import { validationFailed } from '../lib/errors';

/** Parse untrusted input with a shared Zod schema; failures become a 400 with field details. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  throw validationFailed(
    result.error.issues.map((issue) => ({
      path:
        issue.path.join('.') || (issue.code === 'unrecognized_keys' ? issue.keys.join(', ') : ''),
      message: issue.message,
    })),
  );
}
