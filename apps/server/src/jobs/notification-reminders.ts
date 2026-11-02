import { daysBetween, EQUIPMENT_LIMITS, type NotificationType } from '@gms/shared';
import { sql, type SQL } from 'drizzle-orm';
import { config } from '../config/env';
import { db, type DbExecutor } from '../db/client';
import { gymToday } from '../lib/dates';
import {
  createNotification,
  managementUserIds,
  type NewNotification,
} from '../modules/notifications/notifications.service';
import { templates } from '../modules/notifications/templates';
import { loadSettingsRow } from '../modules/settings/settings.service';

/** Fixed key: only one instance may run the reminders job at a time (several API processes). */
const REMINDERS_LOCK = sql`hashtext('job:notification-reminders')`;

/** Classes and appointments are announced once, within a day of their start. */
const UPCOMING_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ReminderCounts = Partial<Record<NotificationType, number>>;

export interface RemindersRunResult {
  /** false when another process held the lock and this run did nothing. */
  ran: boolean;
  /** New notifications by type; reminders that already existed are not counted. */
  created: ReminderCounts;
}

const rowsOf = async <T extends Record<string, unknown>>(tx: DbExecutor, query: SQL) =>
  (await tx.execute<T>(query)).rows;

/**
 * Creates the time-based reminders of requirements §12. Every reminder has a dedupe key built from
 * what it is about (membership and end date, invoice, booking and start time, …), so the job can
 * run hourly, or twice at once on two servers, and still never repeat a reminder.
 * Event notifications (expired, cancelled, suspended, renewed) are created by the change itself.
 */
export async function sendReminders(now = new Date()): Promise<RemindersRunResult> {
  return db.transaction(async (tx) => {
    const [lock] = await tx
      .execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(${REMINDERS_LOCK}) as locked`,
      )
      .then((result) => result.rows);
    if (!lock?.locked) return { ran: false, created: {} };

    const today = gymToday(now);
    const settings = await loadSettingsRow(tx);
    const created: ReminderCounts = {};
    const notify = async (notification: NewNotification) => {
      if (await createNotification(tx, notification)) {
        created[notification.type] = (created[notification.type] ?? 0) + 1;
      }
    };

    // Memberships ending within the reminder window that have not been renewed.
    const expiring = await rowsOf<{
      id: string;
      user_id: string;
      plan_name: string;
      end_date: string;
    }>(
      tx,
      sql`select m.id, mb.user_id, m.plan_name_snapshot as plan_name, m.end_date::text as end_date
        from memberships m join members mb on mb.id = m.member_id
        where m.status = 'ACTIVE' and mb.archived_at is null and mb.user_id is not null
          and m.end_date between ${today}::date and ${today}::date + ${settings.expiryReminderDays}::int
          and not exists (
            select 1 from memberships later
            where later.member_id = m.member_id and later.id <> m.id
              and later.status in ('PENDING', 'ACTIVE') and later.start_date > m.end_date)`,
    );
    for (const row of expiring) {
      await notify({
        recipientUserId: row.user_id,
        type: 'MEMBERSHIP_EXPIRING',
        ...templates.membershipExpiring(
          row.plan_name,
          row.end_date,
          daysBetween(today, row.end_date),
        ),
        entity: { type: 'MEMBERSHIP', id: row.id },
        dedupeKey: `MEMBERSHIP_EXPIRING:${row.id}:${row.end_date}`,
      });
    }

    // Unpaid invoices: due within the payment reminder window, or already past due.
    const unpaid = await rowsOf<{
      id: string;
      user_id: string;
      invoice_number: string;
      due_date: string;
      balance_minor: string;
    }>(
      tx,
      sql`select * from (
          select i.id, mb.user_id, i.invoice_number, i.due_date::text as due_date,
            i.amount_due_minor
              - coalesce((select sum(p.amount_minor) from payments p
                  where p.invoice_id = i.id and p.status = 'COMPLETED'), 0)
              + coalesce((select sum(r.amount_minor) from refunds r
                  join payments p on p.id = r.payment_id where p.invoice_id = i.id), 0)
              as balance_minor
          from invoices i join members mb on mb.id = i.member_id
          where i.status in ('PENDING', 'PARTIALLY_PAID', 'OVERDUE')
            and mb.archived_at is null and mb.user_id is not null
            and i.due_date <= ${today}::date + ${settings.paymentDueReminderDays}::int
        ) open where balance_minor > 0`,
    );
    for (const row of unpaid) {
      const daysLeft = daysBetween(today, row.due_date);
      const balance = Number(row.balance_minor);
      if (daysLeft < 0) {
        await notify({
          recipientUserId: row.user_id,
          type: 'PAYMENT_OVERDUE',
          ...templates.paymentOverdue(row.invoice_number, balance, row.due_date),
          entity: { type: 'INVOICE', id: row.id },
          dedupeKey: `PAYMENT_OVERDUE:${row.id}:${row.due_date}`,
        });
      } else {
        await notify({
          recipientUserId: row.user_id,
          type: 'PAYMENT_DUE',
          ...templates.paymentDue(row.invoice_number, balance, row.due_date, daysLeft),
          entity: { type: 'INVOICE', id: row.id },
          dedupeKey: `PAYMENT_DUE:${row.id}:${row.due_date}`,
        });
      }
    }

    const until = new Date(now.getTime() + UPCOMING_WINDOW_MS);

    // Booked classes starting within a day (a moved session gets a fresh reminder).
    const classes = await rowsOf<{
      booking_id: string;
      session_id: string;
      user_id: string;
      class_name: string;
      room: string | null;
      starts_at: Date;
    }>(
      tx,
      sql`select b.id as booking_id, s.id as session_id, mb.user_id, fc.name as class_name,
          s.room, s.starts_at
        from class_bookings b
        join class_sessions s on s.id = b.session_id
        join fitness_classes fc on fc.id = s.class_id
        join members mb on mb.id = b.member_id
        where b.status = 'BOOKED' and s.status = 'SCHEDULED'
          and mb.archived_at is null and mb.user_id is not null
          and s.starts_at > ${now.toISOString()}::timestamptz
          and s.starts_at <= ${until.toISOString()}::timestamptz`,
    );
    for (const row of classes) {
      const startsAt = new Date(row.starts_at);
      await notify({
        recipientUserId: row.user_id,
        type: 'CLASS_REMINDER',
        ...templates.classReminder(row.class_name, startsAt, row.room),
        entity: { type: 'CLASS_SESSION', id: row.session_id },
        dedupeKey: `CLASS_REMINDER:${row.booking_id}:${startsAt.toISOString()}`,
      });
    }

    // Personal training within a day: both the member and the trainer are reminded.
    const appointments = await rowsOf<{
      id: string;
      starts_at: Date;
      member_user_id: string | null;
      member_name: string;
      trainer_id: string;
      trainer_name: string;
    }>(
      tx,
      sql`select a.id, a.starts_at, mb.user_id as member_user_id,
          mb.first_name || ' ' || mb.last_name as member_name,
          a.trainer_id, t.first_name || ' ' || t.last_name as trainer_name
        from appointments a
        join members mb on mb.id = a.member_id
        join users t on t.id = a.trainer_id
        where a.status = 'BOOKED'
          and a.starts_at > ${now.toISOString()}::timestamptz
          and a.starts_at <= ${until.toISOString()}::timestamptz`,
    );
    for (const row of appointments) {
      const startsAt = new Date(row.starts_at);
      const base = {
        type: 'APPOINTMENT_REMINDER' as const,
        entity: { type: 'APPOINTMENT' as const, id: row.id },
        dedupeKey: `APPOINTMENT_REMINDER:${row.id}:${startsAt.toISOString()}`,
      };
      if (row.member_user_id) {
        await notify({
          ...base,
          recipientUserId: row.member_user_id,
          ...templates.appointmentReminder(row.trainer_name, startsAt),
        });
      }
      await notify({
        ...base,
        recipientUserId: row.trainer_id,
        ...templates.appointmentReminder(row.member_name, startsAt),
      });
    }

    // Equipment due (or overdue) for maintenance: every Admin and Manager, once per due date.
    const equipmentDue = await rowsOf<{
      id: string;
      name: string;
      asset_tag: string;
      next_date: string;
    }>(
      tx,
      sql`select id, name, asset_tag, next_maintenance_date::text as next_date from equipment
        where status <> 'RETIRED' and next_maintenance_date is not null
          and next_maintenance_date <= ${today}::date + ${EQUIPMENT_LIMITS.defaultDueDays}::int`,
    );
    if (equipmentDue.length > 0) {
      const recipients = await managementUserIds(tx);
      for (const row of equipmentDue) {
        const content = templates.equipmentMaintenanceDue(
          row.name,
          row.asset_tag,
          row.next_date,
          daysBetween(today, row.next_date),
        );
        for (const recipientUserId of recipients) {
          await notify({
            recipientUserId,
            type: 'EQUIPMENT_MAINTENANCE_DUE',
            ...content,
            entity: { type: 'EQUIPMENT', id: row.id },
            dedupeKey: `EQUIPMENT_MAINTENANCE_DUE:${row.id}:${row.next_date}`,
          });
        }
      }
    }

    // Biometric retention (PLAN §6.6): members who still have a live fingerprint enrollment but
    // were archived, or have had no membership, for `biometric_retention_days`. Admins and
    // Managers are told; they confirm the deletion by revoking the enrollment. Nothing is deleted
    // here. "Since" is the archive date, or the last day a membership covered (a cancelled one
    // ends on its cancellation date), and never earlier than the first enrollment.
    const zone = config.gymTimezone;
    const retentionDue = await rowsOf<{
      member_id: string;
      name: string;
      member_code: string;
      reason: 'ARCHIVED' | 'NO_MEMBERSHIP';
      since: string;
    }>(
      tx,
      sql`select * from (
          select mb.id as member_id, mb.first_name || ' ' || mb.last_name as name, mb.member_code,
            case when mb.archived_at is null then 'NO_MEMBERSHIP' else 'ARCHIVED' end as reason,
            (case when mb.archived_at is not null
              then (mb.archived_at at time zone ${zone})::date
              else greatest(
                (select max(case when m.status = 'CANCELLED'
                    then least(m.end_date, (m.cancelled_at at time zone ${zone})::date)
                    else m.end_date end)
                  from memberships m where m.member_id = mb.id),
                (select (min(e.enrolled_at) at time zone ${zone})::date
                  from biometric_enrollments e
                  where e.member_id = mb.id and e.status = 'ACTIVE'))
            end)::text as since
          from members mb
          where exists (select 1 from biometric_enrollments e
              where e.member_id = mb.id and e.status = 'ACTIVE')
            and (mb.archived_at is not null or not exists (
              select 1 from memberships m
              where m.member_id = mb.id and m.status in ('PENDING', 'ACTIVE', 'SUSPENDED')
                and m.end_date >= ${today}::date))
        ) lapsed
        where since::date <= ${today}::date - ${settings.biometricRetentionDays}::int
        order by since, member_id`,
    );
    if (retentionDue.length > 0) {
      const recipients = await managementUserIds(tx);
      for (const row of retentionDue) {
        const content = templates.biometricRetentionDue(
          row.name,
          row.member_code,
          row.reason,
          row.since,
          settings.biometricRetentionDays,
        );
        for (const recipientUserId of recipients) {
          await notify({
            recipientUserId,
            type: 'BIOMETRIC_RETENTION_DUE',
            ...content,
            entity: { type: 'MEMBER', id: row.member_id },
            dedupeKey: `BIOMETRIC_RETENTION_DUE:${row.member_id}:${row.reason}:${row.since}`,
          });
        }
      }
    }

    return { ran: true, created };
  });
}
