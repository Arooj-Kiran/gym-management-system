import { KIOSK_RESET_MS, type AccessDecision } from '@gms/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { queryKeys } from '../../api/query-keys';

/**
 * The result on screen and the 5-second reset (PLAN §6.4). The same decision can arrive twice
 * (simulate response and live stream), so results are de-duplicated by attempt.
 */
export function useKioskResult() {
  const [result, setResult] = useState<AccessDecision | null>(null);
  const seen = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((decision: AccessDecision) => {
    const key = decision.attemptId ?? `${decision.occurredAt}:${decision.reason}`;
    if (seen.current.includes(key)) return;
    seen.current = [key, ...seen.current].slice(0, 50);
    clearTimeout(timer.current);
    setResult(decision);
    timer.current = setTimeout(() => setResult(null), KIOSK_RESET_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);
  return { result, show };
}

/** Live decisions refresh every list that shows attendance or attempts. */
export function useLiveDecision(show: (decision: AccessDecision) => void) {
  const queryClient = useQueryClient();
  return useCallback(
    (decision: AccessDecision) => {
      show(decision);
      void queryClient.invalidateQueries({ queryKey: queryKeys.access.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.attendance.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
    [show, queryClient],
  );
}
