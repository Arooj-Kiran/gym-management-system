import argon2 from 'argon2';

/** OWASP-recommended argon2id parameters (19 MiB, 2 iterations, 1 lane). */
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, HASH_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Verify against a throwaway hash so unknown emails take as long as wrong passwords. */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('timing-equalizer-not-a-real-password');
  await verifyPassword(await dummyHash, password);
}
