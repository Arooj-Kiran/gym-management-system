import { z } from 'zod';
import {
  DIFFICULTY_LEVELS,
  MUSCLE_GROUPS,
  WORKOUT_ASSIGNMENT_STATUSES,
  WORKOUT_PLAN_STATUSES,
  type BodyMeasurement,
  type DifficultyLevel,
  type MuscleGroup,
  type WorkoutAssignmentStatus,
  type WorkoutPlanStatus,
} from '../enums';
import {
  isoDateSchema,
  listQueryBase,
  nameSchema,
  optionalIsoDateSchema,
  optionalTextSchema,
  queryBooleanSchema,
} from './common';
import type { PersonRef, TrainerSafeMemberDto } from './trainers';

export const WORKOUT_LIMITS = {
  descriptionMax: 1000,
  instructionsMax: 2000,
  equipmentNeededMax: 200,
  goalMax: 200,
  notesMax: 500,
  loadNoteMax: 60,
  /** Exercises in one plan, across all its days. */
  itemsMax: 70,
  /** Entries in one workout log submission. */
  logEntriesMax: 30,
  maxSets: 20,
  maxReps: 100,
  /** One timed exercise, in seconds (2 hours). */
  maxDurationSeconds: 7200,
  maxRestSeconds: 600,
  minWeightKg: 20,
  maxWeightKg: 400,
  minBodyFatPct: 2,
  maxBodyFatPct: 70,
  minMeasurementCm: 10,
  maxMeasurementCm: 300,
  /** Progress entries returned for the history chart. */
  progressHistoryMax: 200,
} as const;

const wholeNumber = (label: string, min: number, max: number) =>
  z.coerce
    .number({ error: `Enter ${label}` })
    .int('Enter a whole number')
    .min(min, `At least ${min}`)
    .max(max, `At most ${max}`);

const optionalWholeNumber = (label: string, min: number, max: number) =>
  wholeNumber(label, min, max).nullish();

// --- Exercises ---------------------------------------------------------------------------------

export const createExerciseSchema = z.strictObject({
  name: nameSchema,
  description: optionalTextSchema(WORKOUT_LIMITS.descriptionMax),
  muscleGroup: z.enum(MUSCLE_GROUPS, { error: 'Choose a muscle group' }),
  difficulty: z.enum(DIFFICULTY_LEVELS, { error: 'Choose a difficulty' }),
  instructions: optionalTextSchema(WORKOUT_LIMITS.instructionsMax),
  equipmentNeeded: optionalTextSchema(WORKOUT_LIMITS.equipmentNeededMax),
});
export type CreateExerciseInput = z.input<typeof createExerciseSchema>;

export const updateExerciseSchema = createExerciseSchema.partial();
export type UpdateExerciseInput = z.input<typeof updateExerciseSchema>;

export const exerciseListQuerySchema = z.strictObject({
  ...listQueryBase,
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  muscleGroup: z.enum(MUSCLE_GROUPS).optional(),
  difficulty: z.enum(DIFFICULTY_LEVELS).optional(),
  includeArchived: queryBooleanSchema.optional(),
});
export type ExerciseListQuery = z.input<typeof exerciseListQuerySchema>;

// --- Workout plans -----------------------------------------------------------------------------

const planFields = {
  name: nameSchema,
  description: optionalTextSchema(WORKOUT_LIMITS.descriptionMax),
  goal: optionalTextSchema(WORKOUT_LIMITS.goalMax),
  difficulty: z.enum(DIFFICULTY_LEVELS, { error: 'Choose a difficulty' }),
  /** A reusable starting point rather than a plan built for one member. */
  isTemplate: z.boolean().optional(),
};

export const createWorkoutPlanSchema = z.strictObject({
  ...planFields,
  /** Admin / Manager only; a trainer always owns the plans they create. */
  ownerTrainerId: z.uuid({ error: 'Choose a trainer' }).nullish(),
});
export type CreateWorkoutPlanInput = z.input<typeof createWorkoutPlanSchema>;

export const updateWorkoutPlanSchema = z.strictObject(planFields).partial();
export type UpdateWorkoutPlanInput = z.input<typeof updateWorkoutPlanSchema>;

export const duplicateWorkoutPlanSchema = z.strictObject({ name: nameSchema.optional() });
export type DuplicateWorkoutPlanInput = z.input<typeof duplicateWorkoutPlanSchema>;

export const workoutPlanItemSchema = z
  .strictObject({
    exerciseId: z.uuid({ error: 'Choose an exercise' }),
    dayNumber: wholeNumber('a day', 1, 7),
    sets: wholeNumber('the sets', 1, WORKOUT_LIMITS.maxSets),
    reps: optionalWholeNumber('the reps', 1, WORKOUT_LIMITS.maxReps),
    durationSeconds: optionalWholeNumber('a duration', 1, WORKOUT_LIMITS.maxDurationSeconds),
    restSeconds: wholeNumber('the rest', 0, WORKOUT_LIMITS.maxRestSeconds).default(60),
    loadNote: optionalTextSchema(WORKOUT_LIMITS.loadNoteMax),
    notes: optionalTextSchema(WORKOUT_LIMITS.notesMax),
  })
  .refine((item) => (item.reps ?? null) !== null || (item.durationSeconds ?? null) !== null, {
    path: ['reps'],
    message: 'Enter reps or a duration',
  });
export type WorkoutPlanItemInput = z.input<typeof workoutPlanItemSchema>;

/** Replaces every item. Order within a day is the order sent. */
export const setWorkoutPlanItemsSchema = z.strictObject({
  items: z
    .array(workoutPlanItemSchema)
    .max(WORKOUT_LIMITS.itemsMax, `A plan can hold at most ${WORKOUT_LIMITS.itemsMax} exercises`),
});
export type SetWorkoutPlanItemsInput = z.input<typeof setWorkoutPlanItemsSchema>;

export const workoutPlanListQuerySchema = z.strictObject({
  ...listQueryBase,
  status: z.enum(WORKOUT_PLAN_STATUSES).optional(),
  difficulty: z.enum(DIFFICULTY_LEVELS).optional(),
  ownerTrainerId: z.uuid({ error: 'Invalid trainer' }).optional(),
  isTemplate: queryBooleanSchema.optional(),
});
export type WorkoutPlanListQuery = z.input<typeof workoutPlanListQuerySchema>;

// --- Assignments, logs and progress ------------------------------------------------------------

export const createWorkoutAssignmentSchema = z
  .strictObject({
    planId: z.uuid({ error: 'Choose a plan' }),
    memberId: z.uuid({ error: 'Choose a member' }),
    /** Admin / Manager may name the responsible trainer; a trainer is always themselves. */
    trainerId: z.uuid({ error: 'Choose a trainer' }).nullish(),
    /** Defaults to today in gym time. */
    startDate: optionalIsoDateSchema,
    endDate: optionalIsoDateSchema,
    trainerNotes: optionalTextSchema(WORKOUT_LIMITS.notesMax),
  })
  .refine((input) => !input.startDate || !input.endDate || input.endDate >= input.startDate, {
    path: ['endDate'],
    message: 'Must be on or after the start date',
  });
export type CreateWorkoutAssignmentInput = z.input<typeof createWorkoutAssignmentSchema>;

/** Partial: fields left out stay as they are (null clears notes or the end date). */
export const updateWorkoutAssignmentSchema = z
  .strictObject({
    trainerNotes: optionalTextSchema(WORKOUT_LIMITS.notesMax),
    endDate: optionalIsoDateSchema,
    /** Closing is final: COMPLETED or CANCELLED. */
    status: z.enum(['COMPLETED', 'CANCELLED'], { error: 'Choose completed or cancelled' }),
  })
  .partial();
export type UpdateWorkoutAssignmentInput = z.input<typeof updateWorkoutAssignmentSchema>;

export const workoutAssignmentListQuerySchema = z.strictObject({
  ...listQueryBase,
  memberId: z.uuid({ error: 'Invalid member' }).optional(),
  planId: z.uuid({ error: 'Invalid plan' }).optional(),
  trainerId: z.uuid({ error: 'Invalid trainer' }).optional(),
  status: z.enum(WORKOUT_ASSIGNMENT_STATUSES).optional(),
});
export type WorkoutAssignmentListQuery = z.input<typeof workoutAssignmentListQuerySchema>;

export const workoutLogEntrySchema = z.strictObject({
  /** Null for work done outside the plan (described in the notes). */
  planItemId: z.uuid({ error: 'Invalid exercise' }).nullish(),
  completed: z.boolean({ error: 'Say whether it was completed' }),
  actualSets: optionalWholeNumber('the sets', 0, WORKOUT_LIMITS.maxSets),
  actualReps: optionalWholeNumber('the reps', 0, WORKOUT_LIMITS.maxReps),
  actualLoad: optionalTextSchema(WORKOUT_LIMITS.loadNoteMax),
  actualDurationSeconds: optionalWholeNumber('a duration', 0, WORKOUT_LIMITS.maxDurationSeconds),
  notes: optionalTextSchema(WORKOUT_LIMITS.notesMax),
});
export type WorkoutLogEntryInput = z.input<typeof workoutLogEntrySchema>;

export const logWorkoutSchema = z.strictObject({
  assignmentId: z.uuid({ error: 'Choose a workout' }),
  /** Defaults to today in gym time; never in the future. */
  performedOn: optionalIsoDateSchema,
  entries: z
    .array(
      workoutLogEntrySchema.refine((entry) => entry.planItemId || entry.notes, {
        path: ['notes'],
        message: 'Describe work that is not part of the plan',
      }),
    )
    .min(1, 'Log at least one exercise')
    .max(WORKOUT_LIMITS.logEntriesMax, `Log at most ${WORKOUT_LIMITS.logEntriesMax} at once`),
});
export type LogWorkoutInput = z.input<typeof logWorkoutSchema>;

export const workoutLogListQuerySchema = z.strictObject({
  ...listQueryBase,
  memberId: z.uuid({ error: 'Invalid member' }).optional(),
  assignmentId: z.uuid({ error: 'Invalid workout' }).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type WorkoutLogListQuery = z.input<typeof workoutLogListQuerySchema>;

const measurementSchema = z.coerce
  .number({ error: 'Enter centimetres' })
  .min(WORKOUT_LIMITS.minMeasurementCm, `At least ${WORKOUT_LIMITS.minMeasurementCm} cm`)
  .max(WORKOUT_LIMITS.maxMeasurementCm, `At most ${WORKOUT_LIMITS.maxMeasurementCm} cm`)
  .transform((value) => Math.round(value * 10) / 10);

export const recordProgressSchema = z
  .strictObject({
    /** Defaults to today in gym time; never in the future. */
    recordedOn: optionalIsoDateSchema,
    weightKg: z.coerce
      .number({ error: 'Enter a weight in kg' })
      .min(WORKOUT_LIMITS.minWeightKg, `At least ${WORKOUT_LIMITS.minWeightKg} kg`)
      .max(WORKOUT_LIMITS.maxWeightKg, `At most ${WORKOUT_LIMITS.maxWeightKg} kg`)
      .transform((value) => Math.round(value * 10) / 10)
      .nullish(),
    bodyFatPct: z.coerce
      .number({ error: 'Enter a percentage' })
      .min(WORKOUT_LIMITS.minBodyFatPct, `At least ${WORKOUT_LIMITS.minBodyFatPct}%`)
      .max(WORKOUT_LIMITS.maxBodyFatPct, `At most ${WORKOUT_LIMITS.maxBodyFatPct}%`)
      .transform((value) => Math.round(value * 10) / 10)
      .nullish(),
    measurements: z
      .strictObject({
        chest: measurementSchema.nullish(),
        waist: measurementSchema.nullish(),
        hips: measurementSchema.nullish(),
        arm: measurementSchema.nullish(),
        thigh: measurementSchema.nullish(),
      } satisfies Record<BodyMeasurement, unknown>)
      .optional(),
    notes: optionalTextSchema(WORKOUT_LIMITS.notesMax),
  })
  .refine(
    (input) =>
      (input.weightKg ?? null) !== null ||
      (input.bodyFatPct ?? null) !== null ||
      Object.values(input.measurements ?? {}).some((value) => (value ?? null) !== null),
    { path: ['weightKg'], message: 'Enter at least one measurement' },
  );
export type RecordProgressInput = z.input<typeof recordProgressSchema>;

// --- DTOs --------------------------------------------------------------------------------------

export interface ExerciseDto {
  id: string;
  name: string;
  description: string | null;
  muscleGroup: MuscleGroup;
  difficulty: DifficultyLevel;
  instructions: string | null;
  equipmentNeeded: string | null;
  imageUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkoutPlanDto {
  id: string;
  name: string;
  description: string | null;
  goal: string | null;
  difficulty: DifficultyLevel;
  owner: PersonRef | null;
  isTemplate: boolean;
  status: WorkoutPlanStatus;
  itemCount: number;
  /** Distinct training days in the plan. */
  dayCount: number;
  activeAssignments: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkoutPlanItemDto {
  id: string;
  dayNumber: number;
  position: number;
  exercise: Pick<
    ExerciseDto,
    'id' | 'name' | 'muscleGroup' | 'difficulty' | 'instructions' | 'imageUrl' | 'isActive'
  >;
  sets: number;
  reps: number | null;
  durationSeconds: number | null;
  restSeconds: number;
  loadNote: string | null;
  notes: string | null;
}

export interface WorkoutPlanDetailDto extends WorkoutPlanDto {
  items: WorkoutPlanItemDto[];
}

export interface WorkoutAssignmentDto {
  id: string;
  plan: Pick<WorkoutPlanDto, 'id' | 'name' | 'difficulty' | 'status'>;
  member: TrainerSafeMemberDto;
  trainer: PersonRef | null;
  startDate: string;
  endDate: string | null;
  status: WorkoutAssignmentStatus;
  trainerNotes: string | null;
  /** Days with at least one completed exercise. */
  daysLogged: number;
  lastLoggedOn: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkoutLogDto {
  id: string;
  assignmentId: string;
  memberId: string;
  planItemId: string | null;
  exerciseName: string | null;
  performedOn: string;
  completed: boolean;
  actualSets: number | null;
  actualReps: number | null;
  actualLoad: string | null;
  actualDurationSeconds: number | null;
  notes: string | null;
  loggedByName: string | null;
  createdAt: string;
}

export type BodyMeasurements = Partial<Record<BodyMeasurement, number>>;

export interface ProgressEntryDto {
  id: string;
  memberId: string;
  recordedOn: string;
  weightKg: number | null;
  bodyFatPct: number | null;
  measurements: BodyMeasurements;
  notes: string | null;
  recordedByName: string | null;
  createdAt: string;
}

/** Portal: one assigned plan with everything needed to follow and log it. */
export interface MyWorkoutDto {
  assignmentId: string;
  status: WorkoutAssignmentStatus;
  startDate: string;
  endDate: string | null;
  trainerNotes: string | null;
  trainer: PersonRef | null;
  plan: Omit<WorkoutPlanDetailDto, 'owner' | 'activeAssignments' | 'isTemplate'>;
  daysLogged: number;
  lastLoggedOn: string | null;
}
