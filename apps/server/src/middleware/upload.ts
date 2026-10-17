import { ERROR_CODES } from '@gms/shared';
import type { RequestHandler } from 'express';
import { fileTypeFromBuffer } from 'file-type';
import multer from 'multer';
import { config } from '../config/env';
import { IMAGE_EXTENSIONS, type ImageMime } from '../integrations/storage/local-storage';
import { AppError, validationFailed } from '../lib/errors';

export interface UploadedImage {
  data: Buffer;
  mime: ImageMime;
}

const maxMb = () => Math.round((config.maxUploadBytes / 1024 / 1024) * 10) / 10;

/**
 * Accepts one image in multipart field `field`. The type is decided by the file's magic bytes,
 * never by its name or the browser-supplied content type. Sets `res.locals.image`.
 */
export function singleImage(field: string): RequestHandler[] {
  const parse = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 0, parts: 1 },
  }).single(field);

  const parseWithErrors: RequestHandler = (req, res, next) => {
    parse(req, res, (error: unknown) => {
      if (!error) return next();
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return next(
            new AppError(
              413,
              ERROR_CODES.PAYLOAD_TOO_LARGE,
              `The photo is too large. The limit is ${maxMb()} MB.`,
            ),
          );
        }
        return next(validationFailed([{ path: field, message: 'Upload a single photo file' }]));
      }
      next(error);
    });
  };

  const checkType: RequestHandler = async (req, res, next) => {
    if (!req.file) {
      throw validationFailed([{ path: field, message: 'Choose a photo to upload' }]);
    }
    const detected = await fileTypeFromBuffer(req.file.buffer);
    if (!detected || !(detected.mime in IMAGE_EXTENSIONS)) {
      throw validationFailed([{ path: field, message: 'Use a JPEG, PNG or WebP image' }]);
    }
    res.locals.image = { data: req.file.buffer, mime: detected.mime as ImageMime };
    next();
  };

  return [parseWithErrors, checkType];
}
