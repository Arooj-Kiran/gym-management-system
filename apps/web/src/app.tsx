import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type CSSProperties } from 'react';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { ApiError, setUnauthenticatedHandler } from './api/client';
import { queryKeys } from './api/query-keys';
import { useTheme } from './lib/theme';
import { router } from './routes/router';

/**
 * Sonner's own rich colours miss WCAG AA (green on mint is about 4.3:1), so toasts use the
 * design tokens instead; they follow light and dark mode with the rest of the app.
 */
const TOAST_COLORS = {
  '--normal-bg': 'var(--surface)',
  '--normal-border': 'var(--border)',
  '--normal-text': 'var(--text)',
  '--success-bg': 'var(--success-subtle)',
  '--success-border': 'color-mix(in srgb, var(--success-text) 25%, transparent)',
  '--success-text': 'var(--success-text)',
  '--error-bg': 'var(--danger-subtle)',
  '--error-border': 'color-mix(in srgb, var(--danger-text) 25%, transparent)',
  '--error-text': 'var(--danger-text)',
  '--warning-bg': 'var(--warning-subtle)',
  '--warning-border': 'color-mix(in srgb, var(--warning-text) 25%, transparent)',
  '--warning-text': 'var(--warning-text)',
  '--info-bg': 'var(--info-subtle)',
  '--info-border': 'color-mix(in srgb, var(--info-text) 25%, transparent)',
  '--info-text': 'var(--info-text)',
} as CSSProperties;

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Never retry auth/permission/validation errors; retry a flaky network once.
        retry: (count, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
      },
    },
  });
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  const { theme } = useTheme();

  useEffect(() => {
    // An expired or revoked session anywhere sends the user back to sign-in.
    setUnauthenticatedHandler(() => queryClient.setQueryData(queryKeys.me, null));
    return () => setUnauthenticatedHandler(null);
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster
        theme={theme}
        position="top-right"
        closeButton
        richColors
        toastOptions={{ duration: 5000 }}
        style={TOAST_COLORS}
      />
    </QueryClientProvider>
  );
}
