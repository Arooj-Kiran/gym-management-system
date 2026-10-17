import type {
  CreatePlanInput,
  Paginated,
  PlanDto,
  PlanListQuery,
  UpdatePlanInput,
} from '@gms/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { queryKeys } from '../../api/query-keys';

export function usePlanList(query: PlanListQuery) {
  return useQuery({
    queryKey: queryKeys.plans.list(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<PlanDto>>('/membership-plans', { query: { ...query }, signal }),
    placeholderData: keepPreviousData,
  });
}

function usePlanMutation<TInput>(request: (input: TInput) => Promise<PlanDto>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.plans.all }),
  });
}

export const useCreatePlan = () =>
  usePlanMutation((input: CreatePlanInput) => api.post<PlanDto>('/membership-plans', input));

export const useUpdatePlan = () =>
  usePlanMutation(({ id, input }: { id: string; input: UpdatePlanInput }) =>
    api.patch<PlanDto>(`/membership-plans/${id}`, input),
  );

export const useArchivePlan = () =>
  usePlanMutation(({ id, archive, reason }: { id: string; archive: boolean; reason?: string }) =>
    api.post<PlanDto>(
      `/membership-plans/${id}/${archive ? 'archive' : 'unarchive'}`,
      reason ? { reason } : {},
    ),
  );
