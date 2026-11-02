import { INVOICE_STATUS_LABELS, type InvoiceStatus } from '@gms/shared';
import { Badge } from '../../components/ui/badge';
import { INVOICE_TONES } from './billing-format';

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <Badge tone={INVOICE_TONES[status]} dot>
      {INVOICE_STATUS_LABELS[status]}
    </Badge>
  );
}
