import type {
  AccessDeviceDto,
  AccessDeviceWithKey,
  CreateDeviceInput,
  DeviceActionInput,
  UpdateDeviceInput,
} from '@gms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { queryKeys } from '../../api/query-keys';

export function useDevices() {
  return useQuery({
    queryKey: queryKeys.devices.all,
    queryFn: async ({ signal }) =>
      (await api.get<{ data: AccessDeviceDto[] }>('/devices', { signal })).data,
  });
}

/** Device changes also change the scanner pickers on the check-in desk and the simulator. */
function useDeviceMutation<TInput, TResult>(request: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.devices.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.access.devices }),
        queryClient.invalidateQueries({ queryKey: queryKeys.access.fixtures }),
      ]),
  });
}

export const useCreateDevice = () =>
  useDeviceMutation((input: CreateDeviceInput) => api.post<AccessDeviceWithKey>('/devices', input));

export const useUpdateDevice = () =>
  useDeviceMutation(({ id, ...input }: UpdateDeviceInput & { id: string }) =>
    api.patch<AccessDeviceDto>(`/devices/${id}`, input),
  );

export const useRotateDeviceKey = () =>
  useDeviceMutation(({ id, ...input }: DeviceActionInput & { id: string }) =>
    api.post<AccessDeviceWithKey>(`/devices/${id}/rotate-key`, input),
  );

export const useSetDeviceStatus = () =>
  useDeviceMutation(
    ({ id, active, ...input }: DeviceActionInput & { id: string; active: boolean }) =>
      api.post<AccessDeviceDto>(`/devices/${id}/${active ? 'enable' : 'disable'}`, input),
  );
