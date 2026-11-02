import { eq } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import {
  appointments,
  biometricEnrollments,
  classBookings,
  classSessions,
  equipment,
  fitnessClasses,
  gymSettings,
  invoices,
  notificationDeliveries,
  notifications,
  users,
} from '../../src/db/schema';
import { dispatchNotifications } from '../../src/jobs/dispatch-notifications';
import { sendReminders } from '../../src/jobs/notification-reminders';
import {
  smsChannel,
  type ChannelAdapter,
  type OutboundMessage,
} from '../../src/modules/notifications/channels';
import { signIn, testApp, type Session } from '../setup/auth';
import { resetTables } from '../setup/db';
import {
  createDevice,
  createMember,
  createMembership,
  createPlan,
  createUser,
  enrollMember,
  type TestUser,
} from '../setup/factories';
import { api, gymDate, portalMember } from '../setup/scheduling';

const app = testApp();

let admin: TestUser;
let adminSession: Session;
let manager: TestUser;

beforeEach(async () => {
  await resetTables();
  admin = await createUser({ role: 'ADMIN' });
  adminSession = await signIn(app, admin);
  manager = await createUser({ role: 'MANAGER' });
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(closeDb);

const notificationsOf = (userId: string) =>
  db.select().from(notifications).where(eq(notifications.recipientUserId, userId));

const HOUR = 3_600_000;

/** A member with a portal login whose only membership ends in `days`, signed in. */
async function expiringMember(firstName: string, days: number) {
  const email = `${firstName.toLowerCase()}@example.test`;
  const user = await createUser({ role: 'MEMBER', email, firstName, lastName: 'Portal' });
  const member = await createMember({ userId: user.id, email, firstName, lastName: 'Portal' });
  const membership = await createMembership(member, await createPlan({ name: 'Monthly Gold' }), {
    startDate: gymDate(days - 30),
    endDate: gymDate(days),
  });
  return { user, member, membership, session: await signIn(app, user) };
}

describe('reminder job (requirements §12)', () => {
  it('creates each reminder once, however often it runs', async () => {
    const { user: sana, membership } = await expiringMember('Sana', 3);
    const { user: omar, member: omarMember } = await portalMember(app, 'Omar');
    await db.insert(invoices).values([
      {
        memberId: omarMember.id,
        description: 'Personal training pack',
        amountDueMinor: 1_500_000,
        dueDate: gymDate(2),
        status: 'PENDING',
      },
      {
        memberId: omarMember.id,
        description: 'Locker rental',
        amountDueMinor: 200_000,
        dueDate: gymDate(-4),
        status: 'OVERDUE',
      },
    ]);
    const trainer = await createUser({ role: 'TRAINER', firstName: 'Ayesha', lastName: 'Coach' });
    const now = new Date();
    const [yoga] = await db
      .insert(fitnessClasses)
      .values({ name: 'Morning Yoga', defaultDurationMinutes: 60, defaultCapacity: 12 })
      .returning();
    const [session] = await db
      .insert(classSessions)
      .values({
        classId: yoga!.id,
        trainerId: trainer.id,
        startsAt: new Date(now.getTime() + 5 * HOUR),
        endsAt: new Date(now.getTime() + 6 * HOUR),
        capacity: 12,
        room: 'Studio 1',
      })
      .returning();
    await db
      .insert(classBookings)
      .values({ sessionId: session!.id, memberId: omarMember.id, status: 'BOOKED' });
    await db.insert(appointments).values({
      trainerId: trainer.id,
      memberId: omarMember.id,
      startsAt: new Date(now.getTime() + 20 * HOUR),
      endsAt: new Date(now.getTime() + 21 * HOUR),
    });
    await db.insert(equipment).values({
      name: 'Cable Crossover',
      category: 'STRENGTH_MACHINE',
      condition: 'GOOD',
      nextMaintenanceDate: gymDate(2),
    });

    const first = await sendReminders(now);
    expect(first).toEqual({
      ran: true,
      created: {
        MEMBERSHIP_EXPIRING: 1,
        PAYMENT_DUE: 1,
        PAYMENT_OVERDUE: 1,
        CLASS_REMINDER: 1,
        APPOINTMENT_REMINDER: 2,
        EQUIPMENT_MAINTENANCE_DUE: 2,
      },
    });
    const second = await sendReminders(new Date(now.getTime() + HOUR));
    expect(second).toEqual({ ran: true, created: {} });

    const sanaNotes = await notificationsOf(sana.id);
    expect(sanaNotes).toHaveLength(1);
    expect(sanaNotes[0]).toMatchObject({
      type: 'MEMBERSHIP_EXPIRING',
      entityType: 'MEMBERSHIP',
      entityId: membership.id,
    });
    expect((await notificationsOf(omar.id)).map((n) => n.type).sort()).toEqual([
      'APPOINTMENT_REMINDER',
      'CLASS_REMINDER',
      'PAYMENT_DUE',
      'PAYMENT_OVERDUE',
    ]);
    expect((await notificationsOf(trainer.id)).map((n) => n.type)).toEqual([
      'APPOINTMENT_REMINDER',
    ]);
    for (const staff of [admin, manager]) {
      expect((await notificationsOf(staff.id)).map((n) => n.type)).toEqual([
        'EQUIPMENT_MAINTENANCE_DUE',
      ]);
    }
  });

  it('two runs at the same time still create one copy', async () => {
    await expiringMember('Hina', 1);
    const results = await Promise.all([sendReminders(), sendReminders()]);
    const created = results.reduce((sum, r) => sum + (r.created.MEMBERSHIP_EXPIRING ?? 0), 0);
    expect(created).toBe(1);
    expect(await db.select().from(notifications)).toHaveLength(1);
  });

  it('does not remind about a membership that is already renewed', async () => {
    const { member, user } = await expiringMember('Bilal', 2);
    await createMembership(member, await createPlan(), {
      status: 'PENDING',
      startDate: gymDate(3),
      endDate: gymDate(33),
    });
    await sendReminders();
    expect(await notificationsOf(user.id)).toEqual([]);
  });
});

describe('biometric retention review (PLAN §6.6)', () => {
  const DAY = 24 * HOUR;
  const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

  /** A member with a live fingerprint enrollment made `enrolledDaysAgo` days ago. */
  async function enrolled(firstName: string, enrolledDaysAgo = 200, archivedDaysAgo?: number) {
    const member = await createMember({
      firstName,
      lastName: 'Retention',
      ...(archivedDaysAgo === undefined
        ? {}
        : { archivedAt: daysAgo(archivedDaysAgo), archivedBy: admin.id }),
    });
    const { device } = await createDevice();
    const enrollment = await enrollMember(member, device, `SIM-${firstName.toUpperCase()}`, admin);
    await db
      .update(biometricEnrollments)
      .set({ enrolledAt: daysAgo(enrolledDaysAgo) })
      .where(eq(biometricEnrollments.id, enrollment.id));
    return { member, enrollment };
  }

  const retentionNotes = async (userId: string) =>
    (await notificationsOf(userId)).filter((n) => n.type === 'BIOMETRIC_RETENTION_DUE');

  it('flags lapsed and archived members to Admins and Managers once, and nobody else', async () => {
    const receptionist = await createUser({ role: 'RECEPTIONIST' });
    const plan = await createPlan();
    // Due (default retention 30 days):
    const { member: lapsed } = await enrolled('Kamran');
    await createMembership(lapsed, plan, {
      status: 'EXPIRED',
      startDate: gymDate(-61),
      endDate: gymDate(-31),
    });
    const { member: archived } = await enrolled('Rabia', 200, 40);
    const { member: cancelled } = await enrolled('Fahad');
    await createMembership(cancelled, plan, {
      status: 'CANCELLED',
      startDate: gymDate(-50),
      endDate: gymDate(10),
      cancelledAt: daysAgo(35),
    });
    // Not due:
    const { member: recent } = await enrolled('Nadia');
    await createMembership(recent, plan, {
      status: 'EXPIRED',
      startDate: gymDate(-40),
      endDate: gymDate(-10),
    });
    const { member: current } = await enrolled('Usman');
    await createMembership(current, plan, { startDate: gymDate(-40), endDate: gymDate(20) });
    const { member: suspended } = await enrolled('Saima');
    await createMembership(suspended, plan, {
      status: 'SUSPENDED',
      startDate: gymDate(-60),
      endDate: gymDate(5),
    });
    await enrolled('Hamza', 5); // never had a membership, but enrolled only 5 days ago
    // Archived long ago, but the fingerprint is already revoked: nothing left to review.
    const { enrollment } = await enrolled('Imran', 200, 90);
    await db
      .update(biometricEnrollments)
      .set({ status: 'REVOKED', revokedAt: new Date(), revokedBy: admin.id, revokeReason: 'Left' })
      .where(eq(biometricEnrollments.id, enrollment.id));

    const first = await sendReminders();
    expect(first.created.BIOMETRIC_RETENTION_DUE).toBe(6); // 3 members × Admin and Manager
    expect((await sendReminders()).created.BIOMETRIC_RETENTION_DUE).toBeUndefined();

    for (const staff of [admin, manager]) {
      const notes = await retentionNotes(staff.id);
      expect(notes.map((n) => n.entityId).sort()).toEqual(
        [lapsed.id, archived.id, cancelled.id].sort(),
      );
      for (const note of notes) {
        expect(note).toMatchObject({ entityType: 'MEMBER', title: 'Fingerprint data review due' });
      }
      const byMember = new Map(notes.map((n) => [n.entityId, n.body]));
      expect(byMember.get(lapsed.id)).toContain(
        `Kamran Retention (${lapsed.memberCode}) has had no active membership since`,
      );
      expect(byMember.get(archived.id)).toContain('was archived on');
      expect(byMember.get(cancelled.id)).toContain('The retention period is 30 days');
    }
    expect(await retentionNotes(receptionist.id)).toEqual([]);
    // The job only reminds: nothing is revoked or deleted on its own.
    const live = await db
      .select({ status: biometricEnrollments.status })
      .from(biometricEnrollments)
      .where(eq(biometricEnrollments.memberId, lapsed.id));
    expect(live).toEqual([{ status: 'ACTIVE' }]);
  });

  it('follows the retention setting', async () => {
    const { member } = await enrolled('Nida');
    await createMembership(member, await createPlan(), {
      status: 'EXPIRED',
      startDate: gymDate(-40),
      endDate: gymDate(-10),
    });
    await sendReminders();
    expect(await retentionNotes(admin.id)).toEqual([]);

    await db.update(gymSettings).set({ biometricRetentionDays: 7 });
    await sendReminders();
    const [note] = await retentionNotes(admin.id);
    expect(note?.body).toContain('The retention period is 7 days');
    expect(note?.entityId).toBe(member.id);
  });
});

describe('membership events notify the member straight away', () => {
  it('a cancellation creates one MEMBERSHIP_CANCELLED notification', async () => {
    const { user, membership, session } = await expiringMember('Zara', 20);
    const res = await api(adminSession).post(`/memberships/${membership.id}/cancel`, {
      reason: 'Member relocated',
    });
    expect(res.status).toBe(200);
    const mine = await api(session).get('/notifications');
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({
      type: 'MEMBERSHIP_CANCELLED',
      entityId: membership.id,
      readAt: null,
    });
    expect(await notificationsOf(user.id)).toHaveLength(1);
  });
});

describe('the bell: list, unread count, read and read-all', () => {
  it('marks own notifications read and hides other people’s', async () => {
    const { session, user } = await portalMember(app, 'Ali');
    await db.insert(notifications).values(
      ['one', 'two', 'three'].map((key) => ({
        recipientUserId: user.id,
        type: 'CLASS_REMINDER' as const,
        title: `Class ${key}`,
        body: 'Starts soon',
        dedupeKey: `test:${key}`,
      })),
    );
    const [othersNote] = await db
      .insert(notifications)
      .values({
        recipientUserId: admin.id,
        type: 'EQUIPMENT_MAINTENANCE_DUE',
        title: 'Service due',
        body: 'Treadmill',
        dedupeKey: 'test:admin',
      })
      .returning();

    expect((await api(session).get('/notifications/unread-count')).body).toEqual({ count: 3 });
    const list = await api(session).get('/notifications');
    expect(list.body.total).toBe(3);
    const target = list.body.data[0].id;
    const read = await api(session).post(`/notifications/${target}/read`);
    expect(read.status).toBe(200);
    expect(read.body.readAt).toEqual(expect.any(String));
    expect((await api(session).get('/notifications/unread-count')).body).toEqual({ count: 2 });
    expect((await api(session).get('/notifications?unreadOnly=true')).body.total).toBe(2);

    expect((await api(session).post(`/notifications/${othersNote!.id}/read`)).status).toBe(404);
    expect((await api(session).post('/notifications/read-all')).body).toEqual({ updated: 2 });
    expect((await api(session).get('/notifications/unread-count')).body).toEqual({ count: 0 });
    expect((await api(adminSession).get('/notifications/unread-count')).body).toEqual({ count: 1 });
  });
});

describe('external channels', () => {
  async function pendingNotification(recipientUserId: string) {
    await db.insert(notifications).values({
      recipientUserId,
      type: 'PAYMENT_DUE',
      title: 'Payment due',
      body: 'INV-000123 is due on 25 Oct 2026.',
      dedupeKey: `test:${recipientUserId}`,
    });
  }

  it('without credentials every delivery is NOT_CONFIGURED and nothing goes out', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const transportSpy = vi.spyOn(nodemailer, 'createTransport');
    const { user } = await portalMember(app, 'Nida');
    await pendingNotification(user.id);

    const run = await dispatchNotifications();
    expect(run).toEqual({
      ran: true,
      notifications: 1,
      deliveries: { NOT_CONFIGURED: 3, SENT: 0, FAILED: 0 },
    });
    const rows = await db.select().from(notificationDeliveries);
    expect(rows.map((r) => [r.channel, r.status]).sort()).toEqual([
      ['EMAIL', 'NOT_CONFIGURED'],
      ['SMS', 'NOT_CONFIGURED'],
      ['WHATSAPP', 'NOT_CONFIGURED'],
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(transportSpy).not.toHaveBeenCalled();

    // Each notification is attempted once.
    expect((await dispatchNotifications()).notifications).toBe(0);
    expect(await db.select().from(notificationDeliveries)).toHaveLength(3);
  });

  it('a configured channel sends to real recipients and never to demo accounts', async () => {
    const sent: OutboundMessage[] = [];
    const fake: ChannelAdapter = {
      channel: 'SMS',
      provider: 'Fake',
      requiredEnv: [],
      missingEnv: () => [],
      send: async (message) => {
        sent.push(message);
        return { ok: true, providerMessageId: `fake-${sent.length}` };
      },
    };
    const { user, member } = await portalMember(app, 'Real');
    const demo = await portalMember(app, 'Demo');
    await db.update(users).set({ isDemo: true }).where(eq(users.id, demo.user.id));
    await pendingNotification(user.id);
    await pendingNotification(demo.user.id);

    const run = await dispatchNotifications({ channels: [fake] });
    expect(run.deliveries).toEqual({ NOT_CONFIGURED: 0, SENT: 1, FAILED: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual({ email: user.email, phoneE164: member.phoneE164 });
    const rows = await db.select().from(notificationDeliveries);
    expect(rows.find((r) => r.status === 'FAILED')).toMatchObject({ errorCode: 'DEMO_RECIPIENT' });
    expect(rows.find((r) => r.status === 'SENT')).toMatchObject({ providerMessageId: 'fake-1' });
  });

  it('the Twilio adapter reads the provider answer (fetch stubbed, no network)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 21211 }), { status: 400 }));
    const sms = smsChannel({
      accountSid: 'AC-test',
      authToken: 'token-test',
      smsFrom: '+15005550006',
      whatsappFrom: undefined,
    });
    expect(sms.missingEnv()).toEqual([]);
    const message = {
      gymName: 'Iron Valley Gym',
      title: 'Payment due',
      body: 'Due tomorrow',
      to: { email: null, phoneE164: '+923001234567' },
    };
    expect(await sms.send(message)).toEqual({ ok: true, providerMessageId: 'SM123' });
    expect(await sms.send(message)).toEqual({ ok: false, errorCode: 'TWILIO_21211' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/Accounts/AC-test/Messages.json');
    expect(await sms.send({ ...message, to: { email: null, phoneE164: null } })).toEqual({
      ok: false,
      errorCode: 'NO_PHONE_NUMBER',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('the channels screen lists variable names, never values, for Admin and Manager only', async () => {
    const res = await api(adminSession).get('/notifications/channels');
    expect(res.status).toBe(200);
    expect(res.body.map((c: { channel: string }) => c.channel)).toEqual([
      'EMAIL',
      'SMS',
      'WHATSAPP',
    ]);
    expect(res.body[0]).toMatchObject({
      configured: false,
      provider: 'SMTP',
      missingEnv: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'],
      recent: { SENT: 0, FAILED: 0, NOT_CONFIGURED: 0 },
    });
    const trainer = await signIn(app, await createUser({ role: 'TRAINER' }));
    expect((await api(trainer).get('/notifications/channels')).status).toBe(403);
  });
});
