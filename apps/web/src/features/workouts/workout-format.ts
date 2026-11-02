import type {
  DifficultyLevel,
  WorkoutAssignmentStatus,
  WorkoutLogDto,
  WorkoutPlanItemDto,
} from '@gms/shared';
import type { BadgeTone } from '../../components/ui/badge';

export const DIFFICULTY_TONES: Record<DifficultyLevel, BadgeTone> = {
  BEGINNER: 'success',
  INTERMEDIATE: 'primary',
  ADVANCED: 'warning',
};

export const ASSIGNMENT_TONES: Record<WorkoutAssignmentStatus, BadgeTone> = {
  ACTIVE: 'success',
  COMPLETED: 'neutral',
  CANCELLED: 'danger',
};

/** 45 → "45 s", 90 → "1 min 30 s", 600 → "10 min". */
export function formatSeconds(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/** "3 × 12" or "3 × 45 s"; both when an item has reps and a time. */
export function formatPrescription(
  item: Pick<WorkoutPlanItemDto, 'sets' | 'reps' | 'durationSeconds'>,
) {
  const work = [
    item.reps !== null ? `${item.reps}` : null,
    item.durationSeconds !== null ? formatSeconds(item.durationSeconds) : null,
  ]
    .filter(Boolean)
    .join(' / ');
  return `${item.sets} × ${work}`;
}

export const dayLabel = (day: number) => `Day ${day}`;

/** Items grouped by training day, in plan order. */
export function groupByDay<T extends { dayNumber: number; position: number }>(items: T[]) {
  const days = new Map<number, T[]>();
  for (const item of [...items].sort(
    (a, b) => a.dayNumber - b.dayNumber || a.position - b.position,
  )) {
    const list = days.get(item.dayNumber) ?? [];
    list.push(item);
    days.set(item.dayNumber, list);
  }
  return [...days.entries()].map(([day, list]) => ({ day, items: list }));
}

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** Logged entries grouped into sessions (one per date and assignment), newest first. */
export function groupSessions(logs: WorkoutLogDto[]) {
  const sessions = new Map<string, WorkoutLogDto[]>();
  for (const log of logs) {
    const key = `${log.performedOn}|${log.assignmentId}`;
    sessions.set(key, [...(sessions.get(key) ?? []), log]);
  }
  return [...sessions.entries()]
    .map(([key, entries]) => ({ key, performedOn: entries[0]!.performedOn, entries }))
    .sort((a, b) => b.performedOn.localeCompare(a.performedOn));
}
