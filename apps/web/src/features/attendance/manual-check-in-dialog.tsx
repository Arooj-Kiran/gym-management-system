import { ACCESS_REASON_LABELS, type AccessDecision } from '@gms/shared';
import { CircleX } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Textarea } from '../../components/ui/form-field';
import { fullName } from '../../lib/auth';
import { MemberAvatar } from '../members/member-avatar';
import { MemberPicker, type PickedMember } from '../members/member-picker';
import { useManualCheckIn } from './attendance-api';

/**
 * Staff check a member in by hand (no fingerprint, scanner down). The server applies the same
 * eligibility rules as a scan and writes the reason to the audit log.
 */
export function ManualCheckInDialog({
  open,
  onOpenChange,
  member: fixedMember,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Check in this member (member page); otherwise staff search for one. */
  member?: PickedMember;
}) {
  const [picked, setPicked] = useState<PickedMember | null>(null);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [denial, setDenial] = useState<AccessDecision | null>(null);
  const checkIn = useManualCheckIn();
  const member = fixedMember ?? picked;
  const trimmed = reason.trim();
  const reasonError =
    trimmed.length < 3 ? 'Give a short reason (at least 3 characters)' : undefined;

  const close = (next: boolean) => {
    if (!next) {
      setPicked(null);
      setReason('');
      setTouched(false);
      setDenial(null);
    }
    onOpenChange(next);
  };

  const submit = () => {
    setTouched(true);
    if (!member || reasonError) return;
    setDenial(null);
    checkIn.mutate(
      { memberId: member.id, reason: trimmed },
      {
        onSuccess: (decision) => {
          if (decision.decision === 'GRANTED' && decision.reason === 'GRANTED') {
            toast.success(
              decision.duplicate
                ? `${fullName(member)} was already checked in a moment ago`
                : `${fullName(member)} checked in`,
            );
            close(false);
          } else {
            setDenial(decision);
          }
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Manual check-in"
      description="Use this when the member cannot use the scanner. Their membership is checked the same way as a scan."
      busy={checkIn.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={checkIn.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={checkIn.isPending} disabled={!member}>
            Check in
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {fixedMember ? (
          <div className="flex items-center gap-3 rounded-md border border-border bg-surface-muted/50 px-3 py-2.5">
            <MemberAvatar member={fixedMember} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg">{fullName(fixedMember)}</p>
              <p className="font-mono text-xs text-fg-muted">{fixedMember.memberCode}</p>
            </div>
          </div>
        ) : (
          <MemberPicker
            selected={picked}
            onSelect={(next) => {
              setPicked(next);
              setDenial(null);
            }}
          />
        )}
        {touched && !member && (
          <p role="alert" className="-mt-3 text-13 text-danger-text">
            Choose a member.
          </p>
        )}
        <FormField
          label="Why are you checking them in by hand?"
          error={touched ? reasonError : undefined}
          hint="For example: no fingerprint enrolled, scanner out of order. Saved in the audit log."
        >
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            rows={2}
          />
        </FormField>
        {denial && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-md border border-danger/25 bg-danger-subtle px-3 py-3"
          >
            <CircleX className="mt-0.5 size-4 shrink-0 text-danger-text" aria-hidden />
            <div className="text-13">
              <p className="font-semibold text-danger-text">
                Not checked in · {ACCESS_REASON_LABELS[denial.reason]}
              </p>
              <p className="mt-0.5 text-fg-secondary">{denial.message}</p>
            </div>
          </div>
        )}
      </form>
    </Dialog>
  );
}
