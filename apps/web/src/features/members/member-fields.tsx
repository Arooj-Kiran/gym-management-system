import {
  MEMBER_ACCOUNT_STATUS_LABELS,
  MEMBER_ACCOUNT_STATUSES,
  type MemberMatch,
} from '@gms/shared';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { useWatch, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form';
import { Link } from 'react-router';
import { FormField, Input, Select, Textarea } from '../../components/ui/form-field';
import { fullName } from '../../lib/auth';
import { gymTodayIso } from '../../lib/format';
import type { MemberFormValues } from './member-form';
import { useDuplicateCheck } from './members-api';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <legend className="mb-3 text-xs font-semibold tracking-wide text-fg-muted uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

/** Opens in a new tab so a half-filled form is never lost. */
export function MemberMatchLink({ match }: { match: Omit<MemberMatch, 'sameName'> }) {
  return (
    <Link
      to={`/members/${match.id}`}
      target="_blank"
      rel="noopener"
      className="inline-flex items-center gap-1 font-medium underline decoration-current/30 underline-offset-2 hover:decoration-current"
    >
      {fullName(match)} <span className="font-mono text-xs">{match.memberCode}</span>
      <ExternalLink className="size-3" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </Link>
  );
}

function PhoneMatches({ matches }: { matches: MemberMatch[] }) {
  const sameName = matches.some((match) => match.sameName);
  return (
    <div
      role="status"
      className="flex gap-2.5 rounded-md bg-warning-subtle px-3 py-2.5 text-13 text-warning-text sm:col-span-2"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">
          {sameName
            ? 'A member with this name and phone number already exists. This may be the same person.'
            : 'This phone number is already used by another member.'}
        </p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {matches.map((match) => (
            <li key={match.id}>
              <MemberMatchLink match={match} />
              {match.sameName && <span> · same name</span>}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-warning-text/90">
          Families often share a number. You can still save and will be asked to say why.
        </p>
      </div>
    </div>
  );
}

export function MemberFields<T extends MemberFormValues>({
  register,
  control,
  errors,
  disabled,
  excludeId,
  showStatus,
}: {
  register: UseFormRegister<T>;
  control: Control<T>;
  errors: FieldErrors<T>;
  disabled?: boolean;
  /** The member being edited, so it never matches itself. */
  excludeId?: string;
  showStatus?: boolean;
}) {
  // The generic form type is a superset of the member fields; narrow once here.
  const reg = register as unknown as UseFormRegister<MemberFormValues>;
  const err = errors as FieldErrors<MemberFormValues>;
  const [email, phone, firstName, lastName] = useWatch({
    control: control as unknown as Control<MemberFormValues>,
    name: ['email', 'phone', 'firstName', 'lastName'],
  });
  const duplicates = useDuplicateCheck(
    {
      email: email ?? undefined,
      phone: phone ?? undefined,
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
      excludeId,
    },
    !disabled,
  );
  const emailConflict = duplicates.data?.emailConflict;
  const phoneMatches = duplicates.data?.phoneMatches ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Section title="Personal details">
        <FormField label="First name" error={err.firstName?.message}>
          <Input autoComplete="off" disabled={disabled} {...reg('firstName')} />
        </FormField>
        <FormField label="Last name" error={err.lastName?.message}>
          <Input autoComplete="off" disabled={disabled} {...reg('lastName')} />
        </FormField>
        <FormField
          label="Phone"
          error={err.phone?.message}
          hint="Numbers without +92 are read as Pakistani."
        >
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            disabled={disabled}
            {...reg('phone')}
          />
        </FormField>
        <FormField
          label="Email"
          optional
          error={err.email?.message}
          hint={
            emailConflict ? (
              <span className="text-danger-text">
                Already used by <MemberMatchLink match={emailConflict} />. Each member needs their
                own email.
              </span>
            ) : (
              'Needed for a portal login.'
            )
          }
        >
          <Input type="email" autoComplete="off" disabled={disabled} {...reg('email')} />
        </FormField>
        {phoneMatches.length > 0 && <PhoneMatches matches={phoneMatches} />}
        <FormField label="Registration date" error={err.registrationDate?.message}>
          <Input type="date" max={gymTodayIso()} disabled={disabled} {...reg('registrationDate')} />
        </FormField>
        {showStatus && (
          <FormField
            label="Account status"
            error={err.accountStatus?.message}
            hint="Inactive members are never let in."
          >
            <Select disabled={disabled} {...reg('accountStatus')}>
              {MEMBER_ACCOUNT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {MEMBER_ACCOUNT_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </FormField>
        )}
      </Section>

      <Section title="Emergency contact">
        <FormField label="Contact name" optional error={err.emergencyContactName?.message}>
          <Input autoComplete="off" disabled={disabled} {...reg('emergencyContactName')} />
        </FormField>
        <FormField label="Relation" optional error={err.emergencyContactRelation?.message}>
          <Input
            autoComplete="off"
            placeholder="e.g. Sister"
            disabled={disabled}
            {...reg('emergencyContactRelation')}
          />
        </FormField>
        <FormField label="Contact phone" optional error={err.emergencyContactPhone?.message}>
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            disabled={disabled}
            {...reg('emergencyContactPhone')}
          />
        </FormField>
      </Section>

      <FormField
        label="Staff notes"
        optional
        error={err.notes?.message}
        hint="Never shown to the member."
      >
        <Textarea rows={3} maxLength={2000} disabled={disabled} {...reg('notes')} />
      </FormField>
    </div>
  );
}
