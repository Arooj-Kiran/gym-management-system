import type {
  CreateEquipmentInput,
  EquipmentDto,
  EquipmentListQuery,
  EquipmentStatusInput,
  MaintenanceRecordDto,
  Paginated,
  RecordMaintenanceInput,
  UpdateEquipmentInput,
} from '@gms/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { queryKeys } from '../../api/query-keys';

export function useEquipmentList(query: EquipmentListQuery) {
  return useQuery({
    queryKey: queryKeys.equipment.list(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<EquipmentDto>>('/equipment', { query: { ...query }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useEquipment(id: string) {
  return useQuery({
    queryKey: queryKeys.equipment.detail(id),
    queryFn: ({ signal }) => api.get<EquipmentDto>(`/equipment/${id}`, { signal }),
  });
}

export function useMaintenanceHistory(id: string) {
  return useQuery({
    queryKey: queryKeys.equipment.maintenance(id),
    queryFn: ({ signal }) =>
      api.get<MaintenanceRecordDto[]>(`/equipment/${id}/maintenance`, { signal }),
  });
}

export function useMaintenanceDue(days: number) {
  return useQuery({
    queryKey: queryKeys.equipment.due(days),
    queryFn: ({ signal }) =>
      api.get<EquipmentDto[]>('/equipment/maintenance-due', { query: { days }, signal }),
  });
}

function useEquipmentMutation<TInput, TResult>(request: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.equipment.all }),
  });
}

export const useCreateEquipment = () =>
  useEquipmentMutation((input: CreateEquipmentInput) =>
    api.post<EquipmentDto>('/equipment', input),
  );

export const useUpdateEquipment = () =>
  useEquipmentMutation(({ id, input }: { id: string; input: UpdateEquipmentInput }) =>
    api.patch<EquipmentDto>(`/equipment/${id}`, input),
  );

export const useChangeEquipmentStatus = () =>
  useEquipmentMutation(({ id, input }: { id: string; input: EquipmentStatusInput }) =>
    api.post<EquipmentDto>(`/equipment/${id}/status`, input),
  );

export const useRecordMaintenance = () =>
  useEquipmentMutation(({ id, input }: { id: string; input: RecordMaintenanceInput }) =>
    api.post<MaintenanceRecordDto>(`/equipment/${id}/maintenance`, input),
  );
