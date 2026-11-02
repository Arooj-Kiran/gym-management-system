import {
  createInvoiceSchema,
  idParamSchema,
  invoiceListQuerySchema,
  myBillingQuerySchema,
  paymentListQuerySchema,
  recordPaymentSchema,
  refundListQuerySchema,
  refundPaymentSchema,
  voidInvoiceSchema,
} from '@gms/shared';
import { Router, type Request, type Response } from 'express';
import { requestContext, requireAuthContext } from '../../lib/request-context';
import { requirePermission, requireStaffRole } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import { parseInput } from '../../middleware/validate';
import * as billing from './billing.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const userId = (req: Request) => requireAuthContext(req).user.id;

/** Staff billing routes. Members read their own billing through /me and get 403 here. */
export function invoicesRoutes() {
  const router = Router();
  router.use(...authenticated, requireStaffRole);

  router.get('/', requirePermission('payments:read'), async (req, res) => {
    res.json(await billing.listInvoices(parseInput(invoiceListQuerySchema, req.query)));
  });

  router.post('/', requirePermission('payments:record'), async (req, res) => {
    const input = parseInput(createInvoiceSchema, req.body);
    res.status(201).json(await billing.createInvoice(input, requestContext(req)));
  });

  router.get('/:id', requirePermission('payments:read'), async (req, res) => {
    res.json(await billing.getInvoice(idOf(req)));
  });

  router.post('/:id/void', requirePermission('payments:void'), async (req, res) => {
    const id = idOf(req);
    const { reason } = parseInput(voidInvoiceSchema, req.body);
    res.json(await billing.voidInvoice(id, reason, requestContext(req)));
  });

  return router;
}

export function paymentsRoutes() {
  const router = Router();
  router.use(...authenticated, requireStaffRole);

  router.get('/', requirePermission('payments:read'), async (req, res) => {
    res.json(await billing.listPayments(parseInput(paymentListQuerySchema, req.query)));
  });

  router.post('/', requirePermission('payments:record'), async (req, res) => {
    const input = parseInput(recordPaymentSchema, req.body);
    res.status(201).json(await billing.recordPayment(input, requestContext(req)));
  });

  router.get('/:id', requirePermission('payments:read'), async (req, res) => {
    res.json(await billing.getPayment(idOf(req)));
  });

  router.get('/:id/receipt', requirePermission('payments:read'), async (req, res) => {
    res.json(await billing.getReceipt(idOf(req)));
  });

  router.post('/:id/refunds', requirePermission('payments:refund'), async (req, res) => {
    const id = idOf(req);
    const input = parseInput(refundPaymentSchema, req.body);
    res.status(201).json(await billing.refundPayment(id, input, requestContext(req)));
  });

  return router;
}

export function refundsRoutes() {
  const router = Router();
  router.use(...authenticated, requireStaffRole, requirePermission('payments:read'));
  router.get('/', async (req, res) => {
    res.json(await billing.listRefunds(parseInput(refundListQuerySchema, req.query)));
  });
  return router;
}

/** GET /members/:id/invoices */
export async function invoicesForMember(req: Request, res: Response) {
  const memberId = idOf(req);
  await billing.requireMember(memberId);
  const query = parseInput(invoiceListQuerySchema, req.query);
  res.json({
    ...(await billing.listInvoices(query, { memberId })),
    summary: await billing.billingSummary(memberId),
  });
}

/** GET /members/:id/payments */
export async function paymentsForMember(req: Request, res: Response) {
  const memberId = idOf(req);
  await billing.requireMember(memberId);
  const query = parseInput(paymentListQuerySchema, req.query);
  res.json(await billing.listPayments(query, { memberId }));
}

/** GET /me/invoices */
export async function myInvoices(req: Request, res: Response) {
  res.json(await billing.listMyInvoices(userId(req), parseInput(myBillingQuerySchema, req.query)));
}

/** GET /me/payments */
export async function myPayments(req: Request, res: Response) {
  res.json(await billing.listMyPayments(userId(req), parseInput(myBillingQuerySchema, req.query)));
}

/** GET /me/payments/:id/receipt */
export async function myReceipt(req: Request, res: Response) {
  res.json(await billing.getMyReceipt(userId(req), idOf(req)));
}
