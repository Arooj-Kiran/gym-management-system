import { computeInvoiceStatus } from '@gms/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { recordAudit } from '../../lib/audit';
import type { RequestContext } from '../../lib/request-context';
import { createMembershipInvoice } from '../../modules/billing/billing.service';
import type { DbExecutor } from '../client';
import { gymSettings, invoices, members, memberships, payments } from '../schema';

/** Marks the billing demo as done (safe to run repeatedly). */
export const DEMO_CHARGE = 'Locker rental, one month (demo)';

/**
 * Stage 5 demo on the Stage 4 access members: Ayesha has paid her membership in cash and part of
 * a locker charge by card; Zeeshan's membership invoice is unpaid and overdue. Counter payments
 * only: online payment REQUIRES CONFIGURATION.
 */
export async function seedBillingDemo(tx: DbExecutor, ctx: RequestContext, today: string) {
  const [done] = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.description, DEMO_CHARGE))
    .limit(1);
  if (done) {
    console.warn('The billing demo already exists; billing demo skipped.');
    return;
  }
  const demoMembers = await tx
    .select({ id: members.id, email: members.email })
    .from(members)
    .where(
      and(
        eq(members.isDemo, true),
        inArray(members.email, ['ayesha.kamal@example.test', 'zeeshan.ali@example.test']),
      ),
    );
  const ayesha = demoMembers.find((member) => member.email === 'ayesha.kamal@example.test');
  const zeeshan = demoMembers.find((member) => member.email === 'zeeshan.ali@example.test');
  if (!ayesha || !zeeshan) {
    console.warn('The Stage 4 access demo members are missing; billing demo skipped.');
    return;
  }
  const [settings] = await tx.select().from(gymSettings).limit(1);

  /** The member's current membership invoice, created if the migration backfill did not. */
  async function membershipInvoice(memberId: string) {
    const [membership] = await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.memberId, memberId),
          inArray(memberships.status, ['ACTIVE', 'SUSPENDED', 'PENDING']),
        ),
      )
      .limit(1);
    if (!membership) return null;
    const [existing] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.membershipId, membership.id))
      .limit(1);
    return (
      existing ??
      (await createMembershipInvoice(tx, ctx, membership, settings?.invoiceDueDays ?? 0))
    );
  }

  async function pay(
    invoice: typeof invoices.$inferSelect,
    amountMinor: number,
    method: 'CASH' | 'CARD',
    reference: string | null,
    paidMinorAfter: number,
  ) {
    const [payment] = await tx
      .insert(payments)
      .values({
        invoiceId: invoice.id,
        memberId: invoice.memberId,
        amountMinor,
        method,
        reference,
        status: 'COMPLETED',
        receivedAt: new Date(),
        notes: 'Demo data seed',
      })
      .returning();
    const status = computeInvoiceStatus(
      {
        amountDueMinor: invoice.amountDueMinor,
        paidMinor: paidMinorAfter,
        refundedMinor: 0,
        dueDate: invoice.dueDate,
        voided: false,
      },
      today,
    );
    await tx.update(invoices).set({ status }).where(eq(invoices.id, invoice.id));
    await recordAudit(tx, ctx, {
      action: 'PAYMENT_RECORDED',
      entityType: 'PAYMENT',
      entityId: payment!.id,
      after: {
        receiptNumber: payment!.receiptNumber,
        invoiceNumber: invoice.invoiceNumber,
        amountMinor,
        method,
        invoiceStatus: status,
      },
      reason: 'Demo data seed',
    });
  }

  const paid = await membershipInvoice(ayesha.id);
  if (paid) {
    const [already] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.invoiceId, paid.id))
      .limit(1);
    if (!already) await pay(paid, paid.amountDueMinor, 'CASH', null, paid.amountDueMinor);
  }
  const overdue = await membershipInvoice(zeeshan.id);
  if (overdue && overdue.status === 'PENDING' && overdue.dueDate < today) {
    await tx.update(invoices).set({ status: 'OVERDUE' }).where(eq(invoices.id, overdue.id));
  }

  const [locker] = await tx
    .insert(invoices)
    .values({
      memberId: ayesha.id,
      description: DEMO_CHARGE,
      amountDueMinor: 1_500_00,
      dueDate: today,
      status: 'PENDING',
    })
    .returning();
  await recordAudit(tx, ctx, {
    action: 'INVOICE_CREATED',
    entityType: 'INVOICE',
    entityId: locker!.id,
    after: {
      invoiceNumber: locker!.invoiceNumber,
      description: DEMO_CHARGE,
      amountDueMinor: 1_500_00,
    },
    reason: 'Demo data seed',
  });
  await pay(locker!, 500_00, 'CARD', 'POS-DEMO-0001', 500_00);
  console.warn('Seeded the billing demo: one paid membership, one overdue, one part-paid charge.');
}
