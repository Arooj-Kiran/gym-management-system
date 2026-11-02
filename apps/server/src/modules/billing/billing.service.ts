import {
  addDays,
  BILLING_LIMITS,
  computeInvoiceStatus,
  ERROR_CODES,
  invoiceBalanceMinor,
  invoiceDueDate,
  refundableMinor,
  type createInvoiceSchema,
  type InvoiceDetailDto,
  type InvoiceDto,
  type InvoiceStatus,
  type invoiceListQuerySchema,
  type MembershipInvoiceBrief,
  type MyBillingSummary,
  type MyInvoiceDto,
  type MyPaymentDto,
  type myBillingQuerySchema,
  type PaymentDto,
  type paymentListQuerySchema,
  type ReceiptDto,
  type recordPaymentSchema,
  type RefundDto,
  type refundListQuerySchema,
  type refundPaymentSchema,
} from '@gms/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { config } from '../../config/env';
import { db, type DbExecutor } from '../../db/client';
import {
  invoices,
  members,
  membershipPlans,
  memberships,
  payments,
  refunds,
  users,
} from '../../db/schema';
import { recordAudit } from '../../lib/audit';
import { gymDayStart, gymToday } from '../../lib/dates';
import { AppError, conflict, notFound, validationFailed } from '../../lib/errors';
import { likePattern, pageOffset, paginated } from '../../lib/pagination';
import type { RequestContext } from '../../lib/request-context';
import { qualified } from '../memberships/current-membership';
import { loadSettingsRow } from '../settings/settings.service';

type CreateInvoice = z.output<typeof createInvoiceSchema>;
type RecordPayment = z.output<typeof recordPaymentSchema>;
type RefundPayment = z.output<typeof refundPaymentSchema>;
type InvoiceListQuery = z.output<typeof invoiceListQuerySchema>;
type PaymentListQuery = z.output<typeof paymentListQuerySchema>;
type RefundListQuery = z.output<typeof refundListQuerySchema>;
type MyBillingQuery = z.output<typeof myBillingQuerySchema>;
type InvoiceRow = typeof invoices.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;
type MembershipRow = typeof memberships.$inferSelect;

/** Invoices that still expect money. */
export const OPEN_INVOICE_STATUSES = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] as const;

// --- Amounts --------------------------------------------------------------------------------
// Sums are computed from the payment and refund rows every time; the stored invoice status is a
// copy kept for indexes and filters, rewritten in the same transaction as every money movement.
// Outer columns are table-qualified: a bare "id" inside these subqueries would bind to p/r.

/** Σ completed payments on the invoice in the current query row. */
export const invoicePaidSql = sql<number>`coalesce((
    select sum(p.amount_minor) from payments p
    where p.invoice_id = ${qualified(invoices.id)} and p.status = 'COMPLETED'
  ), 0)::bigint`.mapWith(Number);

/** Σ refunds of the invoice's payments. */
export const invoiceRefundedSql = sql<number>`coalesce((
    select sum(r.amount_minor) from refunds r
    join payments p on p.id = r.payment_id
    where p.invoice_id = ${qualified(invoices.id)}
  ), 0)::bigint`.mapWith(Number);

const paymentRefundedSql = sql<number>`coalesce((
    select sum(r.amount_minor) from refunds r where r.payment_id = ${qualified(payments.id)}
  ), 0)::bigint`.mapWith(Number);

/**
 * The status as of today. A PENDING invoice whose due date passed is OVERDUE even before the
 * nightly job rewrites the stored copy.
 */
export function effectiveInvoiceStatusSql(today: string) {
  return sql<InvoiceStatus>`case
    when ${invoices.status} = 'PENDING' and ${invoices.dueDate} < ${today}::date then 'OVERDUE'
    else ${invoices.status}::text end`;
}

interface Totals {
  paidMinor: number;
  refundedMinor: number;
}

async function invoiceTotals(executor: DbExecutor, invoiceId: string): Promise<Totals> {
  const [row] = await executor
    .select({ paidMinor: invoicePaidSql, refundedMinor: invoiceRefundedSql })
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  return row ?? { paidMinor: 0, refundedMinor: 0 };
}

const amountsOf = (
  row: Pick<InvoiceRow, 'amountDueMinor' | 'dueDate' | 'voidedAt'>,
  totals: Totals,
) => ({
  amountDueMinor: row.amountDueMinor,
  paidMinor: totals.paidMinor,
  refundedMinor: totals.refundedMinor,
  dueDate: row.dueDate,
  voided: row.voidedAt !== null,
});

/** Recomputes the stored status from the rows (call with the invoice locked). */
async function refreshInvoiceStatus(tx: DbExecutor, invoice: InvoiceRow, today = gymToday()) {
  const totals = await invoiceTotals(tx, invoice.id);
  const status = computeInvoiceStatus(amountsOf(invoice, totals), today);
  if (status !== invoice.status) {
    await tx.update(invoices).set({ status }).where(eq(invoices.id, invoice.id));
  }
  return { status, ...totals, balanceMinor: invoiceBalanceMinor(amountsOf(invoice, totals)) };
}

/** Serializes every payment, refund and void on one invoice. */
async function lockInvoice(tx: DbExecutor, id: string) {
  const [row] = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1).for('update');
  if (!row) throw notFound('Invoice');
  return row;
}

// --- DTOs -----------------------------------------------------------------------------------

const voider = alias(users, 'voider');
const creator = alias(users, 'creator');
const recorder = alias(users, 'recorder');

const fullName = (first: string | null, last: string | null) =>
  first ? `${first} ${last ?? ''}`.trim() : null;

const memberRefColumns = {
  memberCode: members.memberCode,
  memberFirstName: members.firstName,
  memberLastName: members.lastName,
};

function selectInvoices(executor: DbExecutor) {
  return executor
    .select({
      ...getTableColumns(invoices),
      ...memberRefColumns,
      paidMinor: invoicePaidSql,
      refundedMinor: invoiceRefundedSql,
      // A manual charge may always be paid in parts; a membership follows its plan (PLAN §3.4).
      allowPartialPayment: sql<boolean>`(${invoices.membershipId} is null or coalesce(${membershipPlans.allowPartialPayment}, false))`,
      voidedByFirstName: voider.firstName,
      voidedByLastName: voider.lastName,
      createdByFirstName: creator.firstName,
      createdByLastName: creator.lastName,
    })
    .from(invoices)
    .innerJoin(members, eq(members.id, invoices.memberId))
    .leftJoin(memberships, eq(memberships.id, invoices.membershipId))
    .leftJoin(membershipPlans, eq(membershipPlans.id, memberships.planId))
    .leftJoin(voider, eq(voider.id, invoices.voidedBy))
    .leftJoin(creator, eq(creator.id, invoices.createdBy));
}

type InvoiceSelectRow = Awaited<ReturnType<ReturnType<typeof selectInvoices>['execute']>>[number];

function toInvoiceDto(row: InvoiceSelectRow, today: string): InvoiceDto {
  const amounts = amountsOf(row, row);
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    member: {
      id: row.memberId,
      memberCode: row.memberCode,
      firstName: row.memberFirstName,
      lastName: row.memberLastName,
    },
    membershipId: row.membershipId,
    description: row.description,
    amountDueMinor: row.amountDueMinor,
    paidMinor: row.paidMinor,
    refundedMinor: row.refundedMinor,
    balanceMinor: invoiceBalanceMinor(amounts),
    dueDate: row.dueDate,
    status: computeInvoiceStatus(amounts, today),
    allowPartialPayment: Boolean(row.allowPartialPayment),
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidedByName: fullName(row.voidedByFirstName, row.voidedByLastName),
    voidReason: row.voidReason,
    createdByName: fullName(row.createdByFirstName, row.createdByLastName),
    createdAt: row.createdAt.toISOString(),
  };
}

function selectPayments(executor: DbExecutor) {
  return executor
    .select({
      ...getTableColumns(payments),
      ...memberRefColumns,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDescription: invoices.description,
      refundedMinor: paymentRefundedSql,
      recordedByFirstName: recorder.firstName,
      recordedByLastName: recorder.lastName,
    })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .innerJoin(members, eq(members.id, payments.memberId))
    .leftJoin(recorder, eq(recorder.id, payments.recordedBy));
}

type PaymentSelectRow = Awaited<ReturnType<ReturnType<typeof selectPayments>['execute']>>[number];

function toPaymentDto(row: PaymentSelectRow): PaymentDto {
  return {
    id: row.id,
    receiptNumber: row.receiptNumber,
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoiceNumber,
    invoiceDescription: row.invoiceDescription,
    member: {
      id: row.memberId,
      memberCode: row.memberCode,
      firstName: row.memberFirstName,
      lastName: row.memberLastName,
    },
    amountMinor: row.amountMinor,
    refundedMinor: row.refundedMinor,
    refundableMinor:
      row.status === 'COMPLETED'
        ? refundableMinor({ amountMinor: row.amountMinor, refundedMinor: row.refundedMinor })
        : 0,
    method: row.method,
    reference: row.reference,
    status: row.status,
    receivedAt: row.receivedAt.toISOString(),
    recordedByName: fullName(row.recordedByFirstName, row.recordedByLastName),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

function selectRefunds(executor: DbExecutor) {
  return executor
    .select({
      ...getTableColumns(refunds),
      ...memberRefColumns,
      memberId: payments.memberId,
      receiptNumber: payments.receiptNumber,
      invoiceId: payments.invoiceId,
      invoiceNumber: invoices.invoiceNumber,
      recordedByFirstName: recorder.firstName,
      recordedByLastName: recorder.lastName,
    })
    .from(refunds)
    .innerJoin(payments, eq(payments.id, refunds.paymentId))
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .innerJoin(members, eq(members.id, payments.memberId))
    .leftJoin(recorder, eq(recorder.id, refunds.recordedBy));
}

type RefundSelectRow = Awaited<ReturnType<ReturnType<typeof selectRefunds>['execute']>>[number];

function toRefundDto(row: RefundSelectRow): RefundDto {
  return {
    id: row.id,
    refundNumber: row.refundNumber,
    paymentId: row.paymentId,
    receiptNumber: row.receiptNumber,
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoiceNumber,
    member: {
      id: row.memberId,
      memberCode: row.memberCode,
      firstName: row.memberFirstName,
      lastName: row.memberLastName,
    },
    amountMinor: row.amountMinor,
    reason: row.reason,
    method: row.method,
    refundedAt: row.refundedAt.toISOString(),
    recordedByName: fullName(row.recordedByFirstName, row.recordedByLastName),
  };
}

async function readInvoice(executor: DbExecutor, id: string) {
  const [row] = await selectInvoices(executor).where(eq(invoices.id, id)).limit(1);
  if (!row) throw notFound('Invoice');
  return toInvoiceDto(row, gymToday());
}

async function readPayment(executor: DbExecutor, id: string) {
  const [row] = await selectPayments(executor).where(eq(payments.id, id)).limit(1);
  if (!row) throw notFound('Payment');
  return toPaymentDto(row);
}

// --- Membership invoices (used by the memberships and portal modules) -----------------------

/** Columns to add to a memberships query that LEFT JOINs `invoices` on `membership_id`. */
export const membershipInvoiceColumns = {
  invoiceId: invoices.id,
  invoiceNumber: invoices.invoiceNumber,
  invoiceStatus: invoices.status,
  invoiceAmountDueMinor: invoices.amountDueMinor,
  invoiceDueDate: invoices.dueDate,
  invoiceVoidedAt: invoices.voidedAt,
  invoicePaidMinor: invoicePaidSql,
  invoiceRefundedMinor: invoiceRefundedSql,
};

export const joinMembershipInvoice = eq(invoices.membershipId, memberships.id);

export interface MembershipInvoiceColumns {
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: InvoiceStatus | null;
  invoiceAmountDueMinor: number | null;
  invoiceDueDate: string | null;
  invoiceVoidedAt: Date | null;
  invoicePaidMinor: number;
  invoiceRefundedMinor: number;
}

/** The membership's invoice for cards and the portal; null for a free plan. */
export function toInvoiceBrief(
  row: MembershipInvoiceColumns,
  today: string,
): MembershipInvoiceBrief | null {
  if (!row.invoiceId || row.invoiceAmountDueMinor === null || !row.invoiceDueDate) return null;
  const amounts = {
    amountDueMinor: row.invoiceAmountDueMinor,
    paidMinor: row.invoicePaidMinor,
    refundedMinor: row.invoiceRefundedMinor,
    dueDate: row.invoiceDueDate,
    voided: row.invoiceVoidedAt !== null,
  };
  return {
    id: row.invoiceId,
    invoiceNumber: row.invoiceNumber!,
    status: computeInvoiceStatus(amounts, today),
    amountDueMinor: row.invoiceAmountDueMinor,
    balanceMinor: invoiceBalanceMinor(amounts),
    dueDate: row.invoiceDueDate,
  };
}

/**
 * Bills a new membership period inside the caller's transaction (assign and renew). A free plan
 * (price 0) creates no invoice: there is nothing to collect.
 */
export async function createMembershipInvoice(
  tx: DbExecutor,
  ctx: RequestContext,
  membership: MembershipRow,
  invoiceDueDays: number,
) {
  if (membership.priceMinorSnapshot <= 0) return null;
  const today = gymToday();
  const dueDate = invoiceDueDate(membership.startDate, invoiceDueDays);
  const description =
    `${membership.planNameSnapshot} membership, ${membership.startDate} to ${membership.endDate}`.slice(
      0,
      BILLING_LIMITS.descriptionMax,
    );
  const status = computeInvoiceStatus(
    {
      amountDueMinor: membership.priceMinorSnapshot,
      paidMinor: 0,
      refundedMinor: 0,
      dueDate,
      voided: false,
    },
    today,
  );
  const [created] = await tx
    .insert(invoices)
    .values({
      memberId: membership.memberId,
      membershipId: membership.id,
      description,
      amountDueMinor: membership.priceMinorSnapshot,
      dueDate,
      status,
      createdBy: ctx.actorUserId,
    })
    .returning();
  await recordAudit(tx, ctx, {
    action: 'INVOICE_CREATED',
    entityType: 'INVOICE',
    entityId: created!.id,
    after: {
      invoiceNumber: created!.invoiceNumber,
      memberId: created!.memberId,
      membershipId: created!.membershipId,
      amountDueMinor: created!.amountDueMinor,
      dueDate,
      status,
    },
  });
  return created!;
}

/**
 * C1 (PLAN §3.3): with "require full payment before activation" ON, a membership is activated
 * only once its invoice is PAID. Call inside the activation transaction; the invoice row is
 * locked so a refund cannot slip in between the check and the commit.
 */
export async function assertMembershipPaid(tx: DbExecutor, membership: MembershipRow) {
  const [invoice] = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.membershipId, membership.id))
    .limit(1)
    .for('update');
  if (!invoice) {
    if (membership.priceMinorSnapshot <= 0) return;
    throw conflict(
      ERROR_CODES.PAYMENT_REQUIRED,
      'This membership has no invoice, so it cannot be paid. Cancel it and assign the plan again.',
      { outstandingMinor: membership.priceMinorSnapshot, invoiceId: null },
    );
  }
  const totals = await invoiceTotals(tx, invoice.id);
  const amounts = amountsOf(invoice, totals);
  const status = computeInvoiceStatus(amounts, gymToday());
  if (status === 'PAID') return;
  const outstandingMinor =
    status === 'VOID' ? invoice.amountDueMinor : invoiceBalanceMinor(amounts);
  throw conflict(
    ERROR_CODES.PAYMENT_REQUIRED,
    status === 'VOID'
      ? `Invoice ${invoice.invoiceNumber} was voided. Full payment is required before activation, so cancel this membership and assign the plan again.`
      : `Full payment is required before activation. ${invoice.invoiceNumber} still has an outstanding balance.`,
    { outstandingMinor, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
  );
}

/** Whether C1 is on, read inside the caller's transaction. */
export async function fullPaymentRequired(tx: DbExecutor) {
  return (await loadSettingsRow(tx)).requireFullPaymentBeforeActivation;
}

// --- Invoices -------------------------------------------------------------------------------

function invoiceStatusFilter(status: InvoiceStatus, today: string): SQL | undefined {
  if (status === 'OVERDUE') {
    return or(
      eq(invoices.status, 'OVERDUE'),
      and(eq(invoices.status, 'PENDING'), lt(invoices.dueDate, today)),
    );
  }
  if (status === 'PENDING')
    return and(eq(invoices.status, 'PENDING'), gte(invoices.dueDate, today));
  return eq(invoices.status, status);
}

function memberSearch(q: string, ...extra: SQL[]) {
  const pattern = likePattern(q);
  return or(
    ilike(sql`${members.firstName} || ' ' || ${members.lastName}`, pattern),
    ilike(members.memberCode, pattern),
    ...extra.map((column) => ilike(column, pattern)),
  );
}

export async function listInvoices(query: InvoiceListQuery, fixed: { memberId?: string } = {}) {
  const today = gymToday();
  const filters: (SQL | undefined)[] = [];
  const memberId = fixed.memberId ?? query.memberId;
  if (memberId) filters.push(eq(invoices.memberId, memberId));
  if (query.status) filters.push(invoiceStatusFilter(query.status, today));
  if (query.from) filters.push(gte(invoices.dueDate, query.from));
  if (query.to) filters.push(lte(invoices.dueDate, query.to));
  if (query.q) {
    filters.push(
      memberSearch(query.q, sql`${invoices.invoiceNumber}`, sql`${invoices.description}`),
    );
  }
  const where = and(...filters);
  const direction = query.order === 'asc' ? asc : desc;

  const [rows, [totals]] = await Promise.all([
    selectInvoices(db)
      .where(where)
      .orderBy(direction(invoices.createdAt), desc(invoices.invoiceNumber))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db
      .select({ total: count() })
      .from(invoices)
      .innerJoin(members, eq(members.id, invoices.memberId))
      .where(where),
  ]);
  return paginated(
    rows.map((row) => toInvoiceDto(row, today)),
    query.page,
    query.pageSize,
    totals?.total ?? 0,
  );
}

export async function getInvoice(id: string): Promise<InvoiceDetailDto> {
  const invoice = await readInvoice(db, id);
  const [paymentRows, refundRows] = await Promise.all([
    selectPayments(db).where(eq(payments.invoiceId, id)).orderBy(asc(payments.receivedAt)),
    selectRefunds(db).where(eq(payments.invoiceId, id)).orderBy(asc(refunds.refundedAt)),
  ]);
  return {
    ...invoice,
    payments: paymentRows.map(toPaymentDto),
    refunds: refundRows.map(toRefundDto),
  };
}

/** A charge that is not a membership period (locker, towel, a personal-training block…). */
export async function createInvoice(
  input: CreateInvoice,
  ctx: RequestContext,
): Promise<InvoiceDto> {
  const today = gymToday();
  const dueDate = input.dueDate ?? today;
  const earliest = addDays(today, -BILLING_LIMITS.maxDueAdvanceDays);
  const latest = addDays(today, BILLING_LIMITS.maxDueAdvanceDays);
  if (dueDate < earliest || dueDate > latest) {
    throw validationFailed([
      { path: 'dueDate', message: `Choose a due date between ${earliest} and ${latest}` },
    ]);
  }
  return db.transaction(async (tx) => {
    const [member] = await tx
      .select({ id: members.id, archivedAt: members.archivedAt })
      .from(members)
      .where(eq(members.id, input.memberId))
      .limit(1);
    if (!member) throw notFound('Member');
    if (member.archivedAt) {
      throw conflict(
        ERROR_CODES.MEMBER_ARCHIVED,
        'This member is archived. Restore them before charging them.',
      );
    }
    const status = computeInvoiceStatus(
      {
        amountDueMinor: input.amountDueMinor,
        paidMinor: 0,
        refundedMinor: 0,
        dueDate,
        voided: false,
      },
      today,
    );
    const [created] = await tx
      .insert(invoices)
      .values({
        memberId: input.memberId,
        description: input.description,
        amountDueMinor: input.amountDueMinor,
        dueDate,
        status,
        createdBy: ctx.actorUserId,
      })
      .returning();
    await recordAudit(tx, ctx, {
      action: 'INVOICE_CREATED',
      entityType: 'INVOICE',
      entityId: created!.id,
      after: {
        invoiceNumber: created!.invoiceNumber,
        memberId: input.memberId,
        description: input.description,
        amountDueMinor: input.amountDueMinor,
        dueDate,
        status,
      },
    });
    return readInvoice(tx, created!.id);
  });
}

async function heldMinor(tx: DbExecutor, invoiceId: string) {
  const totals = await invoiceTotals(tx, invoiceId);
  return totals.paidMinor - totals.refundedMinor;
}

/** Marks a locked invoice VOID and audits it; the caller has checked it holds no money. */
async function markVoid(tx: DbExecutor, invoice: InvoiceRow, reason: string, ctx: RequestContext) {
  await tx
    .update(invoices)
    .set({ status: 'VOID', voidedAt: new Date(), voidedBy: ctx.actorUserId, voidReason: reason })
    .where(eq(invoices.id, invoice.id));
  await recordAudit(tx, ctx, {
    action: 'INVOICE_VOIDED',
    entityType: 'INVOICE',
    entityId: invoice.id,
    before: { invoiceNumber: invoice.invoiceNumber, status: invoice.status },
    after: { invoiceNumber: invoice.invoiceNumber, status: 'VOID' },
    reason,
  });
}

/** Voiding is the only way to remove an invoice. Money held on it must be refunded first. */
export async function voidInvoice(id: string, reason: string, ctx: RequestContext) {
  return db.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, id);
    if (invoice.status === 'VOID') {
      throw conflict(ERROR_CODES.INVOICE_VOID, `${invoice.invoiceNumber} is already void.`);
    }
    const held = await heldMinor(tx, id);
    if (held > 0) {
      throw conflict(
        ERROR_CODES.INVOICE_HAS_PAYMENTS,
        `${invoice.invoiceNumber} still holds money from payments. Refund them before voiding it.`,
        { netPaidMinor: held },
      );
    }
    await markVoid(tx, invoice, reason, ctx);
    return readInvoice(tx, id);
  });
}

/**
 * Inside a membership cancellation: voids the membership's invoice unless it is already void
 * or still holds money (that one stays open until the payments are refunded). Returns the
 * invoice number that was voided, or null when nothing was voided.
 */
export async function voidCancelledMembershipInvoice(
  tx: DbExecutor,
  membershipId: string,
  reason: string,
  ctx: RequestContext,
): Promise<string | null> {
  const [invoice] = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.membershipId, membershipId))
    .limit(1)
    .for('update');
  if (!invoice || invoice.status === 'VOID' || (await heldMinor(tx, invoice.id)) > 0) return null;
  await markVoid(tx, invoice, reason, ctx);
  return invoice.invoiceNumber;
}

// --- Payments -------------------------------------------------------------------------------

/** Clock skew allowance for "received now" sent by a browser. */
const FUTURE_TOLERANCE_MS = 60_000;

/**
 * Records counter money against an invoice. The invoice row is locked, so two receptionists
 * paying the same invoice at once can never take more than the balance between them.
 */
export async function recordPayment(
  input: RecordPayment,
  ctx: RequestContext,
): Promise<PaymentDto> {
  if (input.method === 'ONLINE') {
    // D8: no provider is configured, so nothing can confirm an online payment.
    throw new AppError(
      400,
      ERROR_CODES.ONLINE_PAYMENT_NOT_CONFIGURED,
      'Online payments require configuration and are not available yet. Record the payment at the counter instead.',
      [{ path: 'method', message: 'Online payments are not set up (REQUIRES CONFIGURATION)' }],
    );
  }
  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
  if (receivedAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
    throw validationFailed([
      { path: 'receivedAt', message: 'The payment cannot be received in the future' },
    ]);
  }

  return db.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, input.invoiceId);
    if (invoice.status === 'VOID') {
      throw conflict(
        ERROR_CODES.INVOICE_VOID,
        `${invoice.invoiceNumber} is void and cannot take payments.`,
      );
    }
    const today = gymToday();
    const totals = await invoiceTotals(tx, invoice.id);
    const balanceMinor = invoiceBalanceMinor(amountsOf(invoice, totals));
    if (input.amountMinor > balanceMinor) {
      throw new AppError(
        400,
        ERROR_CODES.OVERPAYMENT,
        balanceMinor === 0
          ? `${invoice.invoiceNumber} is already paid in full.`
          : 'The amount is more than the outstanding balance.',
        [{ path: 'amountMinor', message: 'Enter an amount no greater than the balance' }],
        { balanceMinor },
      );
    }
    if (input.amountMinor < balanceMinor && !(await partialAllowed(tx, invoice))) {
      throw new AppError(
        400,
        ERROR_CODES.PARTIAL_PAYMENT_NOT_ALLOWED,
        "This membership's plan does not allow part payments. Collect the full balance.",
        [{ path: 'amountMinor', message: 'Enter the full balance' }],
        { balanceMinor },
      );
    }

    const [created] = await tx
      .insert(payments)
      .values({
        invoiceId: invoice.id,
        memberId: invoice.memberId,
        amountMinor: input.amountMinor,
        method: input.method,
        reference: input.reference,
        status: 'COMPLETED',
        receivedAt,
        recordedBy: ctx.actorUserId,
        notes: input.notes,
      })
      .returning();
    const after = await refreshInvoiceStatus(tx, invoice, today);
    await recordAudit(tx, ctx, {
      action: 'PAYMENT_RECORDED',
      entityType: 'PAYMENT',
      entityId: created!.id,
      before: { invoiceStatus: invoice.status, balanceMinor },
      after: {
        receiptNumber: created!.receiptNumber,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        memberId: invoice.memberId,
        amountMinor: input.amountMinor,
        method: input.method,
        reference: input.reference,
        invoiceStatus: after.status,
        balanceMinor: after.balanceMinor,
      },
    });
    return readPayment(tx, created!.id);
  });
}

async function partialAllowed(tx: DbExecutor, invoice: InvoiceRow) {
  if (!invoice.membershipId) return true;
  const [plan] = await tx
    .select({ allow: membershipPlans.allowPartialPayment })
    .from(memberships)
    .innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId))
    .where(eq(memberships.id, invoice.membershipId))
    .limit(1);
  return plan?.allow ?? false;
}

function paymentFilters(query: PaymentListQuery, memberId?: string) {
  const filters: (SQL | undefined)[] = [];
  const member = memberId ?? query.memberId;
  if (member) filters.push(eq(payments.memberId, member));
  if (query.invoiceId) filters.push(eq(payments.invoiceId, query.invoiceId));
  if (query.method) filters.push(eq(payments.method, query.method));
  if (query.status) filters.push(eq(payments.status, query.status));
  if (query.from) filters.push(gte(payments.receivedAt, gymDayStart(query.from)));
  if (query.to) filters.push(lt(payments.receivedAt, gymDayStart(query.to, 1)));
  if (query.q) {
    filters.push(
      memberSearch(
        query.q,
        sql`${payments.receiptNumber}`,
        sql`${invoices.invoiceNumber}`,
        sql`coalesce(${payments.reference}, '')`,
      ),
    );
  }
  return and(...filters);
}

export async function listPayments(query: PaymentListQuery, fixed: { memberId?: string } = {}) {
  const where = paymentFilters(query, fixed.memberId);
  const direction = query.order === 'asc' ? asc : desc;
  const [rows, [totals]] = await Promise.all([
    selectPayments(db)
      .where(where)
      .orderBy(direction(payments.receivedAt), desc(payments.receiptNumber))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db
      .select({ total: count() })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .innerJoin(members, eq(members.id, payments.memberId))
      .where(where),
  ]);
  return paginated(rows.map(toPaymentDto), query.page, query.pageSize, totals?.total ?? 0);
}

export async function getPayment(id: string): Promise<PaymentDto> {
  return readPayment(db, id);
}

async function buildReceipt(where: SQL): Promise<ReceiptDto | null> {
  const [row] = await selectPayments(db).where(where).limit(1);
  if (!row) return null;
  const [invoice, refundRows, settings] = await Promise.all([
    readInvoice(db, row.invoiceId),
    db
      .select({
        refundNumber: refunds.refundNumber,
        amountMinor: refunds.amountMinor,
        method: refunds.method,
        refundedAt: refunds.refundedAt,
      })
      .from(refunds)
      .where(eq(refunds.paymentId, row.id))
      .orderBy(asc(refunds.refundedAt)),
    loadSettingsRow(db),
  ]);
  return {
    gymName: settings.gymName,
    currencyCode: config.currencyCode,
    timezone: config.gymTimezone,
    receiptNumber: row.receiptNumber,
    receivedAt: row.receivedAt.toISOString(),
    amountMinor: row.amountMinor,
    method: row.method,
    reference: row.reference,
    status: row.status,
    member: {
      memberCode: row.memberCode,
      firstName: row.memberFirstName,
      lastName: row.memberLastName,
    },
    invoice: {
      invoiceNumber: invoice.invoiceNumber,
      description: invoice.description,
      amountDueMinor: invoice.amountDueMinor,
      paidMinor: invoice.paidMinor - invoice.refundedMinor,
      balanceMinor: invoice.balanceMinor,
      status: invoice.status,
      dueDate: invoice.dueDate,
    },
    refunds: refundRows.map((refund) => ({
      ...refund,
      refundedAt: refund.refundedAt.toISOString(),
    })),
    recordedByName: fullName(row.recordedByFirstName, row.recordedByLastName),
  };
}

export async function getReceipt(paymentId: string): Promise<ReceiptDto> {
  const receipt = await buildReceipt(eq(payments.id, paymentId));
  if (!receipt) throw notFound('Payment');
  return receipt;
}

// --- Refunds --------------------------------------------------------------------------------

/**
 * Returns money from a completed payment. Locks the invoice, then the payment (the same order
 * as recordPayment), so concurrent refunds can never add up to more than was paid.
 */
export async function refundPayment(
  paymentId: string,
  input: RefundPayment,
  ctx: RequestContext,
): Promise<PaymentDto> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ invoiceId: payments.invoiceId })
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1);
    if (!target) throw notFound('Payment');
    const invoice = await lockInvoice(tx, target.invoiceId);
    const [payment] = (await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1)
      .for('update')) as PaymentRow[];
    if (!payment) throw notFound('Payment');
    if (payment.status !== 'COMPLETED') {
      throw conflict(
        ERROR_CODES.PAYMENT_NOT_REFUNDABLE,
        'Only completed payments can be refunded.',
      );
    }
    const [sums] = await tx
      .select({
        refundedMinor: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)::bigint`.mapWith(
          Number,
        ),
      })
      .from(refunds)
      .where(eq(refunds.paymentId, paymentId));
    const available = refundableMinor({
      amountMinor: payment.amountMinor,
      refundedMinor: sums?.refundedMinor ?? 0,
    });
    if (input.amountMinor > available) {
      throw new AppError(
        400,
        ERROR_CODES.REFUND_EXCEEDS_PAYMENT,
        available === 0
          ? `${payment.receiptNumber} has already been refunded in full.`
          : 'The refund is more than what is left on this payment.',
        [{ path: 'amountMinor', message: 'Enter an amount no greater than the refundable amount' }],
        { refundableMinor: available },
      );
    }
    const [created] = await tx
      .insert(refunds)
      .values({
        paymentId,
        amountMinor: input.amountMinor,
        reason: input.reason,
        method: input.method,
        recordedBy: ctx.actorUserId,
      })
      .returning();
    const after = await refreshInvoiceStatus(tx, invoice);
    await recordAudit(tx, ctx, {
      action: 'REFUND_ISSUED',
      entityType: 'REFUND',
      entityId: created!.id,
      before: { invoiceStatus: invoice.status, refundableMinor: available },
      after: {
        refundNumber: created!.refundNumber,
        paymentId,
        receiptNumber: payment.receiptNumber,
        invoiceNumber: invoice.invoiceNumber,
        memberId: payment.memberId,
        amountMinor: input.amountMinor,
        method: input.method,
        invoiceStatus: after.status,
      },
      reason: input.reason,
    });
    return readPayment(tx, paymentId);
  });
}

export async function listRefunds(query: RefundListQuery) {
  const filters: (SQL | undefined)[] = [];
  if (query.memberId) filters.push(eq(payments.memberId, query.memberId));
  if (query.from) filters.push(gte(refunds.refundedAt, gymDayStart(query.from)));
  if (query.to) filters.push(lt(refunds.refundedAt, gymDayStart(query.to, 1)));
  if (query.q) {
    filters.push(
      memberSearch(query.q, sql`${refunds.refundNumber}`, sql`${payments.receiptNumber}`),
    );
  }
  const where = and(...filters);
  const direction = query.order === 'asc' ? asc : desc;
  const [rows, [totals]] = await Promise.all([
    selectRefunds(db)
      .where(where)
      .orderBy(direction(refunds.refundedAt), desc(refunds.refundNumber))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db
      .select({ total: count() })
      .from(refunds)
      .innerJoin(payments, eq(payments.id, refunds.paymentId))
      .innerJoin(members, eq(members.id, payments.memberId))
      .where(where),
  ]);
  return paginated(rows.map(toRefundDto), query.page, query.pageSize, totals?.total ?? 0);
}

/** 404 for an unknown member, so per-member billing lists cannot be used to probe IDs. */
export async function requireMember(memberId: string) {
  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  if (!member) throw notFound('Member');
}

// --- Overdue job ----------------------------------------------------------------------------

/**
 * Rewrites the stored status of every PENDING invoice whose due date passed. Reads already show
 * such invoices as overdue, so a late run never hides anything. Rows locked by a payment in
 * progress are skipped and picked up next time.
 */
export async function markOverdueInvoices(tx: DbExecutor, today: string) {
  const due = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.status, 'PENDING'), lt(invoices.dueDate, today)))
    .for('update', { skipLocked: true });
  if (due.length === 0) return 0;
  await tx
    .update(invoices)
    .set({ status: 'OVERDUE' })
    .where(
      inArray(
        invoices.id,
        due.map((row) => row.id),
      ),
    );
  return due.length;
}

// --- Member portal --------------------------------------------------------------------------

async function ownMemberId(userId: string) {
  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.userId, userId), isNull(members.archivedAt)))
    .limit(1);
  if (!member) throw notFound('Member profile');
  return member.id;
}

/** Open balance over the member's invoices, for the portal and the member page. */
export async function billingSummary(memberId: string): Promise<MyBillingSummary> {
  const today = gymToday();
  const rows = await selectInvoices(db).where(
    and(eq(invoices.memberId, memberId), inArray(invoices.status, [...OPEN_INVOICE_STATUSES])),
  );
  let outstandingMinor = 0;
  let overdueMinor = 0;
  for (const row of rows) {
    const dto = toInvoiceDto(row, today);
    outstandingMinor += dto.balanceMinor;
    if (dto.status === 'OVERDUE') overdueMinor += dto.balanceMinor;
  }
  return { outstandingMinor, overdueMinor };
}

/** No staff names, notes or void reasons (PLAN §4.10). */
export async function listMyInvoices(userId: string, query: MyBillingQuery) {
  const memberId = await ownMemberId(userId);
  const today = gymToday();
  const where = eq(invoices.memberId, memberId);
  const [rows, [totals], summary] = await Promise.all([
    selectInvoices(db)
      .where(where)
      .orderBy(desc(invoices.createdAt), desc(invoices.invoiceNumber))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db.select({ total: count() }).from(invoices).where(where),
    billingSummary(memberId),
  ]);
  const data: MyInvoiceDto[] = rows.map((row) => {
    const dto = toInvoiceDto(row, today);
    return {
      id: dto.id,
      invoiceNumber: dto.invoiceNumber,
      description: dto.description,
      amountDueMinor: dto.amountDueMinor,
      paidMinor: dto.paidMinor - dto.refundedMinor,
      balanceMinor: dto.balanceMinor,
      dueDate: dto.dueDate,
      status: dto.status,
      createdAt: dto.createdAt,
    };
  });
  return { ...paginated(data, query.page, query.pageSize, totals?.total ?? 0), summary };
}

export async function listMyPayments(userId: string, query: MyBillingQuery) {
  const memberId = await ownMemberId(userId);
  const where = eq(payments.memberId, memberId);
  const [rows, [totals]] = await Promise.all([
    selectPayments(db)
      .where(where)
      .orderBy(desc(payments.receivedAt), desc(payments.receiptNumber))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db.select({ total: count() }).from(payments).where(where),
  ]);
  const data: MyPaymentDto[] = rows.map((row) => ({
    id: row.id,
    receiptNumber: row.receiptNumber,
    invoiceNumber: row.invoiceNumber,
    description: row.invoiceDescription,
    amountMinor: row.amountMinor,
    refundedMinor: row.refundedMinor,
    method: row.method,
    status: row.status,
    receivedAt: row.receivedAt.toISOString(),
  }));
  return paginated(data, query.page, query.pageSize, totals?.total ?? 0);
}

/** Another member's receipt is indistinguishable from a missing one: 404. */
export async function getMyReceipt(userId: string, paymentId: string): Promise<ReceiptDto> {
  const memberId = await ownMemberId(userId);
  const receipt = await buildReceipt(
    and(eq(payments.id, paymentId), eq(payments.memberId, memberId))!,
  );
  if (!receipt) throw notFound('Receipt');
  return receipt;
}
