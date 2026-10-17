import { zodResolver } from '@hookform/resolvers/zod';
import {
  MEMBER_ACCOUNT_STATUS_LABELS,
  updateMemberSchema,
  type MemberDto,
  type UpdateMemberInput,
} from '@gms/shared';
import { Archive, ArrowLeft, History, UserX } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { z } from 'zod';
import { ApiError } from '../../api/client';
import { Button, ButtonLink } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/states';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { fullName, useCan } from '../../lib/auth';
import { formatDate, formatPhone } from '../../lib/format';
import { MemberMembershipTab } from '../memberships/member-membership-tab';
import { MembershipStatusBadge } from '../memberships/membership-status-badge';
import { DuplicatePhoneDialog } from './duplicate-phone-dialog';
import { handleMemberSaveError, type PhoneWarning } from './member-errors';
import { MemberAvatar } from './member-avatar';
import { MemberFields } from './member-fields';
import { MEMBER_EDIT_FIELDS, memberEditValues } from './member-form';
import { EntryAccessCard, PhotoCard, PortalAccountCard, RecordCard } from './member-side-cards';
import { MemberStatusBadges } from './member-status';
import { useMember, useUpdateMember } from './members-api';

type FormInput = z.input<typeof updateMemberSchema>;
type FormOutput = z.output<typeof updateMemberSchema>;

function ProfileForm({ member }: { member: MemberDto }) {
  const update = useUpdateMember(member.id);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(updateMemberSchema),
    defaultValues: memberEditValues(member),
  });
  const { errors, isDirty, dirtyFields } = form.formState;
  const [pending, setPending] = useState<{
    changes: UpdateMemberInput;
    warning: PhoneWarning;
  } | null>(null);

  // Keep the form in step with the saved record (after a save or another tab's change).
  useEffect(() => form.reset(memberEditValues(member)), [member, form]);

  const save = (changes: UpdateMemberInput) =>
    update.mutate(changes, {
      onSuccess: () => {
        setPending(null);
        toast.success('Details saved');
      },
      onError: (error) => {
        setPending(null);
        handleMemberSaveError(error, form.setError, MEMBER_EDIT_FIELDS, (warning) =>
          setPending({ changes, warning }),
        );
      },
    });

  const submit = form.handleSubmit((values) => {
    const changes = Object.fromEntries(
      MEMBER_EDIT_FIELDS.filter((field) => dirtyFields[field]).map((field) => [
        field,
        values[field],
      ]),
    ) as UpdateMemberInput;
    if (Object.keys(changes).length > 0) save(changes);
  });

  return (
    <>
      <form onSubmit={submit} noValidate aria-label="Member details">
        <div className="px-4 py-5 sm:px-5">
          <MemberFields
            register={form.register}
            control={form.control}
            errors={errors}
            disabled={update.isPending}
            excludeId={member.id}
            showStatus
          />
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-border px-4 py-3.5 sm:flex-row sm:justify-end sm:px-5">
          <Button
            variant="ghost"
            disabled={!isDirty || update.isPending}
            onClick={() => form.reset(memberEditValues(member))}
          >
            Discard changes
          </Button>
          <Button type="submit" disabled={!isDirty} loading={update.isPending && !pending}>
            Save details
          </Button>
        </div>
      </form>
      <DuplicatePhoneDialog
        warning={pending?.warning ?? null}
        onOpenChange={(next) => !next && setPending(null)}
        loading={update.isPending}
        onConfirm={(reason) =>
          pending &&
          save({ ...pending.changes, confirmDuplicatePhone: true, duplicatePhoneReason: reason })
        }
      />
    </>
  );
}

function Detail({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-13 text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-sm break-words text-fg">{children}</dd>
    </div>
  );
}

/** Read-only view: archived members, or staff without members:update. */
function ProfileDetails({ member }: { member: MemberDto }) {
  const contact = [member.emergencyContactName, member.emergencyContactRelation]
    .filter(Boolean)
    .join(' · ');
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-4 py-5 sm:grid-cols-2 sm:px-5">
      <Detail label="First name">{member.firstName}</Detail>
      <Detail label="Last name">{member.lastName}</Detail>
      <Detail label="Phone">{formatPhone(member.phone)}</Detail>
      <Detail label="Email">{member.email ?? '—'}</Detail>
      <Detail label="Registration date">{formatDate(member.registrationDate)}</Detail>
      <Detail label="Account status">{MEMBER_ACCOUNT_STATUS_LABELS[member.accountStatus]}</Detail>
      <Detail label="Emergency contact">{contact || '—'}</Detail>
      <Detail label="Emergency phone">{formatPhone(member.emergencyContactPhone)}</Detail>
      <Detail label="Staff notes" wide>
        <span className="whitespace-pre-line">{member.notes ?? '—'}</span>
      </Detail>
    </dl>
  );
}

function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading member" className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Skeleton className="size-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-[480px]" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

const TABS = [
  { value: 'profile', label: 'Profile' },
  { value: 'membership', label: 'Membership' },
] as const;
type Tab = (typeof TABS)[number]['value'];

export function MemberDetailPage() {
  const { id = '' } = useParams();
  const can = useCan();
  const member = useMember(id);
  const [params, setParams] = useSearchParams();
  const showMemberships = can('memberships:read');
  const tab: Tab = showMemberships && params.get('tab') === 'membership' ? 'membership' : 'profile';
  const selectTab = (next: Tab) =>
    setParams(next === 'profile' ? {} : { tab: next }, { replace: true });

  const back = (
    <Link
      to="/members"
      className="mb-4 inline-flex items-center gap-1.5 rounded-sm text-13 font-medium text-fg-secondary hover:text-fg"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Members
    </Link>
  );

  if (member.isPending)
    return (
      <>
        {back}
        <DetailSkeleton />
      </>
    );

  if (member.isError) {
    const missing =
      member.error instanceof ApiError &&
      (member.error.status === 404 || member.error.status === 400);
    return (
      <>
        {back}
        <Card>
          {missing ? (
            <EmptyState
              icon={<UserX aria-hidden />}
              title="Member not found"
              description="The link may be wrong or out of date. Search the member list instead."
              action={
                <ButtonLink to="/members" variant="secondary" size="sm">
                  Back to members
                </ButtonLink>
              }
            />
          ) : (
            <ErrorState error={member.error} onRetry={() => member.refetch()} />
          )}
        </Card>
      </>
    );
  }

  const record = member.data;
  const archived = Boolean(record.archivedAt);
  const canUpdate = can('members:update');
  const details = (
    <Card>
      <CardHeader
        title="Details"
        description={
          canUpdate && !archived ? 'Changes are recorded in the audit log.' : 'Read-only.'
        }
      />
      {canUpdate && !archived ? (
        <ProfileForm member={record} />
      ) : (
        <ProfileDetails member={record} />
      )}
    </Card>
  );

  return (
    <>
      {back}
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <MemberAvatar member={record} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-fg sm:text-2xl">
              {fullName(record)}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="font-mono text-13 text-fg-secondary">{record.memberCode}</span>
              <MemberStatusBadges member={record} />
              {record.currentMembership && (
                <span className="inline-flex items-center gap-1.5 text-13 text-fg-secondary">
                  <span className="truncate">{record.currentMembership.planName}</span>
                  <MembershipStatusBadge status={record.currentMembership.effectiveStatus} />
                </span>
              )}
            </div>
          </div>
        </div>
        {can('audit:read') && (
          <ButtonLink
            to={`/audit-log?entityId=${record.id}`}
            variant="secondary"
            size="sm"
            icon={<History aria-hidden />}
          >
            Activity history
          </ButtonLink>
        )}
      </header>

      {archived && (
        <div
          role="status"
          className="mb-6 flex items-start gap-3 rounded-lg border border-border bg-surface-muted/60 px-4 py-3 text-13 text-fg-secondary"
        >
          <Archive className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
          <p>
            This member is archived. Their details are read-only and their portal login is disabled.
            {can('members:archive') ? ' Restore them to make changes.' : ''}
          </p>
        </div>
      )}

      {showMemberships && (
        <Tabs
          label="Member sections"
          idPrefix="member"
          tabs={[...TABS]}
          value={tab}
          onChange={selectTab}
          className="mb-6"
        />
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {showMemberships ? (
          <TabPanel idPrefix="member" value={tab}>
            {tab === 'membership' ? <MemberMembershipTab member={record} /> : details}
          </TabPanel>
        ) : (
          details
        )}
        <div className="flex flex-col gap-6">
          <PhotoCard member={record} canUpdate={canUpdate} />
          <EntryAccessCard member={record} canRestrict={can('access:restrict')} />
          <PortalAccountCard member={record} canUpdate={canUpdate} />
          <RecordCard member={record} canArchive={can('members:archive')} />
        </div>
      </div>
    </>
  );
}
