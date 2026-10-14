/** Only allow `next` values that are in-app paths, never another origin ("//x" or "/\x"). */
export function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')
    ? next
    : '/';
}
