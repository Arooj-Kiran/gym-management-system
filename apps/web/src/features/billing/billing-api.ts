import type {
  CreateInvoiceInput,
  InvoiceDetailDto,
  InvoiceDto,
  InvoiceListQuery,
  MyBillingSummary,
  MyInvoiceDto,
  MyPaymentDto,
  Paginated,
  PaymentDto,
  PaymentListQuery,
  ReceiptDto,
  RecordPaymentInput,
  RefundDto,
  RefundListQuery,
  RefundPaymentInput,
} from '@gms/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { queryKeys } from '../../api/query-keys';

export type MemberInvoices = Paginated<InvoiceDto> & { summary: MyBillingSummary };
export type MyInvoices = Paginated<MyInvoiceDto> & { summary: MyBillingSummary };

export function useInvoiceList(query: InvoiceListQuery) {
  return useQuery({
    queryKey: queryKeys.billing.invoices(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<InvoiceDto>>('/invoices', { query: { ...query }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useInvoice(id: string | null) {
  return useQuery({
    queryKey: queryKeys.billing.invoice(id ?? ''),
    queryFn: ({ signal }) => api.get<InvoiceDetailDto>(`/invoices/${id}`, { signal }),
    enabled: Boolean(id),
  });
}

export function usePaymentList(query: PaymentListQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.billing.payments(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<PaymentDto>>('/payments', { query: { ...query }, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useRefundList(query: RefundListQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.billing.refunds(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<RefundDto>>('/refunds', { query: { ...query }, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useMemberInvoices(memberId: string, query: InvoiceListQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.billing.memberInvoices(memberId, query),
    queryFn: ({ signal }) =>
      api.get<MemberInvoices>(`/members/${memberId}/invoices`, { query: { ...query }, signal }),
    placeholderData: keepPreviousData,
    enabled: enabled && Boolean(memberId),
  });
}

export function useMemberPayments(memberId: string, query: PaymentListQuery) {
  return useQuery({
    queryKey: queryKeys.billing.memberPayments(memberId, query),
    queryFn: ({ signal }) =>
      api.get<Paginated<PaymentDto>>(`/members/${memberId}/payments`, {
        query: { ...query },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

/** Staff receipts come from /payments; a member's own from /me (404 for anyone else's). */
export function useReceipt(paymentId: string, portal: boolean) {
  return useQuery({
    queryKey: portal
      ? queryKeys.billing.myReceipt(paymentId)
      : queryKeys.billing.receipt(paymentId),
    queryFn: ({ signal }) =>
      api.get<ReceiptDto>(
        portal ? `/me/payments/${paymentId}/receipt` : `/payments/${paymentId}/receipt`,
        { signal },
      ),
    retry: false,
  });
}

export function useMyInvoices(page: number) {
  return useQuery({
    queryKey: queryKeys.billing.myInvoices(page),
    queryFn: ({ signal }) =>
      api.get<MyInvoices>('/me/invoices', { query: { page, pageSize: 10 }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useMyPayments(page: number) {
  return useQuery({
    queryKey: queryKeys.billing.myPayments(page),
    queryFn: ({ signal }) =>
      api.get<Paginated<MyPaymentDto>>('/me/payments', { query: { page, pageSize: 10 }, signal }),
    placeholderData: keepPreviousData,
  });
}

/**
 * Money movements change invoice balances shown on membership cards, member lists (payment
 * filter) and the dashboard, so all of them are refreshed.
 */
function useRefreshBilling() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.billing.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.members.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.memberships.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
    ]);
}

export function useRecordPayment() {
  const refresh = useRefreshBilling();
  return useMutation({
    mutationFn: (input: RecordPaymentInput) => api.post<PaymentDto>('/payments', input),
    onSuccess: refresh,
  });
}

export function useCreateInvoice() {
  const refresh = useRefreshBilling();
  return useMutation({
    mutationFn: (input: CreateInvoiceInput) => api.post<InvoiceDto>('/invoices', input),
    onSuccess: refresh,
  });
}

export function useVoidInvoice() {
  const refresh = useRefreshBilling();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<InvoiceDto>(`/invoices/${id}/void`, { reason }),
    onSuccess: refresh,
  });
}

export function useRefundPayment() {
  const refresh = useRefreshBilling();
  return useMutation({
    mutationFn: ({ paymentId, ...input }: RefundPaymentInput & { paymentId: string }) =>
      api.post<PaymentDto>(`/payments/${paymentId}/refunds`, input),
    onSuccess: refresh,
  });
}
