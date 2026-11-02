import type { WorkoutLogDto, WorkoutPlanItemDto } from '@gms/shared';
import { describe, expect, it } from 'vitest';
import { maintenanceDue, optionalMoneyInput } from '../src/features/equipment/equipment-format';
import { countLabel, notificationLink } from '../src/features/notifications/notification-format';
import {
  errorsFromPaths,
  orderDrafts,
  splitPath,
  toDraft,
  toPayload,
} from '../src/features/workouts/plan-draft';
import {
  formatPrescription,
  formatSeconds,
  groupByDay,
  groupSessions,
} from '../src/features/workouts/workout-format';

const SQUAT = {
  id: '3b2f1c0e-8d7a-4e6b-9c5d-4f3e2d1c0b9a',
  name: 'Back squat',
  muscleGroup: 'LEGS',
  difficulty: 'INTERMEDIATE',
  instructions: null,
  imageUrl: null,
  isActive: true,
} as const satisfies WorkoutPlanItemDto['exercise'];

const PLANK = {
  ...SQUAT,
  id: '6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d',
  name: 'Plank',
  muscleGroup: 'CORE',
} as const;

function item(overrides: Partial<WorkoutPlanItemDto>): WorkoutPlanItemDto {
  return {
    id: 'item-1',
    dayNumber: 1,
    position: 0,
    exercise: SQUAT,
    sets: 4,
    reps: 8,
    durationSeconds: null,
    restSeconds: 90,
    loadNote: '70% of max',
    notes: null,
    ...overrides,
  };
}

function log(overrides: Partial<WorkoutLogDto>): WorkoutLogDto {
  return {
    id: 'log-1',
    assignmentId: 'assignment-a',
    memberId: 'member-1',
    planItemId: 'item-1',
    exerciseName: 'Back squat',
    performedOn: '2026-10-20',
    completed: true,
    actualSets: 4,
    actualReps: 8,
    actualLoad: null,
    actualDurationSeconds: null,
    notes: null,
    loggedByName: 'Hira Qureshi',
    createdAt: '2026-10-20T12:00:00.000Z',
    ...overrides,
  };
}

describe('workout formatting', () => {
  it('writes durations the way a trainer says them', () => {
    expect(formatSeconds(45)).toBe('45 s');
    expect(formatSeconds(60)).toBe('1 min');
    expect(formatSeconds(90)).toBe('1 min 30 s');
  });

  it('shows reps, a time, or both', () => {
    expect(formatPrescription({ sets: 3, reps: 12, durationSeconds: null })).toBe('3 × 12');
    expect(formatPrescription({ sets: 3, reps: null, durationSeconds: 45 })).toBe('3 × 45 s');
    expect(formatPrescription({ sets: 2, reps: 10, durationSeconds: 30 })).toBe('2 × 10 / 30 s');
  });

  it('groups items by day in plan order', () => {
    const grouped = groupByDay([
      item({ id: 'c', dayNumber: 2, position: 0 }),
      item({ id: 'b', dayNumber: 1, position: 1 }),
      item({ id: 'a', dayNumber: 1, position: 0 }),
    ]);
    expect(grouped.map((day) => [day.day, day.items.map((i) => i.id)])).toEqual([
      [1, ['a', 'b']],
      [2, ['c']],
    ]);
  });

  it('groups logs into one session per date and assignment, newest first', () => {
    const sessions = groupSessions([
      log({ id: '1', performedOn: '2026-10-18' }),
      log({ id: '2', performedOn: '2026-10-20' }),
      log({ id: '3', performedOn: '2026-10-20' }),
      log({ id: '4', performedOn: '2026-10-20', assignmentId: 'assignment-b' }),
    ]);
    expect(sessions.map((s) => [s.performedOn, s.entries.map((e) => e.id)])).toEqual([
      ['2026-10-20', ['2', '3']],
      ['2026-10-20', ['4']],
      ['2026-10-18', ['1']],
    ]);
  });
});

describe('plan builder drafts', () => {
  it('saves items by day, keeping their order within the day', () => {
    const drafts = [
      toDraft(item({ id: 'd2', dayNumber: 2, exercise: PLANK, reps: null, durationSeconds: 60 })),
      toDraft(item({ id: 'd1a', dayNumber: 1 })),
      toDraft(item({ id: 'd1b', dayNumber: 1, exercise: PLANK })),
    ];
    expect(orderDrafts(drafts).map((d) => d.key)).toEqual(['d1a', 'd1b', 'd2']);
    expect(toPayload(drafts)).toEqual([
      {
        exerciseId: SQUAT.id,
        dayNumber: 1,
        sets: '4',
        reps: '8',
        durationSeconds: null,
        restSeconds: '90',
        loadNote: '70% of max',
        notes: '',
      },
      expect.objectContaining({ exerciseId: PLANK.id, dayNumber: 1 }),
      expect.objectContaining({
        exerciseId: PLANK.id,
        dayNumber: 2,
        reps: null,
        durationSeconds: '60',
      }),
    ]);
  });

  it('treats a cleared rest box as no rest rather than an error', () => {
    const draft = { ...toDraft(item({})), restSeconds: '  ' };
    expect(toPayload([draft])[0]!.restSeconds).toBe('0');
  });

  it('puts server errors on the row and field they belong to', () => {
    const ordered = orderDrafts([
      toDraft(item({ id: 'first', dayNumber: 1 })),
      toDraft(item({ id: 'second', dayNumber: 2 })),
    ]);
    const { errors, general } = errorsFromPaths(ordered, [
      { path: splitPath('items.1.reps'), message: 'Enter reps or a duration' },
      { path: ['items', 0, 'exerciseId'], message: 'This exercise is archived' },
      { path: ['items'], message: 'A plan can have at most 60 exercises' },
    ]);
    expect(errors).toEqual({
      second: { reps: 'Enter reps or a duration' },
      first: { exercise: 'This exercise is archived' },
    });
    expect(general).toBe('A plan can have at most 60 exercises');
  });
});

describe('equipment maintenance', () => {
  it('ranks how soon service is due', () => {
    const due = (daysUntilMaintenance: number | null, status = 'IN_SERVICE' as const) =>
      maintenanceDue({ daysUntilMaintenance, status });
    expect(due(-3)).toEqual({ label: 'Overdue by 3 days', tone: 'danger', urgent: true });
    expect(due(-1)?.label).toBe('Overdue by 1 day');
    expect(due(0)).toEqual({ label: 'Due today', tone: 'warning', urgent: true });
    expect(due(7)).toEqual({ label: 'Due in 7 days', tone: 'warning', urgent: true });
    expect(due(8)).toEqual({ label: 'In 8 days', tone: 'neutral', urgent: false });
    expect(due(null)).toBeNull();
  });

  it('never nags about a retired item', () => {
    expect(maintenanceDue({ daysUntilMaintenance: -30, status: 'RETIRED' })).toBeNull();
  });

  it('reads optional costs in major units', () => {
    expect(optionalMoneyInput.parse('')).toBeNull();
    expect(optionalMoneyInput.parse('  ')).toBeNull();
    expect(optionalMoneyInput.parse('0')).toBe(0);
    expect(optionalMoneyInput.parse('45,000.50')).toBe(4_500_050);
    expect(optionalMoneyInput.safeParse('45.505').success).toBe(false);
    expect(optionalMoneyInput.safeParse('-10').success).toBe(false);
  });
});

describe('notification links', () => {
  const ID = '0f1e2d3c-4b5a-4968-8776-655443322110';

  it('sends members to their portal pages', () => {
    expect(notificationLink({ entityType: 'MEMBERSHIP', entityId: ID }, true)).toBe(
      '/portal/membership',
    );
    expect(notificationLink({ entityType: 'INVOICE', entityId: ID }, true)).toBe(
      '/portal/payments',
    );
    expect(notificationLink({ entityType: 'CLASS_SESSION', entityId: ID }, true)).toBe(
      '/portal/schedule',
    );
    // Members never see the equipment register.
    expect(notificationLink({ entityType: 'EQUIPMENT', entityId: ID }, true)).toBeNull();
    expect(notificationLink({ entityType: 'MEMBER', entityId: ID }, true)).toBeNull();
  });

  it('sends staff to the screen that manages the thing', () => {
    expect(notificationLink({ entityType: 'CLASS_SESSION', entityId: ID }, false)).toBe(
      `/classes/sessions/${ID}`,
    );
    expect(notificationLink({ entityType: 'EQUIPMENT', entityId: ID }, false)).toBe(
      `/equipment/${ID}`,
    );
    expect(notificationLink({ entityType: 'APPOINTMENT', entityId: ID }, false)).toBe(
      '/appointments',
    );
    // A fingerprint retention review opens the member, where the enrollment is revoked.
    expect(notificationLink({ entityType: 'MEMBER', entityId: ID }, false)).toBe(`/members/${ID}`);
    expect(notificationLink({ entityType: null, entityId: null }, false)).toBeNull();
  });

  it('caps the badge count', () => {
    expect(countLabel(7)).toBe('7');
    expect(countLabel(140)).toBe('99+');
  });
});
