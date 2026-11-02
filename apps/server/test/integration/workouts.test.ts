import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import { auditLogs, workoutPlanItems } from '../../src/db/schema';
import { signIn, testApp, type Session } from '../setup/auth';
import { resetTables } from '../setup/db';
import { createMember, createUser, type TestUser } from '../setup/factories';
import { api, eligibleMember, gymDate, portalMember } from '../setup/scheduling';

const app = testApp();

let admin: Session;
let reception: Session;
let trainer: TestUser;
let trainerSession: Session;
let otherTrainer: TestUser;
let otherTrainerSession: Session;
let squat: string;
let row: string;
let plank: string;

const newExercise = async (name: string, muscleGroup: string) => {
  const res = await api(admin).post('/exercises', {
    name,
    muscleGroup,
    difficulty: 'BEGINNER',
    instructions: `How to do ${name.toLowerCase()} well.`,
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
};

beforeEach(async () => {
  await resetTables();
  admin = await signIn(app, await createUser({ role: 'ADMIN' }));
  reception = await signIn(app, await createUser({ role: 'RECEPTIONIST' }));
  trainer = await createUser({ role: 'TRAINER', firstName: 'Ayesha', lastName: 'Coach' });
  otherTrainer = await createUser({ role: 'TRAINER', firstName: 'Faisal', lastName: 'Coach' });
  trainerSession = await signIn(app, trainer);
  otherTrainerSession = await signIn(app, otherTrainer);
  squat = await newExercise('Goblet Squat', 'LEGS');
  row = await newExercise('Seated Cable Row', 'BACK');
  plank = await newExercise('Front Plank', 'CORE');
});
afterAll(closeDb);

const assignTrainer = (trainerId: string, memberId: string) =>
  api(admin).post('/trainer-assignments', { trainerId, memberId });

/** A plan with two days built by `session`. */
async function buildPlan(session: Session, name = 'Beginner Strength A') {
  const created = await api(session).post('/workout-plans', {
    name,
    goal: 'General strength',
    difficulty: 'BEGINNER',
  });
  expect(created.status).toBe(201);
  const items = await api(session).put(`/workout-plans/${created.body.id}/items`, {
    items: [
      { exerciseId: squat, dayNumber: 1, sets: 3, reps: 10, restSeconds: 90 },
      { exerciseId: row, dayNumber: 1, sets: 3, reps: 12 },
      { exerciseId: plank, dayNumber: 2, sets: 3, durationSeconds: 45, restSeconds: 30 },
    ],
  });
  expect(items.status).toBe(200);
  return items.body as {
    id: string;
    items: { id: string; dayNumber: number; position: number; exercise: { id: string } }[];
  };
}

describe('exercise library', () => {
  it('creates, filters, refuses duplicates and archives', async () => {
    const list = await api(trainerSession).get('/exercises?muscleGroup=LEGS');
    expect(list.status).toBe(200);
    expect(list.body.data.map((e: { name: string }) => e.name)).toEqual(['Goblet Squat']);

    const duplicate = await api(admin).post('/exercises', {
      name: 'goblet squat',
      muscleGroup: 'LEGS',
      difficulty: 'BEGINNER',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_EXERCISE_NAME');

    const receptionWrite = await api(reception).post('/exercises', {
      name: 'Lunge',
      muscleGroup: 'LEGS',
      difficulty: 'BEGINNER',
    });
    expect(receptionWrite.status).toBe(403);

    const archived = await api(admin).post(`/exercises/${plank}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body.isActive).toBe(false);
  });

  it('accepts an image and serves it back', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    );
    const upload = await admin.agent
      .post(`/api/v1/exercises/${squat}/image`)
      .set('X-CSRF-Token', admin.csrf)
      .attach('image', png, { filename: 'squat.png', contentType: 'image/png' });
    expect(upload.status).toBe(200);
    expect(upload.body.imageUrl).toEqual(expect.stringContaining(`/exercises/${squat}/image`));
    const image = await trainerSession.agent.get(`/api/v1/exercises/${squat}/image`);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toMatch(/^image\//);
  });
});

describe('plan builder', () => {
  it('orders items by day and position and counts days', async () => {
    const plan = await buildPlan(trainerSession);
    expect(plan.items.map((i) => [i.dayNumber, i.position, i.exercise.id])).toEqual([
      [1, 1, squat],
      [1, 2, row],
      [2, 1, plank],
    ]);
    const read = await api(trainerSession).get(`/workout-plans/${plan.id}`);
    expect(read.body).toMatchObject({
      itemCount: 3,
      dayCount: 2,
      owner: { id: trainer.id },
      status: 'ACTIVE',
    });
  });

  it('requires reps or a duration on every item', async () => {
    const plan = await buildPlan(trainerSession);
    const res = await api(trainerSession).put(`/workout-plans/${plan.id}/items`, {
      items: [{ exerciseId: squat, dayNumber: 1, sets: 3 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'items.0.reps' })]),
    );
  });

  it('a trainer edits only their own plans and cannot create one for someone else', async () => {
    const plan = await buildPlan(trainerSession);
    const edit = await api(otherTrainerSession).patch(`/workout-plans/${plan.id}`, {
      name: 'Hijacked',
    });
    expect(edit.status).toBe(403);
    const forOther = await api(trainerSession).post('/workout-plans', {
      name: 'For Faisal',
      difficulty: 'BEGINNER',
      ownerTrainerId: otherTrainer.id,
    });
    expect(forOther.status).toBe(403);
  });

  it('trainers see their own plans and plans given to their members; admins see all', async () => {
    const mine = await buildPlan(trainerSession, 'Ayesha Plan');
    const gym = await buildPlan(admin, 'Gym Template');
    await buildPlan(otherTrainerSession, 'Faisal Plan');

    const names = async (session: Session) =>
      (await api(session).get('/workout-plans')).body.data.map((p: { name: string }) => p.name);
    expect(await names(trainerSession)).toEqual(['Ayesha Plan']);
    expect(await names(admin)).toEqual(['Ayesha Plan', 'Faisal Plan', 'Gym Template']);
    expect((await api(trainerSession).get(`/workout-plans/${gym.id}`)).status).toBe(403);

    // Once the admin gives the gym plan to one of Ayesha's members, she can read it.
    const member = await eligibleMember();
    await assignTrainer(trainer.id, member.id);
    const given = await api(admin).post('/workout-assignments', {
      planId: gym.id,
      memberId: member.id,
      trainerId: trainer.id,
    });
    expect(given.status).toBe(201);
    expect(await names(trainerSession)).toEqual(['Ayesha Plan', 'Gym Template']);
    expect((await api(trainerSession).get(`/workout-plans/${gym.id}`)).status).toBe(200);
    expect((await api(trainerSession).get(`/workout-plans/${mine.id}`)).status).toBe(200);
  });

  it('duplicates a plan as a non-template copy owned by the trainer', async () => {
    const source = await buildPlan(trainerSession);
    const copy = await api(trainerSession).post(`/workout-plans/${source.id}/duplicate`, {});
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({
      name: 'Beginner Strength A (copy)',
      isTemplate: false,
      owner: { id: trainer.id },
      itemCount: 3,
    });
    expect(copy.body.items.map((i: { exercise: { id: string } }) => i.exercise.id)).toEqual([
      squat,
      row,
      plank,
    ]);
  });

  it('keeps logged items as history when an edit drops them, and deletes unlogged ones', async () => {
    const plan = await buildPlan(trainerSession);
    const member = await eligibleMember();
    await assignTrainer(trainer.id, member.id);
    const assignment = await api(trainerSession).post('/workout-assignments', {
      planId: plan.id,
      memberId: member.id,
    });
    const [squatItem, rowItem] = plan.items;
    const logged = await api(trainerSession).post('/workout-logs', {
      assignmentId: assignment.body.id,
      entries: [{ planItemId: squatItem!.id, completed: true, actualSets: 3, actualReps: 10 }],
    });
    expect(logged.status).toBe(201);

    // Keep only the row (reused, same id) and add a new plank on day 1.
    const edit = await api(trainerSession).put(`/workout-plans/${plan.id}/items`, {
      items: [
        { exerciseId: row, dayNumber: 1, sets: 4, reps: 8 },
        { exerciseId: plank, dayNumber: 1, sets: 2, durationSeconds: 60 },
      ],
    });
    expect(edit.status).toBe(200);
    expect(edit.body.items.map((i: { id: string; sets: number }) => [i.id, i.sets])).toEqual([
      [rowItem!.id, 4],
      [expect.any(String), 2],
    ]);
    expect(edit.body).toMatchObject({ itemCount: 2, dayCount: 1 });

    const stored = await db
      .select({ id: workoutPlanItems.id, removedAt: workoutPlanItems.removedAt })
      .from(workoutPlanItems)
      .where(eq(workoutPlanItems.planId, plan.id));
    expect(stored).toHaveLength(3);
    expect(stored.find((i) => i.id === squatItem!.id)?.removedAt).toBeInstanceOf(Date);

    // The log still names the exercise; the dropped item can no longer be logged.
    const logs = await api(trainerSession).get(`/workout-logs?assignmentId=${assignment.body.id}`);
    expect(logs.body.data[0]).toMatchObject({ exerciseName: 'Goblet Squat' });
    const again = await api(trainerSession).post('/workout-logs', {
      assignmentId: assignment.body.id,
      entries: [{ planItemId: squatItem!.id, completed: true }],
    });
    expect(again.status).toBe(400);
  });

  it('archives a plan; it can no longer be assigned', async () => {
    const plan = await buildPlan(trainerSession);
    const archived = await api(trainerSession).post(`/workout-plans/${plan.id}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body.status).toBe('ARCHIVED');
    const member = await eligibleMember();
    await assignTrainer(trainer.id, member.id);
    const res = await api(trainerSession).post('/workout-assignments', {
      planId: plan.id,
      memberId: member.id,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('WORKOUT_PLAN_ARCHIVED');
  });
});

describe('assigning plans (trainer scope)', () => {
  it('a trainer can assign plans only to members assigned to them', async () => {
    const plan = await buildPlan(trainerSession);
    const theirs = await eligibleMember({ firstName: 'Assigned' });
    const notTheirs = await eligibleMember({ firstName: 'Unassigned' });
    await assignTrainer(trainer.id, theirs.id);
    await assignTrainer(otherTrainer.id, notTheirs.id);

    const refused = await api(trainerSession).post('/workout-assignments', {
      planId: plan.id,
      memberId: notTheirs.id,
    });
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toBe('This member is not assigned to you.');

    const asSomeoneElse = await api(trainerSession).post('/workout-assignments', {
      planId: plan.id,
      memberId: theirs.id,
      trainerId: otherTrainer.id,
    });
    expect(asSomeoneElse.status).toBe(403);

    const ok = await api(trainerSession).post('/workout-assignments', {
      planId: plan.id,
      memberId: theirs.id,
      trainerNotes: 'Focus on depth before adding load.',
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({
      status: 'ACTIVE',
      startDate: gymDate(0),
      trainer: { id: trainer.id },
      member: { id: theirs.id },
      trainerNotes: 'Focus on depth before adding load.',
      daysLogged: 0,
    });

    const twice = await api(trainerSession).post('/workout-assignments', {
      planId: plan.id,
      memberId: theirs.id,
    });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('ASSIGNMENT_EXISTS');

    const audit = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'WORKOUT_ASSIGNED'), eq(auditLogs.entityId, ok.body.id)));
    expect(audit).toHaveLength(1);
  });

  it('a trainer loses access when the member is unassigned', async () => {
    const plan = await buildPlan(trainerSession);
    const member = await eligibleMember();
    const link = await assignTrainer(trainer.id, member.id);
    const assignment = await api(trainerSession).post('/workout-assignments', {
      planId: plan.id,
      memberId: member.id,
    });
    expect(
      (await api(trainerSession).get(`/workout-assignments/${assignment.body.id}`)).status,
    ).toBe(200);
    await api(admin).post(`/trainer-assignments/${link.body.id}/end`, {
      reason: 'Moved to the evening coach',
    });
    expect(
      (await api(trainerSession).get(`/workout-assignments/${assignment.body.id}`)).status,
    ).toBe(403);
    const list = await api(trainerSession).get('/workout-assignments');
    expect(list.body.data).toEqual([]);
  });

  it('an admin may name a trainer only if that trainer is assigned to the member', async () => {
    const plan = await buildPlan(admin, 'Gym Plan');
    const member = await eligibleMember();
    const res = await api(admin).post('/workout-assignments', {
      planId: plan.id,
      memberId: member.id,
      trainerId: trainer.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'trainerId' })]);

    const withoutTrainer = await api(admin).post('/workout-assignments', {
      planId: plan.id,
      memberId: member.id,
    });
    expect(withoutTrainer.status).toBe(201);
    expect(withoutTrainer.body.trainer).toBeNull();
  });

  it('refuses empty plans, archived members and past end dates', async () => {
    const empty = await api(admin).post('/workout-plans', {
      name: 'Empty',
      difficulty: 'BEGINNER',
    });
    const member = await eligibleMember();
    const res = await api(admin).post('/workout-assignments', {
      planId: empty.body.id,
      memberId: member.id,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('WORKOUT_PLAN_EMPTY');

    const plan = await buildPlan(admin, 'Full');
    const archived = await createMember({ archivedAt: new Date(), archivedBy: admin.me.user.id });
    const archivedRes = await api(admin).post('/workout-assignments', {
      planId: plan.id,
      memberId: archived.id,
    });
    expect(archivedRes.status).toBe(409);
    expect(archivedRes.body.error.code).toBe('MEMBER_ARCHIVED');

    const past = await api(admin).post('/workout-assignments', {
      planId: plan.id,
      memberId: member.id,
      startDate: gymDate(-10),
      endDate: gymDate(-1),
    });
    expect(past.status).toBe(400);
  });

  it('updates notes and closes; a closed assignment cannot change or take logs', async () => {
    const plan = await buildPlan(trainerSession);
    const member = await eligibleMember();
    await assignTrainer(trainer.id, member.id);
    const created = await api(trainerSession).post('/workout-assignments', {
      planId: plan.id,
      memberId: member.id,
      trainerNotes: 'Week 1',
    });
    const notes = await api(trainerSession).patch(`/workout-assignments/${created.body.id}`, {
      trainerNotes: 'Week 2: add 2.5 kg',
    });
    expect(notes.status).toBe(200);
    expect(notes.body).toMatchObject({ trainerNotes: 'Week 2: add 2.5 kg', endDate: null });

    const closed = await api(trainerSession).patch(`/workout-assignments/${created.body.id}`, {
      status: 'COMPLETED',
    });
    expect(closed.body.status).toBe('COMPLETED');
    expect(closed.body.trainerNotes).toBe('Week 2: add 2.5 kg');

    const again = await api(trainerSession).patch(`/workout-assignments/${created.body.id}`, {
      trainerNotes: 'Too late',
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ASSIGNMENT_CLOSED');

    const log = await api(trainerSession).post('/workout-logs', {
      assignmentId: created.body.id,
      entries: [{ planItemId: plan.items[0]!.id, completed: true }],
    });
    expect(log.status).toBe(409);

    // A new assignment of the same plan is allowed once the earlier one is closed.
    const renewed = await api(trainerSession).post('/workout-assignments', {
      planId: plan.id,
      memberId: member.id,
    });
    expect(renewed.status).toBe(201);
  });
});

describe('completion logs', () => {
  it('records a day, updates on re-log and counts days logged', async () => {
    const plan = await buildPlan(trainerSession);
    const member = await eligibleMember();
    await assignTrainer(trainer.id, member.id);
    const assignment = await api(trainerSession).post('/workout-assignments', {
      planId: plan.id,
      memberId: member.id,
      startDate: gymDate(-3),
    });
    const [squatItem, rowItem] = plan.items;
    const first = await api(trainerSession).post('/workout-logs', {
      assignmentId: assignment.body.id,
      performedOn: gymDate(-2),
      entries: [
        {
          planItemId: squatItem!.id,
          completed: true,
          actualSets: 3,
          actualReps: 10,
          actualLoad: '16 kg',
        },
        { planItemId: rowItem!.id, completed: false, notes: 'Shoulder felt tight' },
        { completed: true, notes: '10 minutes on the bike' },
      ],
    });
    expect(first.status).toBe(201);
    expect(first.body).toHaveLength(3);

    const relog = await api(trainerSession).post('/workout-logs', {
      assignmentId: assignment.body.id,
      performedOn: gymDate(-2),
      entries: [{ planItemId: rowItem!.id, completed: true, actualSets: 3, actualReps: 12 }],
    });
    expect(relog.status).toBe(201);
    await api(trainerSession).post('/workout-logs', {
      assignmentId: assignment.body.id,
      entries: [{ planItemId: squatItem!.id, completed: true }],
    });

    const logs = await api(trainerSession).get(`/workout-logs?memberId=${member.id}`);
    expect(logs.body.total).toBe(4);
    const rowLog = logs.body.data.find((l: { planItemId: string }) => l.planItemId === rowItem!.id);
    expect(rowLog).toMatchObject({ completed: true, actualReps: 12, loggedByName: 'Ayesha Coach' });

    const read = await api(trainerSession).get(`/workout-assignments/${assignment.body.id}`);
    expect(read.body).toMatchObject({ daysLogged: 2, lastLoggedOn: gymDate(0) });
  });

  it('refuses future dates, dates before the start, repeats and items of other plans', async () => {
    const plan = await buildPlan(trainerSession);
    const other = await buildPlan(trainerSession, 'Other');
    const member = await eligibleMember();
    await assignTrainer(trainer.id, member.id);
    const assignment = await api(trainerSession).post('/workout-assignments', {
      planId: plan.id,
      memberId: member.id,
    });
    const item = plan.items[0]!.id;
    const post = (body: object) =>
      api(trainerSession).post('/workout-logs', { assignmentId: assignment.body.id, ...body });

    expect(
      (await post({ performedOn: gymDate(1), entries: [{ planItemId: item, completed: true }] }))
        .status,
    ).toBe(400);
    expect(
      (await post({ performedOn: gymDate(-1), entries: [{ planItemId: item, completed: true }] }))
        .status,
    ).toBe(400);
    const repeated = await post({
      entries: [
        { planItemId: item, completed: true },
        { planItemId: item, completed: false },
      ],
    });
    expect(repeated.status).toBe(400);
    expect(repeated.body.error.details[0].path).toBe('entries.1.planItemId');
    const foreign = await post({ entries: [{ planItemId: other.items[0]!.id, completed: true }] });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.details[0].path).toBe('entries.0.planItemId');
  });

  it('another trainer cannot log or read logs for a member who is not theirs', async () => {
    const plan = await buildPlan(trainerSession);
    const member = await eligibleMember();
    await assignTrainer(trainer.id, member.id);
    const assignment = await api(trainerSession).post('/workout-assignments', {
      planId: plan.id,
      memberId: member.id,
    });
    await api(trainerSession).post('/workout-logs', {
      assignmentId: assignment.body.id,
      entries: [{ planItemId: plan.items[0]!.id, completed: true }],
    });
    const write = await api(otherTrainerSession).post('/workout-logs', {
      assignmentId: assignment.body.id,
      entries: [{ planItemId: plan.items[0]!.id, completed: true }],
    });
    expect(write.status).toBe(403);
    const read = await api(otherTrainerSession).get(`/workout-logs?memberId=${member.id}`);
    expect(read.body.data).toEqual([]);
  });
});

describe('progress history', () => {
  it('records measurements and returns them oldest first', async () => {
    const member = await eligibleMember();
    await assignTrainer(trainer.id, member.id);
    const first = await api(trainerSession).post(`/members/${member.id}/progress`, {
      recordedOn: gymDate(-30),
      weightKg: 82.44,
      bodyFatPct: 24,
      measurements: { waist: 92, chest: null },
    });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      weightKg: 82.4,
      bodyFatPct: 24,
      measurements: { waist: 92 },
      recordedByName: 'Ayesha Coach',
    });
    await api(trainerSession).post(`/members/${member.id}/progress`, { weightKg: 80.1 });

    const history = await api(trainerSession).get(`/members/${member.id}/progress`);
    expect(history.status).toBe(200);
    expect(history.body.map((p: { weightKg: number }) => p.weightKg)).toEqual([82.4, 80.1]);

    const empty = await api(trainerSession).post(`/members/${member.id}/progress`, {
      measurements: {},
    });
    expect(empty.status).toBe(400);
    const future = await api(trainerSession).post(`/members/${member.id}/progress`, {
      recordedOn: gymDate(1),
      weightKg: 80,
    });
    expect(future.status).toBe(400);
  });

  it('is limited to assigned members for trainers', async () => {
    const member = await eligibleMember();
    await assignTrainer(otherTrainer.id, member.id);
    expect((await api(trainerSession).get(`/members/${member.id}/progress`)).status).toBe(403);
    expect(
      (await api(trainerSession).post(`/members/${member.id}/progress`, { weightKg: 70 })).status,
    ).toBe(403);
    expect((await api(reception).get(`/members/${member.id}/progress`)).status).toBe(403);
  });
});

describe('member portal: workouts and progress', () => {
  it('shows the assigned plans, logs own workouts and records own progress', async () => {
    const plan = await buildPlan(trainerSession);
    const { member, session } = await portalMember(app, 'Sana');
    await assignTrainer(trainer.id, member.id);
    const assignment = await api(trainerSession).post('/workout-assignments', {
      planId: plan.id,
      memberId: member.id,
      trainerNotes: 'Three sessions a week.',
    });

    const mine = await api(session).get('/me/workouts');
    expect(mine.status).toBe(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({
      assignmentId: assignment.body.id,
      trainerNotes: 'Three sessions a week.',
      trainer: { id: trainer.id },
      plan: { id: plan.id, dayCount: 2 },
    });
    expect(mine.body[0].plan.items).toHaveLength(3);
    expect(mine.body[0].plan).not.toHaveProperty('owner');

    const logged = await api(session).post('/me/workout-logs', {
      assignmentId: assignment.body.id,
      entries: [{ planItemId: plan.items[0]!.id, completed: true, actualReps: 10 }],
    });
    expect(logged.status).toBe(201);
    const logs = await api(session).get('/me/workout-logs');
    expect(logs.body.data).toHaveLength(1);
    expect(logs.body.data[0]).toMatchObject({ loggedByName: 'Sana Portal' });

    const progress = await api(session).post('/me/progress', { weightKg: 61.5 });
    expect(progress.status).toBe(201);
    const history = await api(session).get('/me/progress');
    expect(history.body.map((p: { weightKg: number }) => p.weightKg)).toEqual([61.5]);
    // The trainer sees what the member recorded.
    const seen = await api(trainerSession).get(`/members/${member.id}/progress`);
    expect(seen.body).toHaveLength(1);
  });

  it('a member cannot log against someone else’s plan or see other exercise images', async () => {
    const plan = await buildPlan(admin, 'Gym Plan');
    const other = await eligibleMember();
    const assignment = await api(admin).post('/workout-assignments', {
      planId: plan.id,
      memberId: other.id,
    });
    const { session } = await portalMember(app, 'Hina');
    const res = await api(session).post('/me/workout-logs', {
      assignmentId: assignment.body.id,
      entries: [{ planItemId: plan.items[0]!.id, completed: true }],
    });
    expect(res.status).toBe(404);
    expect((await api(session).get(`/me/exercises/${squat}/image`)).status).toBe(404);
    expect((await api(session).get('/me/workouts')).body).toEqual([]);
    expect((await api(session).get('/workout-plans')).status).toBe(403);
  });
});
