import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config/env';

/**
 * Private file storage on local disk under UPLOAD_DIR. Files are never served statically:
 * every read goes through an authorized route. Swappable for object storage later.
 */
export const IMAGE_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export type ImageMime = keyof typeof IMAGE_EXTENSIONS;

const KEY_PATTERN = /^[a-z-]+\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
const MIME_BY_EXTENSION: Record<string, ImageMime> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Keys come from the database, but are re-checked so a bad row can never escape UPLOAD_DIR. */
function resolveKey(key: string): string {
  if (!KEY_PATTERN.test(key)) throw new Error('Invalid storage key');
  return path.join(config.uploadDir, ...key.split('/'));
}

export function newImageKey(folder: string, mime: ImageMime): string {
  return `${folder}/${randomUUID()}.${IMAGE_EXTENSIONS[mime]}`;
}

export async function saveFile(key: string, data: Buffer): Promise<void> {
  const target = resolveKey(key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data, { flag: 'wx' });
}

/** The file and its content type, or null when it is missing on disk. */
export async function readImage(key: string): Promise<{ data: Buffer; mime: ImageMime } | null> {
  try {
    const data = await readFile(resolveKey(key));
    return { data, mime: MIME_BY_EXTENSION[key.split('.').pop()!]! };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Best effort: a leftover file is harmless, a failed request because of cleanup is not. */
export async function deleteFile(key: string): Promise<void> {
  await rm(resolveKey(key), { force: true }).catch(() => undefined);
}
