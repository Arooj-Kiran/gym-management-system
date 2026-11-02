import { addDays } from '@gms/shared';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import { auditLogs, gymSettings, invoices, payments, refunds } from '../../src/db/schema';
import { markOverdue } from '../../src/jobs/mark-overdue-invoices';
import { gymToday } from '../../src/lib/dates';
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

const app = testApp();

let today: string;
let admin: TestUser;
let adminSession: Session;
let manager: Session;
let receptionist: Session;
let memberUser: TestUser;
let memberSession: Session;
let member: Awaited<ReturnType<typeof createMember>>;
let strictPlan: Awaited<ReturnType<typeof createPlan>>;
let partialPlan: Awaited<ReturnType<typeof createPlan>>;

beforeEach(async () => {
  await resetTables();
  today = gymToday();
  admin = await createUser({ role: 'ADMIN', firstName: 'Ayesha', lastName: 'Malik' });
  adminSession = await signIn(app, admin);
  manager = await signIn(app, await createUser({ role: 'MANAGER', firstName: 'Omar' }));
  receptionist = await signIn(app, await createUser({ role: 'RECEPTIONIST', firstName: 'Sana' }));
  memberUser = await createUser({
    role: 'MEMBER',
    email: 'hamza@example.test',
    firstName: 'Hamza',
    lastName: 'Qureshi',
  });
  member = await createMember({
    userId: memberUser.id,
    email: 'hamza@example.test',
    firstName: 'Hamza',
    lastName: 'Qureshi',
  });
  memberSession = await signIn(app, memberUser);
  strictPlan = await createPlan({ name: 'Monthly Standard', priceMinor: 450_000 });
  partialPlan = await createPlan({
    name: 'Quarterly Flex',
    priceMinor: 1_200_000,
    allowPartialPayment: true,
  });
});
afterAll(closeDb);

const as = (s: Session) => ({
  get: (path: string) => s.agent.get(`/api/v1${path}`),
  post: (path: string, body: object = {}) =>
    s.agent.post(`/api/v1${path}`).set('X-CSRF-Token', s.csrf).send(body),
  patch: (path: string, body: object = {}) =>
    s.agent.patch(`/api/v1${path}`).set('X-CSRF-Token', s.csrf).send(body),
});
const desk = () => as(receptionist);

const auditOf = (action: string, entityId?: string) =>
  db
    .select()
    .from(auditLogs)
    .where(
      entityId
        ? and(eq(auditLogs.action, action), eq(auditLogs.entityId, entityId))
        : eq(auditLogs.action, action),
    );

async function assign(planId = strictPlan.id, startDate?: string) {
  const res = await desk().post('/memberships', { memberId: member.id, planId, startDate });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as {
    id: string;
    startDate: string;
    endDate: string;
    status: string;
    invoice: { id: string; invoiceNumber: string; balanceMinor: number; status: string } | null;
  };
}

async function manualInvoice(amountDueMinor: number, dueDate = today) {
  const res = await desk().post('/invoices', {
    memberId: member.id,
    description: 'Locker rental, one month',
    amountDueMinor,
    dueDate,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; invoiceNumber: string; status: string };
}

function pay(invoiceId: string, amountMinor: number, extra: object = {}) {
  return desk().post('/payments', { invoiceId, amountMinor, method: 'CASH', ...extra });
}

const invoiceOf = async (id: string) => (await desk().get(`/invoices/${id}`)).body;

describe('membership invoices (scenario 2, invoice part)', () => {
  it('bills a new membership on assign, due after the configured number of days', async () => {
    await db.update(gymSettings).set({ invoiceDueDays: 7 });
    const membership = await assign(strictPlan.id, addDays(today, 3));
    expect(membership.invoice).toMatchObject({
      invoiceNumber: expect.stringMatching(/^INV-\d{6}$/),
      amountDueMinor: 450_000,
      balanceMinor: 450_000,
      dueDate: addDays(today, 10),
      status: 'PENDING',
    });
    const invoice = await invoiceOf(membership.invoice!.id);
    expect(invoice).toMatchObject({
      membershipId: membership.id,
      member: { id: member.id },
      allowPartialPayment: false,
      paidMinor: 0,
      payments: [],
      refunds: [],
    });
    expect(invoice.description).toContain('Monthly Standard membership');
    expect(await auditOf('INVOICE_CREATED', membership.invoice!.id)).toHaveLength(1);

    const list = await desk().get(`/members/${member.id}/invoices`);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.summary).toEqual({ outstandingMinor: 450_000, overdueMinor: 0 });
  });

  it('creates no invoice for a free plan', async () => {
    const free = await createPlan({ name: 'Staff Family Pass', priceMinor: 0 });
    const membership = await assign(free.id);
    expect(membership.invoice).toBeNull();
    expect(await db.select().from(invoices)).toHaveLength(0);
  });

  it('bills the renewal as a new invoice', async () => {
    const first = await assign();
    await desk().post(`/memberships/${first.id}/activate`).expect(200);
    const renewal = await desk().post(`/memberships/${first.id}/renew`);
    expect(renewal.status).toBe(201);
    expect(renewal.body.status).toBe('ACTIVE'); // C1 is off by default
    expect(renewal.body.invoice).toMatchObject({ amountDueMinor: 450_000, status: 'PENDING' });
    expect(renewal.body.invoice.id).not.toBe(first.invoice!.id);
  });
});

describe('counter payments (scenario 10)', () => {
  it('a full payment marks the invoice PAID, issues a receipt and shows in both histories', async () => {
    const { invoice } = await assign();
    const res = await pay(invoice!.id, 450_000);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      receiptNumber: expect.stringMatching(/^RCP-\d{6}$/),
      invoiceId: invoice!.id,
      amountMinor: 450_000,
      refundableMinor: 450_000,
      method: 'CASH',
      status: 'COMPLETED',
      recordedByName: expect.stringContaining('Sana'),
    });
    expect(await invoiceOf(invoice!.id)).toMatchObject({ status: 'PAID', balanceMinor: 0 });

    const staffList = await desk().get(`/members/${member.id}/payments`);
    expect(staffList.body.data.map((p: { id: string }) => p.id)).toEqual([res.body.id]);
    const mine = await as(memberSession).get('/me/payments');
    expect(mine.status).toBe(200);
    expect(mine.body.data).toEqual([
      expect.objectContaining({ id: res.body.id, receiptNumber: res.body.receiptNumber }),
    ]);
    // The portal never shows who recorded it or staff notes.
    expect(mine.body.data[0]).not.toHaveProperty('recordedByName');
    expect(mine.body.data[0]).not.toHaveProperty('notes');

    const receipt = await desk().get(`/payments/${res.body.id}/receipt`);
    expect(receipt.body).toMatchObject({
      gymName: expect.any(String),
      currencyCode: 'PKR',
      receiptNumber: res.body.receiptNumber,
      member: { firstName: 'Hamza', lastName: 'Qureshi' },
      invoice: { invoiceNumber: invoice!.invoiceNumber, balanceMinor: 0, status: 'PAID' },
      refunds: [],
    });
    expect((await as(memberSession).get(`/me/payments/${res.body.id}/receipt`)).status).toBe(200);

    const [audit] = await auditOf('PAYMENT_RECORDED', res.body.id);
    expect(audit!.after).toMatchObject({ amountMinor: 450_000, invoiceStatus: 'PAID' });
  });

  it('a partial payment leaves PARTIALLY_PAID with the right balance when the plan allows it', async () => {
    const { invoice } = await assign(partialPlan.id);
    await pay(invoice!.id, 400_000).expect(201);
    expect(await invoiceOf(invoice!.id)).toMatchObject({
      status: 'PARTIALLY_PAID',
      paidMinor: 400_000,
      balanceMinor: 800_000,
      allowPartialPayment: true,
    });
    await pay(invoice!.id, 800_000, { method: 'CARD', reference: 'POS-7781' }).expect(201);
    expect(await invoiceOf(invoice!.id)).toMatchObject({ status: 'PAID', balanceMinor: 0 });
  });

  it('rejects a part payment when the plan forbids it (400)', async () => {
    const { invoice } = await assign();
    const res = await pay(invoice!.id, 100_000);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'PARTIAL_PAYMENT_NOT_ALLOWED',
      balanceMinor: 450_000,
    });
    expect(await db.select().from(payments)).toHaveLength(0);
  });

  it('always allows part payments on a manual charge', async () => {
    const charge = await manualInvoice(150_000);
    await pay(charge.id, 50_000).expect(201);
    expect(await invoiceOf(charge.id)).toMatchObject({
      status: 'PARTIALLY_PAID',
      balanceMinor: 100_000,
      membershipId: null,
    });
  });

  it('rejects an overpayment (400) and any payment on a paid invoice', async () => {
    const { invoice } = await assign();
    const over = await pay(invoice!.id, 450_001);
    expect(over.status).toBe(400);
    expect(over.body.error).toMatchObject({ code: 'OVERPAYMENT', balanceMinor: 450_000 });
    await pay(invoice!.id, 450_000).expect(201);
    const again = await pay(invoice!.id, 1);
    expect(again.status).toBe(400);
    expect(again.body.error).toMatchObject({ code: 'OVERPAYMENT', balanceMinor: 0 });
  });

  it('never completes an ONLINE payment: the API refuses it and the database forbids it', async () => {
    const { invoice } = await assign();
    const res = await pay(invoice!.id, 450_000, { method: 'ONLINE' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ONLINE_PAYMENT_NOT_CONFIGURED');
    await expect(
      db.insert(payments).values({
        invoiceId: invoice!.id,
        memberId: member.id,
        amountMinor: 450_000,
        method: 'ONLINE',
        status: 'COMPLETED',
        receivedAt: new Date(),
      }),
    ).rejects.toThrow();
    expect(await db.select().from(payments)).toHaveLength(0);
  });

  it('validates the method reference, amounts and future receipt times', async () => {
    const { invoice } = await assign();
    const noReference = await pay(invoice!.id, 450_000, { method: 'BANK_TRANSFER' });
    expect(noReference.status).toBe(400);
    expect(noReference.body.error.details[0].path).toBe('reference');
    expect((await pay(invoice!.id, 0)).status).toBe(400);
    expect((await pay(invoice!.id, 12.5)).status).toBe(400);
    const future = await pay(invoice!.id, 450_000, {
      receivedAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(future.status).toBe(400);
    expect((await pay(randomUUID(), 1_000)).status).toBe(404);
  });

  it('does not let a Trainer or a Member record or read staff payments', async () => {
    const { invoice } = await assign();
    const trainer = await signIn(app, await createUser({ role: 'TRAINER' }));
    for (const s of [trainer, memberSession]) {
      expect(
        (await as(s).post('/payments', { invoiceId: invoice!.id, amountMinor: 1, method: 'CASH' }))
          .status,
      ).toBe(403);
      expect((await as(s).get('/payments')).status).toBe(403);
      expect((await as(s).get('/invoices')).status).toBe(403);
    }
  });
});

describe('refunds (scenario 10)', () => {
  async function paidMembership() {
    const { invoice } = await assign();
    const payment = (await pay(invoice!.id, 450_000).expect(201)).body as {
      id: string;
      receiptNumber: string;
    };
    return { invoice: invoice!, payment };
  }

  it('recomputes the invoice and leaves the payment row untouched', async () => {
    const { invoice, payment } = await paidMembership();
    const [before] = await db.select().from(payments).where(eq(payments.id, payment.id));

    const partial = await as(manager).post(`/payments/${payment.id}/refunds`, {
      amountMinor: 150_000,
      reason: 'Charged for a week the gym was closed',
      method: 'CASH',
    });
    expect(partial.status, JSON.stringify(partial.body)).toBe(201);
    expect(partial.body).toMatchObject({
      amountMinor: 450_000,
      refundedMinor: 150_000,
      refundableMinor: 300_000,
      status: 'COMPLETED',
    });
    expect(await invoiceOf(invoice.id)).toMatchObject({
      status: 'PARTIALLY_PAID',
      paidMinor: 450_000,
      refundedMinor: 150_000,
      balanceMinor: 150_000,
    });
    const [after] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(after).toEqual(before);

    await as(adminSession)
      .post(`/payments/${payment.id}/refunds`, {
        amountMinor: 300_000,
        reason: 'Membership cancelled on request',
        method: 'BANK_TRANSFER',
      })
      .expect(201);
    const detail = await invoiceOf(invoice.id);
    expect(detail).toMatchObject({ status: 'REFUNDED', balanceMinor: 450_000 });
    expect(detail.refunds.map((r: { refundNumber: string }) => r.refundNumber)).toEqual([
      expect.stringMatching(/^RFD-\d{6}$/),
      expect.stringMatching(/^RFD-\d{6}$/),
    ]);
    expect(await auditOf('REFUND_ISSUED')).toHaveLength(2);

    const receipt = await desk().get(`/payments/${payment.id}/receipt`);
    expect(receipt.body.refunds).toHaveLength(2);
    const list = await desk().get('/refunds');
    expect(list.body.total).toBe(2);
  });

  it('rejects a refund above what is left on the payment (400)', async () => {
    const { payment } = await paidMembership();
    const res = await as(manager).post(`/payments/${payment.id}/refunds`, {
      amountMinor: 450_001,
      reason: 'Too much',
      method: 'CASH',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'REFUND_EXCEEDS_PAYMENT',
      refundableMinor: 450_000,
    });
    expect(await db.select().from(refunds)).toHaveLength(0);
  });

  it('refuses refunds from the Receptionist and refunds made "online"', async () => {
    const { payment } = await paidMembership();
    const body = { amountMinor: 1_000, reason: 'Goodwill', method: 'CASH' };
    expect((await desk().post(`/payments/${payment.id}/refunds`, body)).status).toBe(403);
    const online = await as(manager).post(`/payments/${payment.id}/refunds`, {
      ...body,
      method: 'ONLINE',
    });
    expect(online.status).toBe(400);
  });
});

describe('void', () => {
  it('voids an unpaid invoice with a reason and keeps it from taking money', async () => {
    const charge = await manualInvoice(80_000);
    expect(
      (await desk().post(`/invoices/${charge.id}/void`, { reason: 'Entered twice' })).status,
    ).toBe(403);
    const res = await as(manager).post(`/invoices/${charge.id}/void`, { reason: 'Entered twice' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'VOID',
      voidReason: 'Entered twice',
      voidedByName: expect.stringContaining('Omar'),
    });
    expect(await auditOf('INVOICE_VOIDED', charge.id)).toHaveLength(1);

    const again = await as(manager).post(`/invoices/${charge.id}/void`, { reason: 'Again' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVOICE_VOID');
    const payment = await pay(charge.id, 80_000);
    expect(payment.status).toBe(409);
    expect(payment.body.error.code).toBe('INVOICE_VOID');
  });

  it('requires money held on the invoice to be refunded first', async () => {
    const charge = await manualInvoice(80_000);
    const payment = (await pay(charge.id, 30_000).expect(201)).body;
    const blocked = await as(manager).post(`/invoices/${charge.id}/void`, {
      reason: 'Wrong member',
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('INVOICE_HAS_PAYMENTS');
    await as(manager)
      .post(`/payments/${payment.id}/refunds`, {
        amountMinor: 30_000,
        reason: 'Wrong member',
        method: 'CASH',
      })
      .expect(201);
    await as(manager).post(`/invoices/${charge.id}/void`, { reason: 'Wrong member' }).expect(200);
  });
});

describe('cancelling a membership and its invoice', () => {
  const cancel = (id: string, body: object) =>
    as(manager).post(`/memberships/${id}/cancel`, { reason: 'Moved to another city', ...body });

  it('voids the unpaid invoice when asked, in the same change', async () => {
    const membership = await assign();
    await desk().post(`/memberships/${membership.id}/activate`).expect(200);
    const res = await cancel(membership.id, { voidUnpaidInvoice: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'CANCELLED', invoice: { status: 'VOID' } });

    expect(await invoiceOf(membership.invoice!.id)).toMatchObject({
      status: 'VOID',
      voidReason: 'Membership cancelled: Moved to another city',
      voidedByName: expect.stringContaining('Omar'),
    });
    expect(await auditOf('INVOICE_VOIDED', membership.invoice!.id)).toHaveLength(1);
    const events = (await as(manager).get(`/memberships/${membership.id}/events`)).body.data;
    expect(events[0]).toMatchObject({
      eventType: 'CANCELLED',
      newValues: { voidedInvoice: membership.invoice!.invoiceNumber },
    });
    const owed = (await desk().get(`/members/${member.id}/invoices`)).body.summary;
    expect(owed).toEqual({ outstandingMinor: 0, overdueMinor: 0 });
  });

  it('leaves the invoice owed by default', async () => {
    const membership = await assign();
    const res = await cancel(membership.id, {});
    expect(res.status).toBe(200);
    expect(res.body.invoice).toMatchObject({ status: 'PENDING', balanceMinor: 450_000 });
    expect(await auditOf('INVOICE_VOIDED')).toHaveLength(0);
    const events = (await as(manager).get(`/memberships/${membership.id}/events`)).body.data;
    expect(events[0].newValues).not.toHaveProperty('voidedInvoice');
  });

  it('keeps an invoice that holds money, and still cancels', async () => {
    const membership = await assign(partialPlan.id);
    await pay(membership.invoice!.id, 200_000).expect(201);
    const res = await cancel(membership.id, { voidUnpaidInvoice: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'CANCELLED',
      invoice: { status: 'PARTIALLY_PAID', balanceMinor: 1_000_000 },
    });
    expect(await auditOf('INVOICE_VOIDED')).toHaveLength(0);
  });

  it('leaves an invoice that is already void alone', async () => {
    const membership = await assign();
    await as(manager)
      .post(`/invoices/${membership.invoice!.id}/void`, { reason: 'Billed by mistake' })
      .expect(200);
    await cancel(membership.id, { voidUnpaidInvoice: true }).expect(200);
    expect(await invoiceOf(membership.invoice!.id)).toMatchObject({
      voidReason: 'Billed by mistake',
    });
    expect(await auditOf('INVOICE_VOIDED')).toHaveLength(1);
  });

  it('a refused cancellation leaves the invoice open', async () => {
    const membership = await assign();
    const stale = await cancel(membership.id, { voidUnpaidInvoice: true, version: 99 });
    expect(stale.status).toBe(409);
    expect(await invoiceOf(membership.invoice!.id)).toMatchObject({ status: 'PENDING' });
  });
});

describe('overdue', () => {
  it('shows OVERDUE after the due date and the job stores it; part-paid stays PARTIALLY_PAID', async () => {
    const late = await manualInvoice(60_000, addDays(today, -1));
    const partLate = await manualInvoice(60_000, addDays(today, -2));
    const notYet = await manualInvoice(60_000, today);
    await pay(partLate.id, 10_000).expect(201);

    // Read-time status is already right before the job runs.
    expect((await invoiceOf(late.id)).status).toBe('OVERDUE');
    expect((await desk().get('/invoices?status=OVERDUE')).body.total).toBe(1);

    // A back-dated invoice is stored OVERDUE as soon as it is created (status is always
    // recalculated, PLAN §3.4). Make the stored copy stale, as it is for an invoice created
    // before its due date passed, so the job has one row to catch up.
    const [created] = await db.select().from(invoices).where(eq(invoices.id, late.id));
    expect(created!.status).toBe('OVERDUE');
    await db.update(invoices).set({ status: 'PENDING' }).where(eq(invoices.id, late.id));

    expect(await markOverdue(today)).toEqual({ ran: true, marked: 1 });
    const stored = await db.select().from(invoices);
    const statusOf = (id: string) => stored.find((row) => row.id === id)!.status;
    expect(statusOf(late.id)).toBe('OVERDUE');
    expect(statusOf(partLate.id)).toBe('PARTIALLY_PAID');
    expect(statusOf(notYet.id)).toBe('PENDING');
    expect(await markOverdue(today)).toEqual({ ran: true, marked: 0 });
    // 60_000 + 50_000 left on the part-paid one + 60_000; only the unpaid late one is overdue.
    expect((await desk().get(`/members/${member.id}/invoices`)).body.summary).toEqual({
      outstandingMinor: 170_000,
      overdueMinor: 60_000,
    });

    // Tomorrow the invoice due today is overdue too.
    expect(await markOverdue(addDays(today, 1))).toEqual({ ran: true, marked: 1 });
    const [marked] = await db.select().from(invoices).where(eq(invoices.id, notYet.id));
    expect(marked!.status).toBe('OVERDUE');
  });

  it('paying an overdue invoice in full marks it PAID', async () => {
    const late = await manualInvoice(60_000, addDays(today, -5));
    await markOverdue(today);
    await pay(late.id, 60_000).expect(201);
    expect((await invoiceOf(late.id)).status).toBe('PAID');
  });
});

describe('lists, search and date filters', () => {
  it('finds payments by receipt number and by received day', async () => {
    const charge = await manualInvoice(300_000);
    const first = (
      await pay(charge.id, 100_000, {
        receivedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      }).expect(201)
    ).body;
    const second = (await pay(charge.id, 100_000).expect(201)).body;

    const byReceipt = await desk().get(`/payments?q=${second.receiptNumber}`);
    expect(byReceipt.body.data.map((p: { id: string }) => p.id)).toEqual([second.id]);
    const byName = await desk().get('/payments?q=hamza');
    expect(byName.body.total).toBe(2);
    const todayOnly = await desk().get(`/payments?from=${today}&to=${today}`);
    expect(todayOnly.body.data.map((p: { id: string }) => p.id)).toEqual([second.id]);
    const older = await desk().get(`/payments?to=${addDays(today, -1)}`);
    expect(older.body.data.map((p: { id: string }) => p.id)).toEqual([first.id]);
    expect((await desk().get('/payments?method=CARD')).body.total).toBe(0);
  });

  it('filters invoices by status, due date and search text', async () => {
    const { invoice } = await assign();
    const charge = await manualInvoice(20_000, addDays(today, 30));
    expect((await desk().get('/invoices?status=PENDING')).body.total).toBe(2);
    expect((await desk().get(`/invoices?from=${addDays(today, 1)}`)).body.data[0].id).toBe(
      charge.id,
    );
    expect((await desk().get('/invoices?q=locker')).body.data[0].id).toBe(charge.id);
    expect(
      (await desk().get(`/invoices?q=${invoice!.invoiceNumber}`)).body.data.map(
        (row: { id: string }) => row.id,
      ),
    ).toEqual([invoice!.id]);
    expect((await desk().get('/invoices?status=PAID')).body.total).toBe(0);
  });
});

describe('concurrency', () => {
  it('parallel payments never take more than the balance', async () => {
    const charge = await manualInvoice(100_000);
    const results = await Promise.all(Array.from({ length: 5 }, () => pay(charge.id, 40_000)));
    const statuses = results.map((res) => res.status).sort();
    expect(statuses).toEqual([201, 201, 400, 400, 400]);
    const detail = await invoiceOf(charge.id);
    expect(detail).toMatchObject({ paidMinor: 80_000, balanceMinor: 20_000 });
  });

  it('parallel refunds never add up to more than the payment', async () => {
    const charge = await manualInvoice(100_000);
    const payment = (await pay(charge.id, 100_000).expect(201)).body;
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        as(manager).post(`/payments/${payment.id}/refunds`, {
          amountMinor: 30_000,
          reason: `Refund attempt ${i + 1}`,
          method: 'CASH',
        }),
      ),
    );
    expect(results.map((res) => res.status).sort()).toEqual([201, 201, 201, 400, 400]);
    const [sum] = await db
      .select({ total: sql<number>`sum(${refunds.amountMinor})`.mapWith(Number) })
      .from(refunds);
    expect(sum!.total).toBe(90_000);
    expect(await invoiceOf(charge.id)).toMatchObject({
      status: 'PARTIALLY_PAID',
      balanceMinor: 90_000,
    });
  });
});

describe('billing rows are protected by the database', () => {
  it('rejects deleting or rewriting invoices, payments and refunds', async () => {
    const charge = await manualInvoice(50_000);
    const payment = (await pay(charge.id, 50_000).expect(201)).body;
    await as(manager)
      .post(`/payments/${payment.id}/refunds`, {
        amountMinor: 1_000,
        reason: 'Test',
        method: 'CASH',
      })
      .expect(201);

    await expect(db.execute(sql`delete from invoices where id = ${charge.id}`)).rejects.toThrow();
    await expect(
      db.execute(sql`update invoices set amount_due_minor = 1 where id = ${charge.id}`),
    ).rejects.toThrow();
    await expect(db.execute(sql`delete from payments where id = ${payment.id}`)).rejects.toThrow();
    await expect(
      db.execute(sql`update payments set amount_minor = 1 where id = ${payment.id}`),
    ).rejects.toThrow();
    await expect(db.execute(sql`update refunds set amount_minor = 2`)).rejects.toThrow();
    await expect(db.execute(sql`delete from refunds`)).rejects.toThrow();
  });
});

describe('require full payment before activation (scenario 3, C1)', () => {
  const setC1 = (s: Session, value: boolean) =>
    as(s).patch('/settings', {
      requireFullPaymentBeforeActivation: value,
      reason: 'Billing policy',
    });

  it('only the Admin can change it, and every change is audited with old and new values', async () => {
    const trainer = await signIn(app, await createUser({ role: 'TRAINER' }));
    for (const s of [manager, receptionist, trainer, memberSession]) {
      expect((await setC1(s, true)).status).toBe(403);
    }
    const on = await setC1(adminSession, true);
    expect(on.status).toBe(200);
    expect(on.body.requireFullPaymentBeforeActivation).toBe(true);
    await setC1(adminSession, false).expect(200);

    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'SETTINGS_CHANGED'))
      .orderBy(auditLogs.createdAt);
    expect(rows.map((row) => [row.before, row.after])).toEqual([
      [{ requireFullPaymentBeforeActivation: false }, { requireFullPaymentBeforeActivation: true }],
      [{ requireFullPaymentBeforeActivation: true }, { requireFullPaymentBeforeActivation: false }],
    ]);
  });

  it('OFF (default): activation succeeds with an unpaid or part-paid invoice', async () => {
    const unpaid = await assign();
    const res = await desk().post(`/memberships/${unpaid.id}/activate`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ACTIVE', invoice: { balanceMinor: 450_000 } });
  });

  it('ON: activation is refused (409 PAYMENT_REQUIRED) until the invoice is PAID', async () => {
    await setC1(adminSession, true).expect(200);
    const membership = await assign(partialPlan.id);
    const blocked = await desk().post(`/memberships/${membership.id}/activate`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatchObject({
      code: 'PAYMENT_REQUIRED',
      outstandingMinor: 1_200_000,
      invoiceId: membership.invoice!.id,
    });

    await pay(membership.invoice!.id, 200_000).expect(201);
    const stillBlocked = await desk().post(`/memberships/${membership.id}/activate`);
    expect(stillBlocked.status).toBe(409);
    expect(stillBlocked.body.error.outstandingMinor).toBe(1_000_000);

    await pay(membership.invoice!.id, 1_000_000).expect(201);
    const activated = await desk().post(`/memberships/${membership.id}/activate`);
    expect(activated.status).toBe(200);
    expect(activated.body).toMatchObject({ status: 'ACTIVE', invoice: { status: 'PAID' } });
  });

  it('ON: a renewal starts PENDING and activates only once paid', async () => {
    const current = await assign();
    await pay(current.invoice!.id, 450_000).expect(201);
    await desk().post(`/memberships/${current.id}/activate`).expect(200);
    await setC1(adminSession, true).expect(200);

    const renewal = await desk().post(`/memberships/${current.id}/renew`);
    expect(renewal.status).toBe(201);
    expect(renewal.body).toMatchObject({ status: 'PENDING', invoice: { status: 'PENDING' } });
    const blocked = await desk().post(`/memberships/${renewal.body.id}/activate`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PAYMENT_REQUIRED');

    await pay(renewal.body.invoice.id, 450_000).expect(201);
    await desk().post(`/memberships/${renewal.body.id}/activate`).expect(200);
  });

  it('ON: a free plan needs no payment', async () => {
    await setC1(adminSession, true).expect(200);
    const free = await createPlan({ name: 'Staff Family Pass', priceMinor: 0 });
    const membership = await assign(free.id);
    await desk().post(`/memberships/${membership.id}/activate`).expect(200);
  });

  it('an outstanding balance never changes the access decision', async () => {
    await setC1(adminSession, true).expect(200);
    await createMembership(member, strictPlan, {
      startDate: addDays(today, -10),
      endDate: addDays(today, 20),
    });
    await manualInvoice(90_000, addDays(today, -5));
    await markOverdue(today);
    const scanner = await createDevice();
    await enrollMember(member, scanner.device, 'SIM-0042', admin);
    const scan = await request(app)
      .post('/api/v1/access/scan')
      .set('Authorization', scanner.authorization)
      .send({
        eventId: randomUUID(),
        matchResult: 'MATCH',
        templateRef: 'SIM-0042',
        occurredAt: new Date().toISOString(),
      });
    expect(scan.status).toBe(200);
    expect(scan.body.decision).toBe('GRANTED');
  });
});
