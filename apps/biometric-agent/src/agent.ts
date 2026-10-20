import type { ScanEvent, ScannerAdapter } from './adapters/scanner-adapter';
import type { BackendClient, ScanOutcome } from './backend-client';
import type { Outbox } from './outbox';

/** Opens the door or turnstile. Called only after the backend returned GRANTED. */
export interface Relay {
  open(): Promise<void>;
}

/** Where the agent shows the result (console for the CLI, a display for real hardware). */
export interface AgentDisplay {
  showResult(outcome: ScanOutcome, event: ScanEvent): void;
  info(message: string): void;
  warn(message: string): void;
}

/** SIMULATED: there is no door. Counts openings so tests and the CLI can show them. */
export class SimulatedRelay implements Relay {
  openings = 0;
  async open() {
    this.openings += 1;
  }
}

export interface AgentOptions {
  adapter: ScannerAdapter;
  client: BackendClient;
  outbox: Outbox;
  relay: Relay;
  display: AgentDisplay;
  heartbeatSeconds: number;
}

/**
 * Wires a scanner to the backend (PLAN §6.2). The agent never decides: each event goes to the
 * backend, the relay opens only on a verified GRANTED, and an unreachable backend means DENIED.
 */
export class Agent {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = new Set<Promise<unknown>>();

  constructor(private readonly options: AgentOptions) {}

  async start() {
    await this.options.adapter.start((event) => {
      this.track(this.handleEvent(event));
    });
    await this.heartbeat();
    this.timer = setInterval(() => {
      this.track(this.heartbeat());
    }, this.options.heartbeatSeconds * 1000);
    this.timer.unref?.();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.options.adapter.stop();
    await this.drain();
  }

  /** Decides one event through the backend. Exposed for the CLI and tests. */
  async handleEvent(event: ScanEvent): Promise<ScanOutcome> {
    const { client, outbox, relay, display } = this.options;
    const outcome = await client.scan(event);
    if (outcome.recordOffline) {
      try {
        await outbox.append({ eventId: event.eventId, occurredAt: event.occurredAt });
      } catch {
        display.warn('Could not write the offline denial log.');
      }
    }
    if (outcome.granted) {
      try {
        await relay.open();
      } catch {
        display.warn('The relay did not open. Please let the member in by hand.');
      }
    }
    display.showResult(outcome, event);
    return outcome;
  }

  /**
   * Reports scanner health, uploads the outbox, and deletes revoked templates from the scanner,
   * confirming each deletion so the backend can erase the ID (PLAN §6.6).
   */
  async heartbeat() {
    const { adapter, client, outbox, display } = this.options;
    const health = await adapter.health();
    let pending: { enrollmentId: string; templateRef: string }[];
    try {
      ({ pendingDeletions: pending } = await client.heartbeat(health.health, health.errorCode));
    } catch (error) {
      display.warn(`Heartbeat failed: ${(error as Error).message}`);
      return { ok: false, uploaded: 0, deleted: 0 };
    }

    let uploaded = 0;
    try {
      ({ uploaded } = await outbox.flush(client));
      if (uploaded > 0) display.info(`Uploaded ${uploaded} offline denial(s).`);
    } catch (error) {
      display.warn(`Offline denials not uploaded yet: ${(error as Error).message}`);
    }

    let deleted = 0;
    for (const item of pending) {
      try {
        await adapter.deleteTemplate(item.templateRef);
        await client.confirmDeletion(item.enrollmentId);
        deleted += 1;
      } catch (error) {
        display.warn(`Template deletion not confirmed yet: ${(error as Error).message}`);
      }
    }
    if (deleted > 0) display.info(`Deleted ${deleted} revoked template(s) from the scanner.`);
    return { ok: true, uploaded, deleted };
  }

  /** Waits for every event and heartbeat already in progress. */
  async drain() {
    await Promise.allSettled([...this.inFlight]);
  }

  private track(task: Promise<unknown>) {
    const guarded = task.catch((error: unknown) => {
      this.options.display.warn(`Agent error: ${(error as Error).message}`);
    });
    this.inFlight.add(guarded);
    void guarded.finally(() => this.inFlight.delete(guarded));
  }
}
