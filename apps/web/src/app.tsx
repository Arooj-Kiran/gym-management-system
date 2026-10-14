import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { ApiError, setUnauthenticatedHandler } from './api/client';
import { queryKeys } from './api/query-keys';
import { useTheme } from './lib/theme';
import { router } from './routes/router';

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
      />
    </QueryClientProvider>
  );
}
