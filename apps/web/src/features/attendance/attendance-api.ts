import type {
  AccessDecision,
  AttendanceCorrectionDto,
  AttendanceCorrectionInput,
  AttendanceDto,
  AttendanceListQuery,
  ManualCheckInInput,
  Paginated,
} from '@gms/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { queryKeys } from '../../api/query-keys';
import { parseDecision } from '../access/access-api';

export function useAttendanceList(query: AttendanceListQuery) {
  return useQuery({
    queryKey: queryKeys.attendance.list(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<AttendanceDto>>('/attendance', { query: { ...query }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useMemberAttendance(memberId: string, query: AttendanceListQuery) {
  return useQuery({
    queryKey: queryKeys.attendance.member(memberId, query),
    queryFn: ({ signal }) =>
      api.get<Paginated<AttendanceDto>>(`/members/${memberId}/attendance`, {
        query: { ...query },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useAttendanceCorrections(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.attendance.corrections(id),
    queryFn: async ({ signal }) =>
      (
        await api.get<{ data: AttendanceCorrectionDto[] }>(`/attendance/${id}/corrections`, {
          signal,
        })
      ).data,
    enabled,
  });
}

/** Attendance feeds the lists, member pages, access log and dashboard counts. */
function useRefreshAttendance() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.attendance.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.access.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
    ]);
}

/**
 * Staff verified the member by hand. The server runs the same eligibility checks, so this can
 * still be denied; the decision comes back either way. Errors stay errors (nothing is granted).
 */
export function useManualCheckIn() {
  const refresh = useRefreshAttendance();
  return useMutation({
    mutationFn: async (input: ManualCheckInInput): Promise<AccessDecision> =>
      parseDecision(await api.post<unknown>('/attendance/manual-check-in', input), null, 'MANUAL'),
    onSettled: refresh,
  });
}

export function useCheckOut() {
  const refresh = useRefreshAttendance();
  return useMutation({
    mutationFn: (id: string) => api.post<AttendanceDto>(`/attendance/${id}/check-out`),
    onSuccess: refresh,
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) void refresh();
    },
  });
}

export function useCorrectAttendance(id: string) {
  const refresh = useRefreshAttendance();
  return useMutation({
    mutationFn: (input: AttendanceCorrectionInput) =>
      api.post<AttendanceDto>(`/attendance/${id}/corrections`, input),
    onSuccess: refresh,
  });
}
