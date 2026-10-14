import { describe, expect, it } from 'vitest';
import { diffFields, stripSecrets } from '../../src/lib/audit';
import { likePattern } from '../../src/lib/pagination';

describe('stripSecrets', () => {
  it('removes secret-looking keys at any depth', () => {
    const cleaned = stripSecrets({
      email: 'a@example.test',
      password: 'x',
      temporaryPassword: 'x',
      nested: { passwordHash: 'x', tokenHash: 'x', csrfToken: 'x', apiSecret: 'x', keep: 1 },
      list: [{ newPassword: 'x', role: 'ADMIN' }],
    });
    expect(cleaned).toEqual({
      email: 'a@example.test',
      nested: { keep: 1 },
      list: [{ role: 'ADMIN' }],
    });
  });

  it('serialises dates', () => {
    expect(stripSecrets({ at: new Date('2026-01-02T03:04:05.000Z') })).toEqual({
      at: '2026-01-02T03:04:05.000Z',
    });
  });
});

describe('diffFields', () => {
  it('keeps only changed fields', () => {
    const diff = diffFields({ a: 1, b: 'x', c: null as string | null }, { a: 1, b: 'y', c: 'z' });
    expect(diff).toEqual({ before: { b: 'x', c: null }, after: { b: 'y', c: 'z' }, changed: true });
  });

  it('ignores undefined and unchanged values', () => {
    expect(diffFields({ a: 1, b: 2 }, { a: 1, b: undefined }).changed).toBe(false);
  });
});

describe('likePattern', () => {
  it('escapes LIKE wildcards', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
});
