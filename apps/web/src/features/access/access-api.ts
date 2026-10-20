import {
  accessDecisionSchema,
  kioskMessage,
  type AccessAttemptDto,
  type AccessAttemptListQuery,
  type AccessDecision,
  type AccessDeviceBrief,
  type AccessSource,
  type Paginated,
  type SimulateScanInput,
  type SimulatorFixturesDto,
} from '@gms/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, buildUrl } from '../../api/client';
import { queryKeys } from '../../api/query-keys';

/** Active devices, for the check-in desk, kiosk, access-log filter and enrollment. */
export function useAccessDevices(enabled = true) {
  return useQuery({
    queryKey: queryKeys.access.devices,
    queryFn: async ({ signal }) =>
      (await api.get<{ data: AccessDeviceBrief[] }>('/access/devices', { signal })).data,
    enabled,
  });
}

export function useAccessAttempts(query: AccessAttemptListQuery) {
  return useQuery({
    queryKey: queryKeys.access.attempts(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<AccessAttemptDto>>('/access/attempts', { query: { ...query }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useMemberAccessAttempts(memberId: string, query: AccessAttemptListQuery) {
  return useQuery({
    queryKey: queryKeys.access.memberAttempts(memberId, query),
    queryFn: ({ signal }) =>
      api.get<Paginated<AccessAttemptDto>>(`/members/${memberId}/access-attempts`, {
        query: { ...query },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

/**
 * Fake SIM- fingerprints for the simulated scanner panel. `null` when the simulator is switched
 * off on the server (the routes answer 404), so the panel is not rendered at all.
 */
export function useSimulatorFixtures(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.access.fixtures,
    queryFn: async ({ signal }) => {
      try {
        return await api.get<SimulatorFixturesDto>('/access/simulator/fixtures', { signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    enabled,
    retry: false,
  });
}

/**
 * What the entrance shows when the server could not be asked or did not answer properly:
 * always a denial (PLAN §2, fail closed).
 */
export function unverifiedDecision(
  deviceId: string | null,
  source: AccessSource = 'SIMULATED',
): AccessDecision {
  return {
    decision: 'DENIED',
    reason: 'AUTHORIZATION_UNAVAILABLE',
    ...kioskMessage('AUTHORIZATION_UNAVAILABLE'),
    source,
    attemptId: null,
    duplicate: false,
    occurredAt: new Date().toISOString(),
    deviceId,
  };
}

/**
 * Only a schema-valid body whose result and reason agree counts; anything else is treated as
 * "could not be verified", so a garbled answer can never be shown as a grant.
 */
export function parseDecision(
  payload: unknown,
  deviceId: string | null,
  source?: AccessSource,
): AccessDecision {
  const parsed = accessDecisionSchema.safeParse(payload);
  if (!parsed.success) return unverifiedDecision(deviceId, source);
  const { decision, reason } = parsed.data;
  const consistent = (decision === 'GRANTED') === (reason === 'GRANTED');
  return consistent ? parsed.data : unverifiedDecision(deviceId, source ?? parsed.data.source);
}

/** A simulated scan. Never throws: network errors, 5xx and malformed bodies become a denial. */
export function useSimulateScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SimulateScanInput): Promise<AccessDecision> => {
      try {
        return parseDecision(await api.post<unknown>('/access/simulate', input), input.deviceId);
      } catch {
        return unverifiedDecision(input.deviceId);
      }
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.access.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.attendance.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
      ]),
  });
}

export type StreamStatus = 'connecting' | 'live' | 'reconnecting';

const RECONNECT_MS = 5_000;

/**
 * Live decisions for one device over Server-Sent Events. Every event is validated; a malformed
 * one is shown as "could not be verified", never as a grant. Nothing is cached between events.
 */
export function useAccessStream(
  deviceId: string | null,
  onDecision: (decision: AccessDecision) => void,
  source?: AccessSource,
) {
  // Keyed by device so switching scanners starts again from "connecting".
  const [state, setState] = useState<{ deviceId: string | null; status: StreamStatus }>({
    deviceId,
    status: 'connecting',
  });
  const handler = useRef(onDecision);
  useEffect(() => {
    handler.current = onDecision;
  }, [onDecision]);

  useEffect(() => {
    if (!deviceId || typeof EventSource === 'undefined') return;
    let stream: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      stream = new EventSource(buildUrl('/access/stream', { deviceId }), {
        withCredentials: true,
      });
      stream.onopen = () => setState({ deviceId, status: 'live' });
      stream.addEventListener('decision', (event) => {
        let payload: unknown = null;
        try {
          payload = JSON.parse((event as MessageEvent<string>).data);
        } catch {
          // Falls through to the "could not be verified" screen.
        }
        handler.current(parseDecision(payload, deviceId, source));
      });
      stream.onerror = () => {
        setState({ deviceId, status: 'reconnecting' });
        // The browser retries by itself unless the server refused the stream (e.g. 401/403).
        if (stream?.readyState === EventSource.CLOSED && !stopped) {
          stream.close();
          retry = setTimeout(connect, RECONNECT_MS);
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      stream?.close();
    };
  }, [deviceId, source]);

  return state.deviceId === deviceId ? state.status : 'connecting';
}
