import type { WorkoutPlanItemDto } from '@gms/shared';

export const FIELDS = [
  'sets',
  'reps',
  'durationSeconds',
  'restSeconds',
  'loadNote',
  'notes',
] as const;
export type Field = (typeof FIELDS)[number];

/** One row being edited. Numbers stay strings until save so inputs can be cleared freely. */
export interface DraftItem {
  key: string;
  exercise: WorkoutPlanItemDto['exercise'];
  dayNumber: number;
  sets: string;
  reps: string;
  durationSeconds: string;
  restSeconds: string;
  loadNote: string;
  notes: string;
}

export type DraftErrors = Record<string, Partial<Record<Field | 'exercise', string>>>;

let nextKey = 0;
export const newKey = () => `draft-${++nextKey}`;

export function toDraft(item: WorkoutPlanItemDto): DraftItem {
  return {
    key: item.id,
    exercise: item.exercise,
    dayNumber: item.dayNumber,
    sets: String(item.sets),
    reps: item.reps === null ? '' : String(item.reps),
    durationSeconds: item.durationSeconds === null ? '' : String(item.durationSeconds),
    restSeconds: String(item.restSeconds),
    loadNote: item.loadNote ?? '',
    notes: item.notes ?? '',
  };
}

/** Items in the order they are saved: by day, then their order within the day. */
export function orderDrafts(drafts: DraftItem[]) {
  return drafts
    .map((draft, index) => ({ draft, index }))
    .sort((a, b) => a.draft.dayNumber - b.draft.dayNumber || a.index - b.index)
    .map(({ draft }) => draft);
}

export function toPayload(drafts: DraftItem[]) {
  return orderDrafts(drafts).map((draft) => ({
    exerciseId: draft.exercise.id,
    dayNumber: draft.dayNumber,
    sets: draft.sets.trim(),
    reps: draft.reps.trim() || null,
    durationSeconds: draft.durationSeconds.trim() || null,
    restSeconds: draft.restSeconds.trim() || '0',
    loadNote: draft.loadNote,
    notes: draft.notes,
  }));
}

/** "items.3.reps" (or a Zod path) → the draft row and field it belongs to. */
export function errorsFromPaths(
  ordered: DraftItem[],
  issues: { path: (string | number)[]; message: string }[],
) {
  const errors: DraftErrors = {};
  let general: string | null = null;
  for (const issue of issues) {
    const [root, index, field] = issue.path;
    const draft = root === 'items' && typeof index === 'number' ? ordered[index] : undefined;
    if (!draft) {
      general ??= issue.message;
      continue;
    }
    const key = FIELDS.includes(field as Field) ? (field as Field) : 'exercise';
    errors[draft.key] = { ...errors[draft.key], [key]: errors[draft.key]?.[key] ?? issue.message };
  }
  return { errors, general };
}

export const splitPath = (path: string) =>
  path.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part));
