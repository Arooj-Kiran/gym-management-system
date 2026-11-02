import type {
  AppointmentDto,
  AppointmentListQuery,
  AssignmentListQuery,
  AvailableSlotDto,
  AvailableSlotsQuery,
  ClassAttendanceStatus,
  ClassBookingDto,
  ClassSessionDto,
  ClassSessionListQuery,
  CreateAppointmentInput,
  CreateAssignmentInput,
  CreateClassInput,
  CreateClassSessionInput,
  CreateShiftInput,
  CreateTimeOffInput,
  FitnessClassDto,
  MyAppointmentDto,
  MyClassSessionDto,
  MyScheduleItemDto,
  Paginated,
  PublicTrainerDto,
  ScheduleItemDto,
  ScheduleQuery,
  SetAvailabilityInput,
  ShiftDto,
  ShiftListQuery,
  TimeOffDto,
  TrainerAssignmentDto,
  TrainerAvailabilityDto,
  TrainerDto,
  TrainerMemberDto,
  UpdateAppointmentInput,
  UpdateClassInput,
  UpdateClassSessionInput,
  UpdateShiftInput,
  UpdateTrainerProfileInput,
} from '@gms/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { queryKeys } from '../../api/query-keys';

interface List<T> {
  data: T[];
}

/**
 * Any change to a trainer, class, booking, appointment or shift can move other screens (a
 * booking changes the roster, the timetable, the trainer's schedule and the dashboard), so every
 * mutation refreshes the whole scheduling cache and the dashboard.
 */
function useSchedulingMutation<TInput, TResult>(request: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.scheduling.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
      ]);
    },
  });
}

// --- Trainers -----------------------------------------------------------------------------

export function useTrainers(enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.scheduling.trainers,
    queryFn: ({ signal }) => api.get<List<TrainerDto>>('/trainers', { signal }),
    select: (result) => result.data,
  });
}

export function useTrainer(id: string) {
  return useQuery({
    queryKey: queryKeys.scheduling.trainer(id),
    queryFn: ({ signal }) => api.get<TrainerDto>(`/trainers/${id}`, { signal }),
  });
}

export const useUpdateTrainer = () =>
  useSchedulingMutation(({ id, input }: { id: string; input: UpdateTrainerProfileInput }) =>
    api.patch<TrainerDto>(`/trainers/${id}`, input),
  );

export function useAvailability(id: string, enabled = true) {
  return useQuery({
    enabled: enabled && Boolean(id),
    queryKey: queryKeys.scheduling.availability(id),
    queryFn: ({ signal }) =>
      api.get<TrainerAvailabilityDto>(`/trainers/${id}/availability`, { signal }),
  });
}

export const useSetAvailability = () =>
  useSchedulingMutation(({ id, input }: { id: string; input: SetAvailabilityInput }) =>
    api.put<TrainerAvailabilityDto>(`/trainers/${id}/availability`, input),
  );

export const useAddTimeOff = () =>
  useSchedulingMutation(({ id, input }: { id: string; input: CreateTimeOffInput }) =>
    api.post<TimeOffDto>(`/trainers/${id}/time-off`, input),
  );

export const useCancelTimeOff = () =>
  useSchedulingMutation(({ id, reason }: { id: string; reason?: string }) =>
    api.post<TimeOffDto>(`/time-off/${id}/cancel`, reason ? { reason } : {}),
  );

export function useTrainerSchedule(id: string, query: ScheduleQuery, enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.scheduling.trainerSchedule(id, query),
    queryFn: ({ signal }) =>
      api.get<List<ScheduleItemDto>>(`/trainers/${id}/schedule`, { query: { ...query }, signal }),
    select: (result) => result.data,
    placeholderData: keepPreviousData,
  });
}

export function useAvailableSlots(id: string | null, query: AvailableSlotsQuery) {
  return useQuery({
    enabled: Boolean(id && query.date),
    queryKey: queryKeys.scheduling.availableSlots(id ?? '', query),
    queryFn: ({ signal }) =>
      api.get<List<AvailableSlotDto>>(`/trainers/${id}/available-slots`, {
        query: { ...query },
        signal,
      }),
    select: (result) => result.data,
  });
}

export function useTrainerMembers(id: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.scheduling.trainerMembers(id),
    queryFn: ({ signal }) => api.get<List<TrainerMemberDto>>(`/trainers/${id}/members`, { signal }),
    select: (result) => result.data,
  });
}

export function useAssignments(query: AssignmentListQuery, enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.scheduling.assignments(query),
    queryFn: ({ signal }) =>
      api.get<List<TrainerAssignmentDto>>('/trainer-assignments', { query: { ...query }, signal }),
    select: (result) => result.data,
  });
}

export const useCreateAssignment = () =>
  useSchedulingMutation((input: CreateAssignmentInput) =>
    api.post<TrainerAssignmentDto>('/trainer-assignments', input),
  );

export const useEndAssignment = () =>
  useSchedulingMutation(({ id, reason }: { id: string; reason?: string }) =>
    api.post<TrainerAssignmentDto>(`/trainer-assignments/${id}/end`, reason ? { reason } : {}),
  );

// --- Classes and bookings -----------------------------------------------------------------

export function useClasses(includeArchived = false) {
  return useQuery({
    queryKey: queryKeys.scheduling.classes(includeArchived),
    queryFn: ({ signal }) =>
      api.get<List<FitnessClassDto>>('/classes', {
        query: includeArchived ? { includeArchived: true } : {},
        signal,
      }),
    select: (result) => result.data,
  });
}

export const useCreateClass = () =>
  useSchedulingMutation((input: CreateClassInput) => api.post<FitnessClassDto>('/classes', input));

export const useUpdateClass = () =>
  useSchedulingMutation(({ id, input }: { id: string; input: UpdateClassInput }) =>
    api.patch<FitnessClassDto>(`/classes/${id}`, input),
  );

export const useArchiveClass = () =>
  useSchedulingMutation((id: string) => api.post<FitnessClassDto>(`/classes/${id}/archive`));

export function useClassSessions(query: ClassSessionListQuery) {
  return useQuery({
    queryKey: queryKeys.scheduling.sessions(query),
    queryFn: ({ signal }) =>
      api.get<List<ClassSessionDto>>('/class-sessions', { query: { ...query }, signal }),
    select: (result) => result.data,
    placeholderData: keepPreviousData,
  });
}

export function useClassSession(id: string) {
  return useQuery({
    queryKey: queryKeys.scheduling.session(id),
    queryFn: ({ signal }) => api.get<ClassSessionDto>(`/class-sessions/${id}`, { signal }),
  });
}

export const useCreateSessions = () =>
  useSchedulingMutation((input: CreateClassSessionInput) =>
    api.post<List<ClassSessionDto>>('/class-sessions', input),
  );

export const useUpdateSession = () =>
  useSchedulingMutation(({ id, input }: { id: string; input: UpdateClassSessionInput }) =>
    api.patch<ClassSessionDto>(`/class-sessions/${id}`, input),
  );

export const useCancelSession = () =>
  useSchedulingMutation(({ id, reason }: { id: string; reason: string }) =>
    api.post<ClassSessionDto>(`/class-sessions/${id}/cancel`, { reason }),
  );

export function useRoster(sessionId: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.scheduling.roster(sessionId),
    queryFn: ({ signal }) =>
      api.get<List<ClassBookingDto>>(`/class-sessions/${sessionId}/bookings`, { signal }),
    select: (result) => result.data,
  });
}

export const useBookMember = () =>
  useSchedulingMutation(({ sessionId, memberId }: { sessionId: string; memberId: string }) =>
    api.post<ClassBookingDto>(`/class-sessions/${sessionId}/bookings`, { memberId }),
  );

export const useCancelBooking = () =>
  useSchedulingMutation((id: string) => api.post<ClassBookingDto>(`/bookings/${id}/cancel`));

export const useMarkAttendance = () =>
  useSchedulingMutation(({ id, status }: { id: string; status: ClassAttendanceStatus }) =>
    api.post<ClassBookingDto>(`/bookings/${id}/attendance`, { status }),
  );

// --- Appointments -------------------------------------------------------------------------

export function useAppointments(query: AppointmentListQuery) {
  return useQuery({
    queryKey: queryKeys.scheduling.appointments(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<AppointmentDto>>('/appointments', { query: { ...query }, signal }),
    placeholderData: keepPreviousData,
  });
}

export const useCreateAppointment = () =>
  useSchedulingMutation((input: CreateAppointmentInput) =>
    api.post<AppointmentDto>('/appointments', input),
  );

export const useUpdateAppointment = () =>
  useSchedulingMutation(({ id, input }: { id: string; input: UpdateAppointmentInput }) =>
    api.patch<AppointmentDto>(`/appointments/${id}`, input),
  );

export type AppointmentAction = 'cancel' | 'complete' | 'no-show';

export const useAppointmentAction = () =>
  useSchedulingMutation(
    ({ id, action, reason }: { id: string; action: AppointmentAction; reason?: string }) =>
      api.post<AppointmentDto>(`/appointments/${id}/${action}`, reason ? { reason } : {}),
  );

// --- Shifts -------------------------------------------------------------------------------

export function useShifts(query: ShiftListQuery) {
  return useQuery({
    queryKey: queryKeys.scheduling.shifts(query),
    queryFn: ({ signal }) => api.get<List<ShiftDto>>('/shifts', { query: { ...query }, signal }),
    select: (result) => result.data,
    placeholderData: keepPreviousData,
  });
}

export const useCreateShift = () =>
  useSchedulingMutation((input: CreateShiftInput) => api.post<ShiftDto>('/shifts', input));

export const useUpdateShift = () =>
  useSchedulingMutation(({ id, input }: { id: string; input: UpdateShiftInput }) =>
    api.patch<ShiftDto>(`/shifts/${id}`, input),
  );

export const useCancelShift = () =>
  useSchedulingMutation(({ id, reason }: { id: string; reason?: string }) =>
    api.post<ShiftDto>(`/shifts/${id}/cancel`, reason ? { reason } : {}),
  );

// --- Member portal ------------------------------------------------------------------------

export function useMyClassSessions(query: ScheduleQuery) {
  return useQuery({
    queryKey: queryKeys.scheduling.myClassSessions(query),
    queryFn: ({ signal }) =>
      api.get<List<MyClassSessionDto>>('/me/class-sessions', { query: { ...query }, signal }),
    select: (result) => result.data,
    placeholderData: keepPreviousData,
  });
}

export function useMySchedule() {
  return useQuery({
    queryKey: queryKeys.scheduling.mySchedule,
    queryFn: ({ signal }) => api.get<List<MyScheduleItemDto>>('/me/schedule', { signal }),
    select: (result) => result.data,
  });
}

export function useMyAppointments() {
  return useQuery({
    queryKey: queryKeys.scheduling.myAppointments,
    queryFn: ({ signal }) => api.get<List<MyAppointmentDto>>('/me/appointments', { signal }),
    select: (result) => result.data,
  });
}

export function useMyTrainers() {
  return useQuery({
    queryKey: queryKeys.scheduling.myTrainers,
    queryFn: ({ signal }) => api.get<List<PublicTrainerDto>>('/me/trainers', { signal }),
    select: (result) => result.data,
  });
}

export const useBookMyClass = () =>
  useSchedulingMutation((sessionId: string) => api.post<unknown>('/me/bookings', { sessionId }));

export const useCancelMyBooking = () =>
  useSchedulingMutation((id: string) => api.post<unknown>(`/me/bookings/${id}/cancel`));

export const useCancelMyAppointment = () =>
  useSchedulingMutation((id: string) => api.post<unknown>(`/me/appointments/${id}/cancel`));
