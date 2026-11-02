import type {
  CreateExerciseInput,
  CreateWorkoutAssignmentInput,
  CreateWorkoutPlanInput,
  ExerciseDto,
  ExerciseListQuery,
  LogWorkoutInput,
  MyWorkoutDto,
  Paginated,
  ProgressEntryDto,
  RecordProgressInput,
  SetWorkoutPlanItemsInput,
  UpdateExerciseInput,
  UpdateWorkoutAssignmentInput,
  UpdateWorkoutPlanInput,
  WorkoutAssignmentDto,
  WorkoutAssignmentListQuery,
  WorkoutLogDto,
  WorkoutLogListQuery,
  WorkoutPlanDetailDto,
  WorkoutPlanDto,
  WorkoutPlanListQuery,
} from '@gms/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { queryKeys } from '../../api/query-keys';

// --- Exercises ---------------------------------------------------------------------------------

export function useExerciseList(query: ExerciseListQuery, enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.exercises.list(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<ExerciseDto>>('/exercises', { query: { ...query }, signal }),
    placeholderData: keepPreviousData,
  });
}

function useExerciseMutation<TInput>(request: (input: TInput) => Promise<ExerciseDto>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.exercises.all });
      // Plans show exercise names and pictures.
      void queryClient.invalidateQueries({ queryKey: queryKeys.workouts.all });
    },
  });
}

export const useCreateExercise = () =>
  useExerciseMutation((input: CreateExerciseInput) => api.post<ExerciseDto>('/exercises', input));

export const useUpdateExercise = () =>
  useExerciseMutation(({ id, input }: { id: string; input: UpdateExerciseInput }) =>
    api.patch<ExerciseDto>(`/exercises/${id}`, input),
  );

export const useArchiveExercise = () =>
  useExerciseMutation((id: string) => api.post<ExerciseDto>(`/exercises/${id}/archive`));

export const useUploadExerciseImage = () =>
  useExerciseMutation(({ id, file }: { id: string; file: File }) => {
    const form = new FormData();
    form.append('image', file);
    return api.upload<ExerciseDto>(`/exercises/${id}/image`, form);
  });

// --- Plans -------------------------------------------------------------------------------------

export function useWorkoutPlanList(query: WorkoutPlanListQuery, enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.workouts.plans(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<WorkoutPlanDto>>('/workout-plans', { query: { ...query }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useWorkoutPlan(id: string, enabled = true) {
  return useQuery({
    enabled: enabled && Boolean(id),
    queryKey: queryKeys.workouts.plan(id),
    queryFn: ({ signal }) => api.get<WorkoutPlanDetailDto>(`/workout-plans/${id}`, { signal }),
  });
}

function useWorkoutMutation<TInput, TResult>(request: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workouts.all }),
  });
}

export const useCreateWorkoutPlan = () =>
  useWorkoutMutation((input: CreateWorkoutPlanInput) =>
    api.post<WorkoutPlanDetailDto>('/workout-plans', input),
  );

export const useUpdateWorkoutPlan = () =>
  useWorkoutMutation(({ id, input }: { id: string; input: UpdateWorkoutPlanInput }) =>
    api.patch<WorkoutPlanDetailDto>(`/workout-plans/${id}`, input),
  );

export const useSetWorkoutPlanItems = () =>
  useWorkoutMutation(({ id, input }: { id: string; input: SetWorkoutPlanItemsInput }) =>
    api.put<WorkoutPlanDetailDto>(`/workout-plans/${id}/items`, input),
  );

export const useDuplicateWorkoutPlan = () =>
  useWorkoutMutation(({ id, name }: { id: string; name?: string }) =>
    api.post<WorkoutPlanDetailDto>(`/workout-plans/${id}/duplicate`, name ? { name } : {}),
  );

export const useArchiveWorkoutPlan = () =>
  useWorkoutMutation(({ id, reason }: { id: string; reason?: string }) =>
    api.post<WorkoutPlanDetailDto>(`/workout-plans/${id}/archive`, reason ? { reason } : {}),
  );

// --- Assignments, logs and progress ------------------------------------------------------------

export function useWorkoutAssignments(query: WorkoutAssignmentListQuery, enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.workouts.assignments(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<WorkoutAssignmentDto>>('/workout-assignments', {
        query: { ...query },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useWorkoutAssignment(id: string) {
  return useQuery({
    queryKey: queryKeys.workouts.assignment(id),
    queryFn: ({ signal }) =>
      api.get<WorkoutAssignmentDto>(`/workout-assignments/${id}`, { signal }),
  });
}

export const useAssignWorkout = () =>
  useWorkoutMutation((input: CreateWorkoutAssignmentInput) =>
    api.post<WorkoutAssignmentDto>('/workout-assignments', input),
  );

export const useUpdateWorkoutAssignment = () =>
  useWorkoutMutation(({ id, input }: { id: string; input: UpdateWorkoutAssignmentInput }) =>
    api.patch<WorkoutAssignmentDto>(`/workout-assignments/${id}`, input),
  );

export function useWorkoutLogs(query: WorkoutLogListQuery, enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.workouts.logs(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<WorkoutLogDto>>('/workout-logs', { query: { ...query }, signal }),
    placeholderData: keepPreviousData,
  });
}

export const useLogWorkout = () =>
  useWorkoutMutation((input: LogWorkoutInput) => api.post<WorkoutLogDto[]>('/workout-logs', input));

export function useMemberProgress(memberId: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.workouts.progress(memberId),
    queryFn: ({ signal }) =>
      api.get<ProgressEntryDto[]>(`/members/${memberId}/progress`, { signal }),
  });
}

export const useRecordMemberProgress = (memberId: string) =>
  useWorkoutMutation((input: RecordProgressInput) =>
    api.post<ProgressEntryDto>(`/members/${memberId}/progress`, input),
  );

// --- Portal ------------------------------------------------------------------------------------

export function useMyWorkouts() {
  return useQuery({
    queryKey: queryKeys.workouts.myWorkouts,
    queryFn: ({ signal }) => api.get<MyWorkoutDto[]>('/me/workouts', { signal }),
  });
}

export function useMyWorkoutLogs(query: WorkoutLogListQuery) {
  return useQuery({
    queryKey: queryKeys.workouts.myLogs(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<WorkoutLogDto>>('/me/workout-logs', { query: { ...query }, signal }),
    placeholderData: keepPreviousData,
  });
}

export const useLogMyWorkout = () =>
  useWorkoutMutation((input: LogWorkoutInput) =>
    api.post<WorkoutLogDto[]>('/me/workout-logs', input),
  );

export function useMyProgress() {
  return useQuery({
    queryKey: queryKeys.workouts.myProgress,
    queryFn: ({ signal }) => api.get<ProgressEntryDto[]>('/me/progress', { signal }),
  });
}

export const useRecordMyProgress = () =>
  useWorkoutMutation((input: RecordProgressInput) =>
    api.post<ProgressEntryDto>('/me/progress', input),
  );
