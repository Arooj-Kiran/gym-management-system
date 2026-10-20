import { randomUUID } from 'node:crypto';
import { SIM_REF_PREFIX, SIM_UNENROLLED_REF } from '@gms/shared';
import type { ScanEvent, ScannerAdapter, ScannerHealth } from './scanner-adapter';

const SIM_REF = /^SIM-\d{4}$/;

/**
 * SIMULATED scanner (PLAN §6.2, §6.5). Driven by the CLI or by tests; there is no hardware and
 * no fingerprint. It only produces fake SIM- IDs, so nothing it does is biometric verification.
 */
export class SimulatedAdapter implements ScannerAdapter {
  readonly kind = 'SIMULATED' as const;
  private onEvent: ((event: ScanEvent) => void) | null = null;
  private current: ScannerHealth = { health: 'OK' };
  private readonly templates = new Set<string>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async start(onEvent: (event: ScanEvent) => void) {
    this.onEvent = onEvent;
  }

  async stop() {
    this.onEvent = null;
  }

  async health() {
    return { ...this.current };
  }

  /** Puts the fake scanner into an error state; scans then report DEVICE_ERROR. */
  setHealth(health: ScannerHealth) {
    this.current = { ...health };
  }

  /** A fake thumb with this SIM- ID touches the scanner. */
  scan(templateRef: string): ScanEvent {
    const ref = templateRef.trim().toUpperCase();
    if (!SIM_REF.test(ref)) {
      throw new Error(`The simulated scanner only knows fake IDs like ${SIM_REF_PREFIX}0001.`);
    }
    if (this.current.health === 'ERROR') return this.fail(this.current.errorCode);
    return this.emit({ matchResult: 'MATCH', templateRef: ref });
  }

  /** A finger the scanner cannot match to anyone. */
  noMatch(): ScanEvent {
    if (this.current.health === 'ERROR') return this.fail(this.current.errorCode);
    return this.emit({ matchResult: 'NO_MATCH' });
  }

  /** The scanner fails while reading. */
  fail(errorCode = 'SIMULATED_SCANNER_ERROR'): ScanEvent {
    return this.emit({ matchResult: 'DEVICE_ERROR', errorCode });
  }

  async enroll(_memberLabel: string) {
    for (let n = 1; n < 9999; n += 1) {
      const ref = `${SIM_REF_PREFIX}${String(n).padStart(4, '0')}`;
      if (ref !== SIM_UNENROLLED_REF && !this.templates.has(ref)) {
        this.templates.add(ref);
        return ref;
      }
    }
    throw new Error('No free simulated IDs are left.');
  }

  async deleteTemplate(templateRef: string) {
    this.templates.delete(templateRef);
  }

  hasTemplate(templateRef: string) {
    return this.templates.has(templateRef);
  }

  private emit(fields: Omit<ScanEvent, 'eventId' | 'occurredAt'>): ScanEvent {
    const event: ScanEvent = {
      eventId: randomUUID(),
      occurredAt: this.now().toISOString(),
      ...fields,
    };
    this.onEvent?.(event);
    return event;
  }
}
