import { addDays } from '@gms/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { recordAudit } from '../../lib/audit';
import { gymLocalToInstant, isoWeekday } from '../../lib/dates';
import type { RequestContext } from '../../lib/request-context';
import { randomToken } from '../../lib/tokens';
import type { DbExecutor } from '../client';
import {
  appointments,
  classBookings,
  classSessions,
  fitnessClasses,
  members,
  staffProfiles,
  staffShifts,
  trainerAssignments,
  trainerAvailability,
  trainerProfiles,
  trainerTimeOff,
  users,
} from '../schema';

/** Marks the schedule demo as done (safe to run repeatedly). */
export const DEMO_TRAINER_EMAILS = [
  'nida.rashid@staff.example.test',
  'imran.sheikh@staff.example.test',
];

/**
 * Stage 6 demo: two fictional trainers with profiles, weekly availability, shifts and a day off;
 * three classes with two weeks of sessions; Ayesha (the Stage 4 ACTIVE member) booked into a
 * class, a past class she attended and a personal-training session; and trainer assignments.
 * The trainers cannot sign in: their password hash is not a valid argon2 hash, so every password
 * fails. An Admin can reset it on the Staff screen to try the trainer views.
 */
const TRAINERS = [
  {
    email: DEMO_TRAINER_EMAILS[0]!,
    firstName: 'Nida',
    lastName: 'Rashid',
    bio: 'Strength coach focused on safe technique for beginners and returning lifters.',
    specializations: ['Strength', 'Mobility'],
    certifications: ['Level 3 Personal Trainer (demo)'],
    // Mornings, Monday to Saturday.
    slots: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '07:00', end: '13:00' })),
    shift: ['06:30', '13:30'],
  },
  {
    email: DEMO_TRAINER_EMAILS[1]!,
    firstName: 'Imran',
    lastName: 'Sheikh',
    bio: 'Conditioning and indoor cycling. Builds programmes around busy work weeks.',
    specializations: ['HIIT', 'Spin'],
    certifications: ['Indoor Cycling Instructor (demo)'],
    // Evenings, Monday to Saturday.
    slots: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '16:00', end: '21:00' })),
    shift: ['15:30', '21:30'],
  },
] as const;

const CLASSES = [
  {
    name: 'Morning Strength Circuit',
    description: 'Full-body circuit with kettlebells and dumbbells. All levels.',
    duration: 60,
    capacity: 12,
    trainer: 0,
    room: 'Studio A',
    weekdays: [1, 3, 5],
    time: '07:30',
  },
  {
    name: 'Spin Express',
    description: 'A 45-minute interval ride. Bring water and a towel.',
    duration: 45,
    capacity: 10,
    trainer: 1,
    room: 'Spin Room',
    weekdays: [2, 4, 6],
    time: '18:00',
  },
  {
    name: 'Mobility and Stretch',
    description: 'Slow-paced mobility work for hips, shoulders and back.',
    duration: 50,
    capacity: 15,
    trainer: 0,
    room: 'Studio B',
    weekdays: [6],
    time: '10:00',
  },
] as const;

const SEED_REASON = 'Demo data seed';

function at(date: string, time: string, plusMinutes = 0): Date {
  return new Date(gymLocalToInstant(date, time).getTime() + plusMinutes * 60_000);
}

export async function seedScheduleDemo(tx: DbExecutor, ctx: RequestContext, today: string) {
  const [done] = await tx
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.email, DEMO_TRAINER_EMAILS))
    .limit(1);
  if (done) {
    console.warn('The demo trainers already exist; schedule demo skipped.');
    return;
  }
  const demoMembers = await tx
    .select({ id: members.id, email: members.email })
    .from(members)
    .where(
      and(
        eq(members.isDemo, true),
        inArray(members.email, [
          'ayesha.kamal@example.test',
          'zainab.rauf@example.test',
          'faraz.haider@example.test',
        ]),
      ),
    );
  const memberId = (email: string) => demoMembers.find((m) => m.email === email)?.id;
  const ayesha = memberId('ayesha.kamal@example.test');
  if (!ayesha) {
    console.warn('The Stage 4 access demo members are missing; schedule demo skipped.');
    return;
  }

  const trainerIds: string[] = [];
  for (const trainer of TRAINERS) {
    const [user] = await tx
      .insert(users)
      .values({
        email: trainer.email,
        // Not an argon2 hash: verifyPassword always fails, so this account has no usable login.
        passwordHash: `!demo-no-login-${randomToken(16)}`,
        role: 'TRAINER',
        firstName: trainer.firstName,
        lastName: trainer.lastName,
        isDemo: true,
      })
      .returning({ id: users.id });
    const id = user!.id;
    trainerIds.push(id);
    await tx.insert(staffProfiles).values({ userId: id, jobTitle: 'Trainer' });
    await recordAudit(tx, ctx, {
      action: 'STAFF_CREATED',
      entityType: 'USER',
      entityId: id,
      after: { email: trainer.email, role: 'TRAINER' },
      reason: SEED_REASON,
    });

    const profile = {
      bio: trainer.bio,
      specializations: [...trainer.specializations],
      certifications: [...trainer.certifications],
      isBookable: true,
    };
    await tx.insert(trainerProfiles).values({ userId: id, ...profile });
    await recordAudit(tx, ctx, {
      action: 'TRAINER_PROFILE_UPDATED',
      entityType: 'TRAINER',
      entityId: id,
      after: profile,
      reason: SEED_REASON,
    });

    await tx.insert(trainerAvailability).values(
      trainer.slots.map((slot) => ({
        trainerId: id,
        weekday: slot.weekday,
        startTime: slot.start,
        endTime: slot.end,
        effectiveFrom: today,
      })),
    );
    await recordAudit(tx, ctx, {
      action: 'TRAINER_AVAILABILITY_UPDATED',
      entityType: 'TRAINER',
      entityId: id,
      after: { effectiveFrom: today, slots: trainer.slots },
      reason: SEED_REASON,
    });

    // Shifts for the next working days of this week.
    for (let day = 1; day <= 7; day += 1) {
      const date = addDays(today, day);
      if (isoWeekday(date) === 7) continue;
      const [shift] = await tx
        .insert(staffShifts)
        .values({
          userId: id,
          startsAt: at(date, trainer.shift[0]),
          endsAt: at(date, trainer.shift[1]),
          roleNote: 'Gym floor and classes',
        })
        .returning({ id: staffShifts.id });
      await recordAudit(tx, ctx, {
        action: 'SHIFT_CREATED',
        entityType: 'STAFF_SHIFT',
        entityId: shift!.id,
        after: { userId: id, date },
        reason: SEED_REASON,
      });
    }
  }
  const [nida, imran] = trainerIds as [string, string];

  // Imran's next Sunday off (no classes run on Sundays).
  let sunday = addDays(today, 1);
  while (isoWeekday(sunday) !== 7) sunday = addDays(sunday, 1);
  const [off] = await tx
    .insert(trainerTimeOff)
    .values({
      trainerId: imran,
      startsAt: at(sunday, '00:00'),
      endsAt: at(addDays(sunday, 1), '00:00'),
      reason: 'Family event',
    })
    .returning({ id: trainerTimeOff.id });
  await recordAudit(tx, ctx, {
    action: 'TRAINER_TIME_OFF_ADDED',
    entityType: 'TRAINER_TIME_OFF',
    entityId: off!.id,
    after: { trainerId: imran, date: sunday },
    reason: SEED_REASON,
  });

  // Classes and two weeks of sessions.
  const firstSessions = new Map<string, string>();
  for (const cls of CLASSES) {
    const trainerId = trainerIds[cls.trainer]!;
    const [row] = await tx
      .insert(fitnessClasses)
      .values({
        name: cls.name,
        description: cls.description,
        defaultDurationMinutes: cls.duration,
        defaultCapacity: cls.capacity,
        defaultTrainerId: trainerId,
      })
      .returning({ id: fitnessClasses.id });
    const classId = row!.id;
    await recordAudit(tx, ctx, {
      action: 'CLASS_CREATED',
      entityType: 'FITNESS_CLASS',
      entityId: classId,
      after: { name: cls.name, capacity: cls.capacity, duration: cls.duration },
      reason: SEED_REASON,
    });
    const values = [];
    for (let day = 1; day <= 14; day += 1) {
      const date = addDays(today, day);
      if (!(cls.weekdays as readonly number[]).includes(isoWeekday(date))) continue;
      values.push({
        classId,
        trainerId,
        startsAt: at(date, cls.time),
        endsAt: at(date, cls.time, cls.duration),
        capacity: cls.capacity,
        room: cls.room,
      });
    }
    const sessions = await tx
      .insert(classSessions)
      .values(values)
      .returning({ id: classSessions.id });
    firstSessions.set(cls.name, sessions[0]!.id);
    await recordAudit(tx, ctx, {
      action: 'CLASS_SESSIONS_CREATED',
      entityType: 'FITNESS_CLASS',
      entityId: classId,
      after: { count: sessions.length, weekdays: cls.weekdays, time: cls.time },
      reason: SEED_REASON,
    });
  }

  // A strength class two days ago that Ayesha attended, so the roster shows attendance.
  const strength = CLASSES[0];
  const [strengthClass] = await tx
    .select({ id: fitnessClasses.id })
    .from(fitnessClasses)
    .where(eq(fitnessClasses.name, strength.name));
  const pastDate = addDays(today, -2);
  const [past] = await tx
    .insert(classSessions)
    .values({
      classId: strengthClass!.id,
      trainerId: nida,
      startsAt: at(pastDate, strength.time),
      endsAt: at(pastDate, strength.time, strength.duration),
      capacity: strength.capacity,
      room: strength.room,
    })
    .returning({ id: classSessions.id });

  const bookings = [
    { sessionId: past!.id, status: 'ATTENDED' as const },
    { sessionId: firstSessions.get('Spin Express')!, status: 'BOOKED' as const },
    { sessionId: firstSessions.get('Mobility and Stretch')!, status: 'BOOKED' as const },
  ];
  for (const booking of bookings) {
    const [row] = await tx
      .insert(classBookings)
      .values({ ...booking, memberId: ayesha })
      .returning({ id: classBookings.id });
    await recordAudit(tx, ctx, {
      action: 'CLASS_BOOKED',
      entityType: 'CLASS_BOOKING',
      entityId: row!.id,
      after: { ...booking, memberId: ayesha },
      reason: SEED_REASON,
    });
  }

  // Assignments: Ayesha trains with Nida; two newer members with Imran.
  const assignments = [
    { trainerId: nida, memberId: ayesha },
    { trainerId: imran, memberId: memberId('zainab.rauf@example.test') },
    { trainerId: imran, memberId: memberId('faraz.haider@example.test') },
  ];
  for (const assignment of assignments) {
    if (!assignment.memberId) continue;
    const [row] = await tx
      .insert(trainerAssignments)
      .values({ trainerId: assignment.trainerId, memberId: assignment.memberId, startDate: today })
      .returning({ id: trainerAssignments.id });
    await recordAudit(tx, ctx, {
      action: 'TRAINER_ASSIGNED',
      entityType: 'TRAINER_ASSIGNMENT',
      entityId: row!.id,
      after: { ...assignment, startDate: today },
      reason: SEED_REASON,
    });
  }

  // A personal-training session with Nida on the next weekday, after her morning class.
  let ptDate = addDays(today, 1);
  while (isoWeekday(ptDate) > 5) ptDate = addDays(ptDate, 1);
  const [appointment] = await tx
    .insert(appointments)
    .values({
      trainerId: nida,
      memberId: ayesha,
      startsAt: at(ptDate, '11:00'),
      endsAt: at(ptDate, '12:00'),
      notes: 'Form check on squats and deadlifts.',
    })
    .returning({ id: appointments.id });
  await recordAudit(tx, ctx, {
    action: 'APPOINTMENT_BOOKED',
    entityType: 'APPOINTMENT',
    entityId: appointment!.id,
    after: { trainerId: nida, memberId: ayesha, date: ptDate, time: '11:00' },
    reason: SEED_REASON,
  });
}
