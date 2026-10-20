import { mkdir, readFile, rename, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { OFFLINE_DENIALS_MAX } from '@gms/shared';

/**
 * Denial-only offline log (PLAN §6.2). Each line is `{ eventId, occurredAt }`: the fact that a
 * scan was refused while the backend could not be reached. No decision data, member data or
 * template IDs are ever written here.
 */

export interface DenialFact {
  eventId: string;
  occurredAt: string;
}

export interface DenialUploader {
  uploadOfflineDenials(denials: DenialFact[]): Promise<{ received: number; stored: number }>;
}

export class Outbox {
  /** Serializes file access so an append never races a flush. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  append(fact: DenialFact) {
    return this.serial(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const line = JSON.stringify({ eventId: fact.eventId, occurredAt: fact.occurredAt });
      await appendFile(this.filePath, `${line}\n`, 'utf8');
    });
  }

  read(): Promise<DenialFact[]> {
    return this.serial(() => this.readUnlocked());
  }

  /**
   * Uploads pending denials in batches. A batch leaves the file only after the backend accepted
   * it, so a failure keeps everything for the next try.
   */
  flush(uploader: DenialUploader) {
    return this.serial(async () => {
      let pending = await this.readUnlocked();
      let uploaded = 0;
      while (pending.length > 0) {
        const batch = pending.slice(0, OFFLINE_DENIALS_MAX);
        await uploader.uploadOfflineDenials(batch);
        pending = pending.slice(batch.length);
        uploaded += batch.length;
        await this.writeUnlocked(pending);
      }
      return { uploaded };
    });
  }

  private async readUnlocked(): Promise<DenialFact[]> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const facts: DenialFact[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line) as Partial<DenialFact>;
        if (typeof value.eventId === 'string' && typeof value.occurredAt === 'string') {
          facts.push({ eventId: value.eventId, occurredAt: value.occurredAt });
        }
      } catch {
        // A torn last line (power cut mid-write) is skipped rather than blocking the upload.
      }
    }
    return facts;
  }

  private async writeUnlocked(facts: DenialFact[]) {
    const temp = `${this.filePath}.tmp`;
    await writeFile(temp, facts.map((fact) => `${JSON.stringify(fact)}\n`).join(''), 'utf8');
    await rename(temp, this.filePath);
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
