import {
  accessDecisionSchema,
  kioskMessage,
  type AccessDecision,
  type DeviceHealth,
  type DeviceHeartbeatResponse,
} from '@gms/shared';
import { z } from 'zod';
import type { ScanEvent } from './adapters/scanner-adapter';

/**
 * The agent's only link to the backend (PLAN §6.2). Outbound HTTPS, device-key auth, and fail
 * closed: a scan is GRANTED only on HTTP 200 with a schema-valid body whose decision is GRANTED
 * and which names the committed attempt. Anything else (timeout, refused connection, 5xx,
 * malformed JSON, missing fields) is DENIED.
 */

export type ScanFailure = 'TIMEOUT' | 'NETWORK' | 'SERVER_ERROR' | 'MALFORMED_RESPONSE';

export interface ScanOutcome {
  granted: boolean;
  title: string;
  message: string;
  /** The server's decision when one was received and valid. */
  decision: AccessDecision | null;
  /** Why no usable decision was received; null when the server decided. */
  failure: ScanFailure | null;
  /**
   * The backend may not have recorded this denial, so the agent keeps the fact in its outbox.
   * Re-uploads are harmless: the server ignores an eventId it already has.
   */
  recordOffline: boolean;
}

export class BackendError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

const heartbeatResponseSchema = z.object({
  serverTime: z.string(),
  pendingDeletions: z.array(z.object({ enrollmentId: z.uuid(), templateRef: z.string().min(1) })),
});

const offlineUploadSchema = z.object({ received: z.number(), stored: z.number() });

export interface BackendClientOptions {
  backendUrl: string;
  deviceId: string;
  deviceKey: string;
  requestTimeoutMs: number;
  fetch?: typeof fetch;
}

const UNVERIFIED = kioskMessage('AUTHORIZATION_UNAVAILABLE');

function unverified(failure: ScanFailure): ScanOutcome {
  return { granted: false, ...UNVERIFIED, decision: null, failure, recordOffline: true };
}

export class BackendClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: BackendClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  /** The decision for one scanner event. Never throws. */
  async scan(event: ScanEvent): Promise<ScanOutcome> {
    let response: Response;
    let text: string;
    try {
      ({ response, text } = await this.send('/access/scan', event));
    } catch (error) {
      return unverified(isTimeout(error) ? 'TIMEOUT' : 'NETWORK');
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return unverified(response.status >= 500 ? 'SERVER_ERROR' : 'MALFORMED_RESPONSE');
    }
    const parsed = accessDecisionSchema.safeParse(body);
    if (!parsed.success) {
      return unverified(response.status >= 500 ? 'SERVER_ERROR' : 'MALFORMED_RESPONSE');
    }

    const decision = parsed.data;
    const granted =
      response.status === 200 && decision.decision === 'GRANTED' && decision.attemptId !== null;
    if (granted) {
      return {
        granted: true,
        title: decision.title,
        message: decision.message,
        decision,
        failure: null,
        recordOffline: false,
      };
    }
    // A valid denial (401 device not authorized, 503 authorization unavailable, or 200 denied).
    // A 200 claiming GRANTED without an attempt ID is not trusted.
    const trusted = decision.decision === 'DENIED';
    const shown = trusted ? decision : { ...decision, ...UNVERIFIED };
    return {
      granted: false,
      title: shown.title,
      message: shown.message,
      decision: trusted ? decision : null,
      failure: trusted ? (response.status >= 500 ? 'SERVER_ERROR' : null) : 'MALFORMED_RESPONSE',
      recordOffline: !trusted || response.status >= 500,
    };
  }

  async heartbeat(health: DeviceHealth, errorCode?: string): Promise<DeviceHeartbeatResponse> {
    const body = await this.call('/devices/heartbeat', { health, ...(errorCode ? { errorCode } : {}) });
    return parseOrThrow(heartbeatResponseSchema, body);
  }

  async uploadOfflineDenials(denials: { eventId: string; occurredAt: string }[]) {
    return parseOrThrow(offlineUploadSchema, await this.call('/access/offline-denials', { denials }));
  }

  async confirmDeletion(enrollmentId: string) {
    await this.call(`/biometric/enrollments/${encodeURIComponent(enrollmentId)}/confirm-deletion`, {});
  }

  /** For non-decision calls: any non-2xx is an error. */
  private async call(path: string, payload: unknown): Promise<unknown> {
    let response: Response;
    let text: string;
    try {
      ({ response, text } = await this.send(path, payload));
    } catch (error) {
      throw new BackendError(
        isTimeout(error) ? 'The backend did not answer in time.' : 'The backend is unreachable.',
        null,
      );
    }
    if (!response.ok) {
      throw new BackendError(`The backend refused the request (HTTP ${response.status}).`, response.status);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new BackendError('The backend sent an unreadable response.', response.status);
    }
  }

  private async send(path: string, payload: unknown) {
    const response = await this.fetchImpl(`${this.options.backendUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Device ${this.options.deviceId}.${this.options.deviceKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.options.requestTimeoutMs),
    });
    // The body is read under the same timeout signal.
    const text = await response.text();
    return { response, text };
  }
}

function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function parseOrThrow<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BackendError('The backend sent an unexpected response.', 200);
  return parsed.data;
}
