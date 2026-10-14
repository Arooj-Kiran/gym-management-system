import type { GymSettingsDto, UpdateSettingsInput } from '@gms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { queryKeys } from '../../api/query-keys';

export function useSettings(enabled = true) {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => api.get<GymSettingsDto>('/settings', { signal }),
    enabled,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingsInput) => api.patch<GymSettingsDto>('/settings', input),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.settings, settings);
      // The gym name is shown in the shell and comes from /auth/me.
      return queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}
