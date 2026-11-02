import type {
  ActivateMembershipInput,
  AssignMembershipInput,
  CancelMembershipInput,
  ExtendMembershipInput,
  MembershipDto,
  MembershipEventDto,
  MembershipListQuery,
  Paginated,
  ReactivateMembershipInput,
  RenewMembershipInput,
  SuspendMembershipInput,
} from '@gms/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { queryKeys } from '../../api/query-keys';

export function useMembershipList(query: MembershipListQuery) {
  return useQuery({
    queryKey: queryKeys.memberships.list(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<MembershipDto>>('/memberships', { query: { ...query }, signal }),
    placeholderData: keepPreviousData,
  });
}

/** Every membership of one member, newest period first. */
export function useMemberMemberships(memberId: string) {
  return useQuery({
    queryKey: queryKeys.members.memberships(memberId),
    queryFn: async ({ signal }) =>
      (await api.get<{ data: MembershipDto[] }>(`/members/${memberId}/memberships`, { signal }))
        .data,
  });
}

/** The member's membership timeline across all periods, newest first. */
export function useMemberMembershipEvents(memberId: string) {
  return useQuery({
    queryKey: queryKeys.members.membershipEvents(memberId),
    queryFn: async ({ signal }) =>
      (
        await api.get<{ data: MembershipEventDto[] }>(`/members/${memberId}/membership-events`, {
          signal,
        })
      ).data,
  });
}

/**
 * A membership change touches the member's current status everywhere: their membership tab and
 * timeline, both lists and the dashboard counts. Assigning and renewing raise an invoice, and
 * a cancellation can void one, so the billing lists are refreshed too.
 */
function useMembershipMutation<TInput>(request: (input: TInput) => Promise<MembershipDto>) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.memberships.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.members.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.billing.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
    ]);
  return useMutation({
    mutationFn: request,
    onSuccess: refresh,
    // A conflict (someone else changed it, or the status moved on) means the screen is stale.
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) void refresh();
    },
  });
}

export const useAssignMembership = () =>
  useMembershipMutation((input: AssignMembershipInput) =>
    api.post<MembershipDto>('/memberships', input),
  );

type WithId<T> = T & { id: string };

const action =
  <TInput extends object>(name: string) =>
  ({ id, ...input }: WithId<TInput>) =>
    api.post<MembershipDto>(`/memberships/${id}/${name}`, input);

export const useActivateMembership = () =>
  useMembershipMutation(action<ActivateMembershipInput>('activate'));
export const useRenewMembership = () =>
  useMembershipMutation(action<RenewMembershipInput>('renew'));
export const useExtendMembership = () =>
  useMembershipMutation(action<ExtendMembershipInput>('extend'));
export const useSuspendMembership = () =>
  useMembershipMutation(action<SuspendMembershipInput>('suspend'));
export const useReactivateMembership = () =>
  useMembershipMutation(action<ReactivateMembershipInput>('reactivate'));
export const useCancelMembership = () =>
  useMembershipMutation(action<CancelMembershipInput>('cancel'));
