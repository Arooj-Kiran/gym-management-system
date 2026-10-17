import { ERROR_CODES, type ErrorCode } from '@gms/shared';

export interface ErrorDetail {
  path: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetail[],
    /** Extra machine-readable fields for the client, e.g. the members a duplicate matched. */
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthenticated = () =>
  new AppError(401, ERROR_CODES.UNAUTHENTICATED, 'Please sign in to continue.');

export const forbidden = (message = 'You do not have permission to do this.') =>
  new AppError(403, ERROR_CODES.FORBIDDEN, message);

export const notFound = (what = 'Resource') =>
  new AppError(404, ERROR_CODES.NOT_FOUND, `${what} not found.`);

export const conflict = (code: ErrorCode, message: string, extra?: Record<string, unknown>) =>
  new AppError(409, code, message, undefined, extra);

export const validationFailed = (details: ErrorDetail[], message = 'Some fields are invalid.') =>
  new AppError(400, ERROR_CODES.VALIDATION_FAILED, message, details);
