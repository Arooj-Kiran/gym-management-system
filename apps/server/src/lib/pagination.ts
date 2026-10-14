import type { Paginated } from '@gms/shared';

export function pageOffset(page: number, pageSize: number) {
  return (page - 1) * pageSize;
}

export function paginated<T>(
  data: T[],
  page: number,
  pageSize: number,
  total: number,
): Paginated<T> {
  return { data, page, pageSize, total };
}

/** Escape LIKE wildcards so user search text is matched literally. */
export function likePattern(text: string) {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
