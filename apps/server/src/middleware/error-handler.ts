import { ERROR_CODES } from '@gms/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { AppError, notFound } from '../lib/errors';

export const notFoundHandler: RequestHandler = () => {
  throw notFound('Route');
};

function isBodyParserError(error: unknown): error is { type: string; status: number } {
  return typeof error === 'object' && error !== null && 'type' in error && 'status' in error;
}

/** Central error handler. Responses never contain stack traces, SQL or internal details. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error, req, res, _next) => {
    if (error instanceof AppError) {
      res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
          ...error.extra,
        },
      });
      return;
    }

    if (isBodyParserError(error)) {
      if (error.type === 'entity.parse.failed') {
        res.status(400).json({
          error: {
            code: ERROR_CODES.INVALID_JSON,
            message: 'The request body is not valid JSON.',
          },
        });
        return;
      }
      if (error.type === 'entity.too.large') {
        res.status(413).json({
          error: {
            code: ERROR_CODES.PAYLOAD_TOO_LARGE,
            message: 'The request body is too large.',
          },
        });
        return;
      }
    }

    logger.error({ err: error, requestId: req.id }, 'Unhandled error');
    res.status(500).json({
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: `Something went wrong on our side. Reference: ${req.id}`,
      },
    });
  };
}
