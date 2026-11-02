import type {
  CheckDuplicateQuery,
  CreateMemberInput,
  CreatePortalAccountInput,
  DuplicateCheckResult,
  MemberDto,
  MemberListQuery,
  MemberSummaryDto,
  Paginated,
  UpdateMemberInput,
} from '@gms/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { queryKeys } from '../../api/query-keys';

export function useMemberList(query: MemberListQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.members.list(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<MemberSummaryDto>>('/members', { query: { ...query }, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useMember(id: string) {
  return useQuery({
    queryKey: queryKeys.members.detail(id),
    queryFn: ({ signal }) => api.get<MemberDto>(`/members/${id}`, { signal }),
  });
}

/** Every member mutation returns the updated record; seed the detail cache and refresh lists. */
function useMemberMutation<TInput>(request: (input: TInput) => Promise<MemberDto>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (member) => {
      queryClient.setQueryData(queryKeys.members.detail(member.id), member);
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      return queryClient.invalidateQueries({
        queryKey: queryKeys.members.all,
        predicate: (query) => query.queryKey[1] !== 'detail',
      });
    },
  });
}

export const useCreateMember = () =>
  useMemberMutation((input: CreateMemberInput) => api.post<MemberDto>('/members', input));

export const useUpdateMember = (id: string) =>
  useMemberMutation((input: UpdateMemberInput) => api.patch<MemberDto>(`/members/${id}`, input));

export const useArchiveMember = (id: string) =>
  useMemberMutation(({ archive, reason }: { archive: boolean; reason?: string }) =>
    api.post<MemberDto>(
      `/members/${id}/${archive ? 'archive' : 'restore'}`,
      reason ? { reason } : {},
    ),
  );

export const useAccessBlock = (id: string) =>
  useMemberMutation(({ block, reason }: { block: boolean; reason?: string }) =>
    api.post<MemberDto>(
      `/members/${id}/${block ? 'access-block' : 'access-unblock'}`,
      reason ? { reason } : {},
    ),
  );

export const useUploadMemberPhoto = (id: string) =>
  useMemberMutation((file: File) => {
    const form = new FormData();
    form.append('photo', file);
    return api.upload<MemberDto>(`/members/${id}/photo`, form);
  });

export const useCreatePortalAccount = (id: string) =>
  useMemberMutation((input: CreatePortalAccountInput) =>
    api.post<MemberDto>(`/members/${id}/portal-account`, input),
  );

function useDebounced<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Advisory pre-check while a member form is being filled in (PLAN §3.2, C2). The server repeats
 * the check on save, so this only has to be helpful, never authoritative.
 */
export function useDuplicateCheck(input: CheckDuplicateQuery, enabled: boolean) {
  const query = useDebounced(
    {
      email: input.email?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
      firstName: input.firstName?.trim() || undefined,
      lastName: input.lastName?.trim() || undefined,
      excludeId: input.excludeId,
    },
    400,
  );
  const hasValue = Boolean(query.email || (query.phone && query.phone.length >= 7));
  return useQuery({
    queryKey: queryKeys.members.duplicates(query),
    queryFn: ({ signal }) =>
      api.get<DuplicateCheckResult>('/members/check-duplicate', { query: { ...query }, signal }),
    enabled: enabled && hasValue,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });
}
