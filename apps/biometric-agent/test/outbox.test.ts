import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { OFFLINE_DENIALS_MAX } from '@gms/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Outbox, type DenialFact, type DenialUploader } from '../src/outbox';
import { tempDir } from './helpers';

let dir: string;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
});
afterEach(() => cleanup());

const fact = (n: number): DenialFact => ({
  eventId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  occurredAt: new Date(Date.UTC(2026, 9, 19, 9, 0, n)).toISOString(),
});

function recordingUploader(fail = false) {
  const batches: DenialFact[][] = [];
  const uploader: DenialUploader = {
    async uploadOfflineDenials(denials) {
      if (fail) throw new Error('The backend is unreachable.');
      batches.push(denials);
      return { received: denials.length, stored: denials.length };
    },
  };
  return { uploader, batches };
}

describe('Outbox (denial facts only)', () => {
  it('appends one JSON line per denial with only eventId and occurredAt', async () => {
    const file = path.join(dir, 'nested', 'outbox.jsonl');
    const outbox = new Outbox(file);
    await outbox.append({ ...fact(1), ...({ templateRef: 'SIM-0001', member: 'x' } as object) });
    await outbox.append(fact(2));
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines.map((line) => JSON.parse(line))).toEqual([fact(1), fact(2)]);
    expect(lines.join('')).not.toContain('SIM-0001');
  });

  it('empties the file once the upload is accepted', async () => {
    const outbox = new Outbox(path.join(dir, 'outbox.jsonl'));
    await outbox.append(fact(1));
    await outbox.append(fact(2));
    const { uploader, batches } = recordingUploader();
    expect(await outbox.flush(uploader)).toEqual({ uploaded: 2 });
    expect(batches).toEqual([[fact(1), fact(2)]]);
    expect(await outbox.read()).toEqual([]);
  });

  it('keeps every denial when the upload fails', async () => {
    const outbox = new Outbox(path.join(dir, 'outbox.jsonl'));
    await outbox.append(fact(1));
    await expect(outbox.flush(recordingUploader(true).uploader)).rejects.toThrow('unreachable');
    expect(await outbox.read()).toEqual([fact(1)]);
  });

  it(`uploads in batches of ${OFFLINE_DENIALS_MAX}`, async () => {
    const file = path.join(dir, 'outbox.jsonl');
    const total = OFFLINE_DENIALS_MAX + 3;
    const lines = Array.from({ length: total }, (_, i) => `${JSON.stringify(fact(i))}\n`).join('');
    await appendFile(file, lines, 'utf8');
    const outbox = new Outbox(file);
    const { uploader, batches } = recordingUploader();
    expect(await outbox.flush(uploader)).toEqual({ uploaded: total });
    expect(batches.map((batch) => batch.length)).toEqual([OFFLINE_DENIALS_MAX, 3]);
    expect(await outbox.read()).toEqual([]);
  });

  it('keeps the unsent remainder when a later batch fails', async () => {
    const file = path.join(dir, 'outbox.jsonl');
    const total = OFFLINE_DENIALS_MAX + 2;
    await appendFile(file, Array.from({ length: total }, (_, i) => `${JSON.stringify(fact(i))}\n`).join(''));
    const outbox = new Outbox(file);
    let calls = 0;
    const uploader: DenialUploader = {
      async uploadOfflineDenials(denials) {
        calls += 1;
        if (calls > 1) throw new Error('The backend is unreachable.');
        return { received: denials.length, stored: denials.length };
      },
    };
    await expect(outbox.flush(uploader)).rejects.toThrow();
    expect(await outbox.read()).toEqual([fact(OFFLINE_DENIALS_MAX), fact(OFFLINE_DENIALS_MAX + 1)]);
  });

  it('skips a torn line instead of blocking the upload', async () => {
    const file = path.join(dir, 'outbox.jsonl');
    await appendFile(file, `${JSON.stringify(fact(1))}\n{"eventId":"abc","occ`, 'utf8');
    expect(await new Outbox(file).read()).toEqual([fact(1)]);
  });

  it('returns nothing when the file does not exist yet', async () => {
    expect(await new Outbox(path.join(dir, 'missing.jsonl')).read()).toEqual([]);
  });

  it('does not lose a denial appended while a flush is running', async () => {
    const outbox = new Outbox(path.join(dir, 'outbox.jsonl'));
    await outbox.append(fact(1));
    const flushing = outbox.flush(recordingUploader().uploader);
    const appending = outbox.append(fact(2));
    await Promise.all([flushing, appending]);
    expect(await outbox.read()).toEqual([fact(2)]);
  });
});
