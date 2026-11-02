import {
  ERROR_CODES,
  permissionScope,
  SCOPES,
  type AppointmentDto,
  type AppointmentStatus,
  type MyAppointmentDto,
  type Paginated,
  type appointmentListQuerySchema,
  type createAppointmentSchema,
  type updateAppointmentSchema,
} from '@gms/shared';
import { and, asc, desc, eq, gt, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { db, type DbExecutor } from '../../db/client';
import { appointments, members, users } from '../../db/schema';
import { diffFields, recordAudit } from '../../lib/audit';
import { isExclusionViolation } from '../../lib/db-errors';
import { conflict, forbidden, notFound, validationFailed } from '../../lib/errors';
import { likePattern, pageOffset, paginated } from '../../lib/pagination';
import type { RequestContext } from '../../lib/request-context';
import { memberPhotoUrl } from '../members/members.service';
import {
  addMinutes,
  assertMemberEligible,
  assertMemberFree,
  assertTrainerFree,
  assertWithinAvailability,
  hasStarted,
  lockMemberSchedule,
  lockTrainerSchedule,
  minutesBetween,
  requireTrainer,
  type TimeWindow,
} from '../scheduling/scheduling';
import { assertAssigned } from '../trainers/trainer-scope';
import { gymDateWindow } from '../trainers/trainers.service';

type CreateAppointment = z.output<typeof createAppointmentSchema>;
type UpdateAppointment = z.output<typeof updateAppointmentSchema>;
type AppointmentListQuery = z.output<typeof appointmentListQuerySchema>;
type Auth = Express.AuthContext;
type AppointmentRow = typeof appointments.$inferSelect;

const appointmentTrainer = alias(users, 'appointment_trainer');
const appointmentCreator = alias(users, 'appointment_creator');

function selectAppointments(executor: DbExecutor = db) {
  return executor
    .select({
      appointment: appointments,
      trainerFirstName: appointmentTrainer.firstName,
      trainerLastName: appointmentTrainer.lastName,
      memberCode: members.memberCode,
      memberFirstName: members.firstName,
      memberLastName: members.lastName,
      memberPhotoKey: members.profilePhotoKey,
      creatorFirstName: appointmentCreator.firstName,
      creatorLastName: appointmentCreator.lastName,
    })
    .from(appointments)
    .innerJoin(appointmentTrainer, eq(appointmentTrainer.id, appointments.trainerId))
    .innerJoin(members, eq(members.id, appointments.memberId))
    .leftJoin(appointmentCreator, eq(appointmentCreator.id, appointments.createdBy));
}

type Row = Awaited<ReturnType<typeof selectAppointments>>[number];

function toDto(row: Row): AppointmentDto {
  const { appointment } = row;
  return {
    id: appointment.id,
    trainer: {
      id: appointment.trainerId,
      firstName: row.trainerFirstName,
      lastName: row.trainerLastName,
    },
    member: {
      id: appointment.memberId,
      memberCode: row.memberCode,
      firstName: row.memberFirstName,
      lastName: row.memberLastName,
      photoUrl: memberPhotoUrl(`/api/v1/members/${appointment.memberId}/photo`, row.memberPhotoKey),
    },
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    durationMinutes: minutesBetween(appointment.startsAt, appointment.endsAt),
    status: appointment.status,
    notes: appointment.notes,
    createdByName: row.creatorFirstName ? `${row.creatorFirstName} ${row.creatorLastName}` : null,
    createdAt: appointment.createdAt.toISOString(),
    updatedAt: appointment.updatedAt.toISOString(),
  };
}

export function toMyAppointment(dto: AppointmentDto): MyAppointmentDto {
  return {
    id: dto.id,
    trainer: dto.trainer,
    startsAt: dto.startsAt,
    endsAt: dto.endsAt,
    durationMinutes: dto.durationMinutes,
    status: dto.status,
  };
}

async function readAppointment(executor: DbExecutor, id: string): Promise<AppointmentDto> {
  const [row] = await selectAppointments(executor).where(eq(appointments.id, id)).limit(1);
  if (!row) throw notFound('Appointment');
  return toDto(row);
}

const isOwnScope = (auth: Auth, permission: 'appointments:read' | 'appointments:manage') =>
  permissionScope(auth.user.role, permission) === SCOPES.OWN;

/** A trainer works only with their own appointments. */
function assertTrainerOwns(
  auth: Auth,
  permission: 'appointments:read' | 'appointments:manage',
  trainerId: string,
) {
  if (isOwnScope(auth, permission) && trainerId !== auth.user.id) {
    throw forbidden('You can only see your own appointments.');
  }
}

// --- Reads --------------------------------------------------------------------------------

export async function listAppointments(
  query: AppointmentListQuery,
  auth: Auth,
): Promise<Paginated<AppointmentDto>> {
  const own = isOwnScope(auth, 'appointments:read');
  if (own && query.trainerId && query.trainerId !== auth.user.id) {
    throw forbidden('You can only see your own appointments.');
  }
  const conditions: (SQL | undefined)[] = [
    own ? eq(appointments.trainerId, auth.user.id) : undefined,
    query.trainerId ? eq(appointments.trainerId, query.trainerId) : undefined,
    query.memberId ? eq(appointments.memberId, query.memberId) : undefined,
    query.status ? eq(appointments.status, query.status) : undefined,
  ];
  if (query.from) {
    conditions.push(gt(appointments.endsAt, gymDateWindow(query.from, query.from).startsAt));
  }
  if (query.to) {
    const end = gymDateWindow(query.to, query.to).endsAt;
    conditions.push(sql`${appointments.startsAt} < ${end.toISOString()}::timestamptz`);
  }
  if (query.q) {
    const pattern = likePattern(query.q);
    conditions.push(
      or(
        sql`(${members.firstName} || ' ' || ${members.lastName}) ilike ${pattern}`,
        sql`${members.memberCode} ilike ${pattern}`,
      ),
    );
  }
  const where = and(...conditions);
  const [rows, [total]] = await Promise.all([
    selectAppointments()
      .where(where)
      .orderBy(
        query.order === 'desc' ? desc(appointments.startsAt) : asc(appointments.startsAt),
        asc(appointments.id),
      )
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(appointments)
      .innerJoin(members, eq(members.id, appointments.memberId))
      .where(where),
  ]);
  return paginated(rows.map(toDto), query.page, query.pageSize, total?.count ?? 0);
}

export async function getAppointment(id: string, auth: Auth): Promise<AppointmentDto> {
  const dto = await readAppointment(db, id);
  assertTrainerOwns(auth, 'appointments:read', dto.trainer.id);
  return dto;
}

// --- Writes -------------------------------------------------------------------------------

function appointmentWriteError(error: unknown): unknown {
  if (isExclusionViolation(error, 'appointments_trainer_no_overlap')) {
    return conflict(ERROR_CODES.SCHEDULE_CONFLICT, 'The trainer already has an appointment then.');
  }
  if (isExclusionViolation(error, 'appointments_member_no_overlap')) {
    return conflict(
      ERROR_CODES.MEMBER_SCHEDULE_CONFLICT,
      'The member already has an appointment then.',
    );
  }
  return error;
}

/** Every rule a booked time must pass (PLAN §3.9). Takes the trainer, then the member lock. */
async function assertBookable(
  tx: DbExecutor,
  trainerId: string,
  memberId: string,
  window: TimeWindow,
  excludeId?: string,
) {
  await lockTrainerSchedule(tx, trainerId);
  await lockMemberSchedule(tx, memberId);
  await assertMemberEligible(tx, memberId, window);
  await assertWithinAvailability(tx, trainerId, window);
  await assertTrainerFree(tx, trainerId, window, { appointmentId: excludeId });
  await assertMemberFree(tx, memberId, window, { appointmentId: excludeId });
}

/** Trainers book only for themselves and only their assigned members. */
async function assertTrainerMayManage(auth: Auth, trainerId: string, memberId: string) {
  if (!isOwnScope(auth, 'appointments:manage')) return;
  if (trainerId !== auth.user.id) {
    throw forbidden('You can only manage your own appointments.');
  }
  await assertAssigned(auth.user.id, memberId);
}

export async function createAppointment(
  input: CreateAppointment,
  auth: Auth,
  ctx: RequestContext,
): Promise<AppointmentDto> {
  await assertTrainerMayManage(auth, input.trainerId, input.memberId);
  const startsAt = new Date(input.startsAt);
  if (hasStarted(startsAt)) {
    throw validationFailed([{ path: 'startsAt', message: 'Must be in the future' }]);
  }
  const window = { startsAt, endsAt: addMinutes(startsAt, input.durationMinutes) };
  try {
    return await db.transaction(async (tx) => {
      await requireTrainer(tx, input.trainerId, { bookable: true });
      await assertBookable(tx, input.trainerId, input.memberId, window);
      const [row] = await tx
        .insert(appointments)
        .values({
          trainerId: input.trainerId,
          memberId: input.memberId,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          notes: input.notes,
          createdBy: ctx.actorUserId,
        })
        .returning({ id: appointments.id });
      await recordAudit(tx, ctx, {
        action: 'APPOINTMENT_BOOKED',
        entityType: 'APPOINTMENT',
        entityId: row!.id,
        after: {
          trainerId: input.trainerId,
          memberId: input.memberId,
          startsAt: window.startsAt.toISOString(),
          endsAt: window.endsAt.toISOString(),
        },
      });
      return readAppointment(tx, row!.id);
    });
  } catch (error) {
    throw appointmentWriteError(error);
  }
}

async function lockAppointment(tx: DbExecutor, id: string): Promise<AppointmentRow> {
  const [row] = await tx
    .select()
    .from(appointments)
    .where(eq(appointments.id, id))
    .for('update')
    .limit(1);
  if (!row) throw notFound('Appointment');
  return row;
}

function assertBooked(row: AppointmentRow) {
  if (row.status !== 'BOOKED') {
    throw conflict(
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      'Only a booked appointment can be changed.',
    );
  }
}

/** Reschedule (re-checked like a new booking) or edit the notes of a future appointment. */
export async function updateAppointment(
  id: string,
  input: UpdateAppointment,
  auth: Auth,
  ctx: RequestContext,
): Promise<AppointmentDto> {
  try {
    return await db.transaction(async (tx) => {
      const row = await lockAppointment(tx, id);
      await assertTrainerMayManage(auth, row.trainerId, row.memberId);
      assertBooked(row);
      if (hasStarted(row.startsAt)) {
        throw conflict(
          ERROR_CODES.INVALID_STATUS_TRANSITION,
          'This appointment has already started.',
        );
      }
      const startsAt = input.startsAt ? new Date(input.startsAt) : row.startsAt;
      if (input.startsAt && hasStarted(startsAt)) {
        throw validationFailed([{ path: 'startsAt', message: 'Must be in the future' }]);
      }
      const duration = input.durationMinutes ?? minutesBetween(row.startsAt, row.endsAt);
      const window = { startsAt, endsAt: addMinutes(startsAt, duration) };
      const moved =
        window.startsAt.getTime() !== row.startsAt.getTime() ||
        window.endsAt.getTime() !== row.endsAt.getTime();
      if (moved) await assertBookable(tx, row.trainerId, row.memberId, window, id);
      const changes = {
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      };
      const diff = diffFields(
        {
          startsAt: row.startsAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
          notes: row.notes,
        },
        {
          startsAt: window.startsAt.toISOString(),
          endsAt: window.endsAt.toISOString(),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      );
      if (Object.keys(diff.after).length > 0) {
        await tx.update(appointments).set(changes).where(eq(appointments.id, id));
        await recordAudit(tx, ctx, {
          action: 'APPOINTMENT_UPDATED',
          entityType: 'APPOINTMENT',
          entityId: id,
          before: diff.before,
          after: diff.after,
        });
      }
      return readAppointment(tx, id);
    });
  } catch (error) {
    throw appointmentWriteError(error);
  }
}

const STATUS_ACTIONS = {
  CANCELLED: { action: 'APPOINTMENT_CANCELLED', mustHaveStarted: false },
  COMPLETED: { action: 'APPOINTMENT_COMPLETED', mustHaveStarted: true },
  NO_SHOW: { action: 'APPOINTMENT_NO_SHOW', mustHaveStarted: true },
} as const;

export type AppointmentActor = { kind: 'staff'; auth: Auth } | { kind: 'member'; memberId: string };

/**
 * Cancel, complete or mark a no-show. Completing and no-show need the start to have passed;
 * a member may only cancel their own future appointment (another id reads as 404).
 */
export async function setAppointmentStatus(
  id: string,
  status: Exclude<AppointmentStatus, 'BOOKED'>,
  actor: AppointmentActor,
  reason: string | undefined,
  ctx: RequestContext,
): Promise<AppointmentDto> {
  return db.transaction(async (tx) => {
    const row = await lockAppointment(tx, id);
    if (actor.kind === 'member') {
      if (row.memberId !== actor.memberId) throw notFound('Appointment');
    } else {
      await assertTrainerMayManage(actor.auth, row.trainerId, row.memberId);
    }
    assertBooked(row);
    const rule = STATUS_ACTIONS[status];
    const started = hasStarted(row.startsAt);
    if (rule.mustHaveStarted && !started) {
      throw conflict(
        ERROR_CODES.INVALID_STATUS_TRANSITION,
        'This can be recorded once the appointment has started.',
      );
    }
    if (actor.kind === 'member' && started) {
      throw conflict(
        ERROR_CODES.BOOKING_CLOSED,
        'This appointment has already started. Please contact the front desk.',
      );
    }
    await tx.update(appointments).set({ status }).where(eq(appointments.id, id));
    await recordAudit(tx, ctx, {
      action: rule.action,
      entityType: 'APPOINTMENT',
      entityId: id,
      before: { status: 'BOOKED' },
      after: { status, via: actor.kind === 'member' ? 'PORTAL' : 'STAFF' },
      reason,
    });
    return readAppointment(tx, id);
  });
}

/** Portal: the member's own appointments, upcoming first then the recent past. */
export async function listMyAppointments(memberId: string): Promise<MyAppointmentDto[]> {
  const rows = await selectAppointments()
    .where(eq(appointments.memberId, memberId))
    .orderBy(desc(appointments.startsAt))
    .limit(100);
  return rows.map((row) => toMyAppointment(toDto(row)));
}
