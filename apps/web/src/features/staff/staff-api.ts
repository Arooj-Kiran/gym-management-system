import type {
  ChangeRoleInput,
  CreateStaffInput,
  Paginated,
  ResetPasswordInput,
  StaffDto,
  StaffListQuery,
  UpdateStaffInput,
} from '@gms/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { queryKeys } from '../../api/query-keys';

export function useStaffList(query: StaffListQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.staff.list(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<StaffDto>>('/staff', { query: { ...query }, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useStaff(id: string) {
  return useQuery({
    queryKey: queryKeys.staff.detail(id),
    queryFn: ({ signal }) => api.get<StaffDto>(`/staff/${id}`, { signal }),
  });
}

/** Every staff mutation returns the updated record; refresh lists and seed the detail cache. */
function useStaffMutation<TInput>(request: (input: TInput) => Promise<StaffDto>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (staff) => {
      queryClient.setQueryData(queryKeys.staff.detail(staff.id), staff);
      return queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
    },
  });
}

export const useCreateStaff = () =>
  useStaffMutation((input: CreateStaffInput) => api.post<StaffDto>('/staff', input));

export const useUpdateStaff = (id: string) =>
  useStaffMutation((input: UpdateStaffInput) => api.patch<StaffDto>(`/staff/${id}`, input));

export const useChangeRole = (id: string) =>
  useStaffMutation((input: ChangeRoleInput) => api.patch<StaffDto>(`/staff/${id}/role`, input));

export const useSetActive = (id: string) =>
  useStaffMutation(({ active, reason }: { active: boolean; reason?: string }) =>
    api.post<StaffDto>(
      `/staff/${id}/${active ? 'activate' : 'deactivate'}`,
      reason ? { reason } : {},
    ),
  );

export const useResetPassword = (id: string) =>
  useStaffMutation((input: ResetPasswordInput) =>
    api.post<StaffDto>(`/staff/${id}/reset-password`, input),
  );
