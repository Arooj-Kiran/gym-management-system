import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Billing list filters live in the URL so a filtered list can be shared or reloaded. */
export function useUrlFilters() {
  const [params, setParams] = useSearchParams();
  const update = useCallback(
    (changes: Record<string, string | null>, resetPage = true) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          if (resetPage) next.delete('page');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  const text = (key: string) => params.get(key) || undefined;
  const date = (key: string) => {
    const value = params.get(key);
    return value && ISO_DATE.test(value) ? value : undefined;
  };
  const oneOf = <T extends string>(key: string, values: readonly T[]) => {
    const value = params.get(key);
    return values.includes(value as T) ? (value as T) : undefined;
  };
  const page = Math.max(1, Number(params.get('page')) || 1);
  return { text, date, oneOf, page, update };
}
