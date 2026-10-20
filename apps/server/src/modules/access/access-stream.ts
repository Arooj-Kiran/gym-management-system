import type { AccessDecision } from '@gms/shared';
import type { Response } from 'express';

const KEEPALIVE_MS = 25_000;
/** Streams end after a while so the browser reconnects and the session is checked again. */
const MAX_STREAM_MS = 5 * 60_000;

/**
 * In-process Server-Sent Events hub for the kiosk screen (PLAN §6.3 step 11). Publishing never
 * throws: a broken stream must not change a decision that has already been committed.
 */
class AccessStreamHub {
  private readonly clients = new Map<string, Set<Response>>();

  open(deviceId: string, res: Response) {
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 1000\n\n');

    const set = this.clients.get(deviceId) ?? new Set<Response>();
    set.add(res);
    this.clients.set(deviceId, set);

    const keepalive = setInterval(() => res.write(': keepalive\n\n'), KEEPALIVE_MS);
    const expiry = setTimeout(() => res.end(), MAX_STREAM_MS);
    keepalive.unref();
    expiry.unref();

    res.on('close', () => {
      clearInterval(keepalive);
      clearTimeout(expiry);
      set.delete(res);
      if (set.size === 0) this.clients.delete(deviceId);
    });
  }

  publish(deviceId: string | null, decision: AccessDecision) {
    if (!deviceId) return;
    const payload = `event: decision\ndata: ${JSON.stringify(decision)}\n\n`;
    for (const res of this.clients.get(deviceId) ?? []) {
      try {
        res.write(payload);
      } catch {
        // The client went away; its close handler cleans up.
      }
    }
  }

  listenerCount(deviceId: string) {
    return this.clients.get(deviceId)?.size ?? 0;
  }

  closeAll() {
    for (const set of this.clients.values()) for (const res of set) res.end();
    this.clients.clear();
  }
}

export const accessStream = new AccessStreamHub();
