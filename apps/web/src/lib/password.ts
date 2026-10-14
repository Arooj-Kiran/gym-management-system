// No 0/O, 1/l/I: the password is read out or written down when handed over.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A random temporary password like "kq7R-mPx4-Tz9w-HcN3" (about 91 bits of entropy). */
export function generateTemporaryPassword(groups = 4, groupLength = 4) {
  const total = groups * groupLength;
  const chars: string[] = [];
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % ALPHABET.length);
  while (chars.length < total) {
    for (const byte of crypto.getRandomValues(new Uint8Array(total * 2))) {
      if (byte < limit && chars.length < total) chars.push(ALPHABET[byte % ALPHABET.length]!);
    }
  }
  return Array.from({ length: groups }, (_, index) =>
    chars.slice(index * groupLength, (index + 1) * groupLength).join(''),
  ).join('-');
}
