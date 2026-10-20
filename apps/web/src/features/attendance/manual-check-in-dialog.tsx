import { ACCESS_REASON_LABELS, type AccessDecision } from '@gms/shared';
import { CircleX, SearchX } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Textarea } from '../../components/ui/form-field';
import { SearchInput } from '../../components/ui/search-input';
import { ListSkeleton } from '../../components/ui/states';
import { fullName } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { MembershipStatusBadge } from '../memberships/membership-status-badge';
import { MemberAvatar } from '../members/member-avatar';
import { useMemberList } from '../members/members-api';
import { useManualCheckIn } from './attendance-api';

export interface CheckInMember {
  id: string;
  memberCode: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
}

function MemberPicker({
  selected,
  onSelect,
}: {
  selected: CheckInMember | null;
  onSelect: (member: CheckInMember) => void;
}) {
  const [q, setQ] = useState('');
  const list = useMemberList({ q: q || undefined, pageSize: 6 });
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-13 font-medium text-fg">Member</legend>
      <SearchInput
        value={q}
        onChange={setQ}
        label="Search members"
        placeholder="Name, member code or phone"
      />
      <div className="max-h-64 overflow-y-auto rounded-md border border-border">
        {list.isPending ? (
          <ListSkeleton rows={3} label="Loading members" />
        ) : list.isError ? (
          <p role="alert" className="px-3 py-4 text-13 text-danger-text">
            {errorMessage(list.error)}
          </p>
        ) : list.data.data.length === 0 ? (
          <p className="flex items-center gap-2 px-3 py-4 text-13 text-fg-muted">
            <SearchX className="size-4" aria-hidden /> No members match “{q}”.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {list.data.data.map((member) => {
              const checked = selected?.id === member.id;
              return (
                <li key={member.id}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-surface-hover has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-focus',
                      checked && 'bg-primary-subtle hover:bg-primary-subtle',
                    )}
                  >
                    <input
                      type="radio"
                      name="check-in-member"
                      className="sr-only"
                      checked={checked}
                      onChange={() => onSelect(member)}
                    />
                    <MemberAvatar member={member} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">
                        {fullName(member)}
                      </span>
                      <span className="block truncate font-mono text-xs text-fg-muted">
                        {member.memberCode}
                      </span>
                    </span>
                    {member.currentMembership && (
                      <MembershipStatusBadge status={member.currentMembership.effectiveStatus} />
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </fieldset>
  );
}

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
  member?: CheckInMember;
}) {
  const [picked, setPicked] = useState<CheckInMember | null>(null);
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
