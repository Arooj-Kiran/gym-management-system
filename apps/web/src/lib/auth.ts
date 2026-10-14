import type { ChangePasswordInput, LoginInput, MeResponse, Permission } from '@gms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setCsrfToken } from '../api/client';
import { queryKeys } from '../api/query-keys';

/** Current session, or null when signed out. Other errors (server down) surface as query errors. */
async function fetchMe(): Promise<MeResponse | null> {
  try {
    const me = await api.get<MeResponse>('/auth/me', { silent401: true });
    setCsrfToken(me.csrfToken);
    return me;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      setCsrfToken(null);
      return null;
    }
    throw error;
  }
}

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: fetchMe, staleTime: 60_000, retry: false });
}

/** The signed-in session. Only call below <RequireAuth>, where it is guaranteed to exist. */
export function useSession(): MeResponse {
  const { data } = useMe();
  if (!data) throw new Error('useSession() used outside an authenticated route');
  return data;
}

export function useCan() {
  const { data } = useMe();
  const granted = new Set<Permission>(data?.permissions ?? []);
  return (permission: Permission) => granted.has(permission);
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.post('/auth/login', input),
    onSuccess: async () => {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' });
      await queryClient.fetchQuery({ queryKey: queryKeys.me, queryFn: fetchMe });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      setCsrfToken(null);
      queryClient.clear();
      queryClient.setQueryData(queryKeys.me, null);
    },
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => api.post('/auth/change-password', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.me }),
  });
}

export function fullName(user: { firstName: string; lastName: string }) {
  return `${user.firstName} ${user.lastName}`.trim();
}

export function initials(user: { firstName: string; lastName: string }) {
  return `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();
}
