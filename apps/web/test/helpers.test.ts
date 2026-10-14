import { PASSWORD_MIN_LENGTH } from '@gms/shared';
import { describe, expect, it } from 'vitest';
import { formatDate, formatPhone } from '../src/lib/format';
import { safeNext } from '../src/lib/navigation';
import { generateTemporaryPassword } from '../src/lib/password';

describe('safeNext', () => {
  it.each([
    ['/staff?status=active', '/staff?status=active'],
    [null, '/'],
    ['', '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
  ])('%s → %s', (input, expected) => expect(safeNext(input)).toBe(expected));
});

describe('generateTemporaryPassword', () => {
  it('meets the password policy and avoids look-alike characters', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      const password = generateTemporaryPassword();
      expect(password).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
      expect(password).not.toMatch(/[01OlI]/);
      expect(password.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
      seen.add(password);
    }
    expect(seen.size).toBe(50);
  });
});

describe('format helpers', () => {
  it('shows calendar dates without a timezone shift', () =>
    expect(formatDate('2026-03-01')).toBe('01 Mar 2026'));
  it('groups Pakistani mobile numbers', () =>
    expect(formatPhone('+923001234567')).toBe('+92 300 1234567'));
  it('leaves other numbers as stored', () =>
    expect(formatPhone('+447700900123')).toBe('+447700900123'));
});
