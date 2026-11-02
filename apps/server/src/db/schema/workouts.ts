import {
  DIFFICULTY_LEVELS,
  MUSCLE_GROUPS,
  WORKOUT_ASSIGNMENT_STATUSES,
  WORKOUT_PLAN_STATUSES,
  type BodyMeasurements,
} from '@gms/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { citext, primaryId, timestamps, timestamptz } from './columns';
import { members } from './members';
import { users } from './users';

export const muscleGroupEnum = pgEnum('muscle_group', MUSCLE_GROUPS);
export const difficultyLevelEnum = pgEnum('difficulty_level', DIFFICULTY_LEVELS);
export const workoutPlanStatusEnum = pgEnum('workout_plan_status', WORKOUT_PLAN_STATUSES);
export const workoutAssignmentStatusEnum = pgEnum(
  'workout_assignment_status',
  WORKOUT_ASSIGNMENT_STATUSES,
);

/** Exercise library (PLAN §3.8). Archived with is_active = false, never deleted. */
export const exercises = pgTable(
  'exercises',
  {
    id: primaryId(),
    name: citext('name').notNull(),
    description: varchar('description', { length: 1000 }),
    muscleGroup: muscleGroupEnum('muscle_group').notNull(),
    difficulty: difficultyLevelEnum('difficulty').notNull(),
    instructions: varchar('instructions', { length: 2000 }),
    equipmentNeeded: varchar('equipment_needed', { length: 200 }),
    imageKey: varchar('image_key', { length: 120 }),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('exercises_name_key').on(t.name),
    index('exercises_name_trgm_idx').using('gin', sql`(${t.name}::text) gin_trgm_ops`),
    index('exercises_muscle_difficulty_idx').on(t.muscleGroup, t.difficulty),
    check('exercises_name_length', sql`char_length(${t.name}) between 1 and 80`),
  ],
);

/** A trainer's (or the gym's) plan. owner_trainer_id is null for plans owned by the gym. */
export const workoutPlans = pgTable(
  'workout_plans',
  {
    id: primaryId(),
    name: varchar('name', { length: 80 }).notNull(),
    description: varchar('description', { length: 1000 }),
    goal: varchar('goal', { length: 200 }),
    difficulty: difficultyLevelEnum('difficulty').notNull(),
    ownerTrainerId: uuid('owner_trainer_id').references(() => users.id, { onDelete: 'restrict' }),
    isTemplate: boolean('is_template').notNull().default(false),
    status: workoutPlanStatusEnum('status').notNull().default('ACTIVE'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (t) => [
    index('workout_plans_owner_idx').on(t.ownerTrainerId, t.status),
    index('workout_plans_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
  ],
);

export const workoutPlanItems = pgTable(
  'workout_plan_items',
  {
    id: primaryId(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => workoutPlans.id, { onDelete: 'restrict' }),
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'restrict' }),
    dayNumber: smallint('day_number').notNull(),
    position: smallint('position').notNull(),
    sets: smallint('sets').notNull(),
    reps: smallint('reps'),
    durationSeconds: smallint('duration_seconds'),
    restSeconds: smallint('rest_seconds').notNull().default(60),
    loadNote: varchar('load_note', { length: 60 }),
    notes: varchar('notes', { length: 500 }),
    /**
     * Set when an edit drops an item that already has workout logs: the row stays so those logs
     * keep their exercise. Removed items are hidden from the plan and cannot be logged again.
     */
    removedAt: timestamptz('removed_at'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('workout_plan_items_position_key')
      .on(t.planId, t.dayNumber, t.position)
      .where(sql`${t.removedAt} is null`),
    index('workout_plan_items_exercise_idx').on(t.exerciseId),
    check('workout_plan_items_day', sql`${t.dayNumber} between 1 and 7`),
    check('workout_plan_items_position', sql`${t.position} >= 1`),
    check('workout_plan_items_sets', sql`${t.sets} between 1 and 20`),
    check('workout_plan_items_reps', sql`${t.reps} is null or ${t.reps} between 1 and 100`),
    check(
      'workout_plan_items_duration',
      sql`${t.durationSeconds} is null or ${t.durationSeconds} between 1 and 7200`,
    ),
    check('workout_plan_items_rest', sql`${t.restSeconds} between 0 and 600`),
    check(
      'workout_plan_items_reps_or_duration',
      sql`${t.reps} is not null or ${t.durationSeconds} is not null`,
    ),
  ],
);

/**
 * A plan given to a member. When trainer_id is set, that trainer must be assigned to the member
 * (checked in the service). One open assignment per member and plan.
 */
export const workoutAssignments = pgTable(
  'workout_assignments',
  {
    id: primaryId(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => workoutPlans.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    trainerId: uuid('trainer_id').references(() => users.id, { onDelete: 'restrict' }),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    status: workoutAssignmentStatusEnum('status').notNull().default('ACTIVE'),
    trainerNotes: varchar('trainer_notes', { length: 500 }),
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('workout_assignments_open_key')
      .on(t.memberId, t.planId)
      .where(sql`${t.status} = 'ACTIVE'`),
    index('workout_assignments_member_idx').on(t.memberId, t.status),
    index('workout_assignments_plan_idx').on(t.planId),
    index('workout_assignments_trainer_idx').on(t.trainerId),
    check('workout_assignments_range', sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
  ],
);

/** Completion records. One row per plan item and day (re-logging updates it). */
export const workoutLogs = pgTable(
  'workout_logs',
  {
    id: primaryId(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => workoutAssignments.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    planItemId: uuid('plan_item_id').references(() => workoutPlanItems.id, {
      onDelete: 'restrict',
    }),
    performedOn: date('performed_on', { mode: 'string' }).notNull(),
    completed: boolean('completed').notNull(),
    actualSets: smallint('actual_sets'),
    actualReps: smallint('actual_reps'),
    actualLoad: varchar('actual_load', { length: 60 }),
    actualDurationSeconds: smallint('actual_duration_seconds'),
    notes: varchar('notes', { length: 500 }),
    loggedBy: uuid('logged_by').references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (t) => [
    index('workout_logs_member_performed_idx').on(t.memberId, t.performedOn.desc()),
    index('workout_logs_assignment_idx').on(t.assignmentId, t.performedOn),
    uniqueIndex('workout_logs_item_day_key')
      .on(t.assignmentId, t.planItemId, t.performedOn)
      .where(sql`${t.planItemId} is not null`),
    check(
      'workout_logs_actuals',
      sql`coalesce(${t.actualSets}, 0) between 0 and 20 and coalesce(${t.actualReps}, 0) between 0 and 100
        and coalesce(${t.actualDurationSeconds}, 0) between 0 and 7200`,
    ),
  ],
);

export const progressEntries = pgTable(
  'progress_entries',
  {
    id: primaryId(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    recordedOn: date('recorded_on', { mode: 'string' }).notNull(),
    weightKg: numeric('weight_kg', { precision: 4, scale: 1, mode: 'number' }),
    bodyFatPct: numeric('body_fat_pct', { precision: 3, scale: 1, mode: 'number' }),
    /** Centimetres; keys are validated by the API (BODY_MEASUREMENTS) and checked below. */
    measurements: jsonb('measurements').$type<BodyMeasurements>().notNull().default({}),
    notes: varchar('notes', { length: 500 }),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('progress_entries_member_recorded_idx').on(t.memberId, t.recordedOn.desc()),
    check(
      'progress_entries_weight',
      sql`${t.weightKg} is null or ${t.weightKg} between 20 and 400`,
    ),
    check(
      'progress_entries_body_fat',
      sql`${t.bodyFatPct} is null or ${t.bodyFatPct} between 2 and 70`,
    ),
    check(
      'progress_entries_measurement_keys',
      sql`jsonb_typeof(${t.measurements}) = 'object'
        and ${t.measurements} - array['chest', 'waist', 'hips', 'arm', 'thigh'] = '{}'::jsonb`,
    ),
  ],
);
