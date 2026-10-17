import { AlertTriangle } from 'lucide-react';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import type { PhoneWarning } from './member-errors';
import { MemberMatchLink } from './member-fields';

/**
 * Second step of the duplicate-phone rule: the save is repeated only after staff confirm, with a
 * reason that is stored in the audit log (MEMBER_DUPLICATE_PHONE_CONFIRMED).
 */
export function DuplicatePhoneDialog({
  warning,
  onOpenChange,
  loading,
  onConfirm,
}: {
  warning: PhoneWarning | null;
  onOpenChange: (open: boolean) => void;
  loading?: boolean;
  onConfirm: (reason: string) => void;
}) {
  const sameName = warning?.matches.some((match) => match.sameName) ?? false;
  return (
    <ConfirmDialog
      open={warning !== null}
      onOpenChange={onOpenChange}
      title={sameName ? 'This may be the same person' : 'Phone number already in use'}
      description={warning?.message}
      confirmLabel="Save anyway"
      reason="required"
      reasonLabel="Why is this number shared?"
      loading={loading}
      onConfirm={(reason) => onConfirm(reason ?? '')}
    >
      <div className="rounded-md border border-border bg-surface-muted/50 px-3 py-2.5 text-13">
        <p className="mb-1.5 flex items-center gap-1.5 font-medium text-fg">
          <AlertTriangle className="size-4 text-warning-text" aria-hidden />
          Members with this number
        </p>
        <ul className="flex flex-col gap-1 text-fg-secondary">
          {warning?.matches.map((match) => (
            <li key={match.id}>
              <MemberMatchLink match={match} />
              {match.sameName && <span className="text-warning-text"> · same name</span>}
            </li>
          ))}
        </ul>
        {sameName && (
          <p className="mt-2 text-fg-muted">
            Check the existing profile first. Register again only if this is a different person.
          </p>
        )}
      </div>
    </ConfirmDialog>
  );
}
