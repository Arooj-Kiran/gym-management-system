import type {
  MyAttendanceDto,
  MyMembershipDto,
  MyMembershipOverview,
  MyProfileDto,
  Paginated,
  UpdateMyProfileInput,
} from '@gms/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { queryKeys } from '../../api/query-keys';

export function useMyProfile() {
  return useQuery({
    queryKey: queryKeys.portal.profile,
    queryFn: ({ signal }) => api.get<MyProfileDto>('/me/profile', { signal }),
  });
}

function useProfileMutation<TInput>(request: (input: TInput) => Promise<MyProfileDto>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (profile) => queryClient.setQueryData(queryKeys.portal.profile, profile),
  });
}

export const useUpdateMyProfile = () =>
  useProfileMutation((input: UpdateMyProfileInput) =>
    api.patch<MyProfileDto>('/me/profile', input),
  );

export const useUploadMyPhoto = () =>
  useProfileMutation((file: File) => {
    const form = new FormData();
    form.append('photo', file);
    return api.upload<MyProfileDto>('/me/profile/photo', form);
  });

export function useMyMembership() {
  return useQuery({
    queryKey: queryKeys.portal.membership,
    queryFn: ({ signal }) => api.get<MyMembershipOverview>('/me/membership', { signal }),
  });
}

/** Every membership period of the signed-in member, newest first. */
export function useMyMemberships() {
  return useQuery({
    queryKey: queryKeys.portal.memberships,
    queryFn: async ({ signal }) =>
      (await api.get<{ data: MyMembershipDto[] }>('/me/memberships', { signal })).data,
  });
}

/** The signed-in member's own check-ins, newest first. Denied attempts are not shown here. */
export function useMyAttendance(page: number, pageSize = 20) {
  return useQuery({
    queryKey: queryKeys.portal.attendance(page),
    queryFn: ({ signal }) =>
      api.get<Paginated<MyAttendanceDto>>('/me/attendance', {
        query: { page, pageSize },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}
