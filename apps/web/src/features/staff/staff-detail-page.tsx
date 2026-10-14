import { zodResolver } from '@hookform/resolvers/zod';
import { ROLE_LABELS, updateStaffSchema, type StaffDto, type UpdateStaffInput } from '@gms/shared';
import { ArrowLeft, History, UserX } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import type { z } from 'zod';
import { ApiError, errorMessage } from '../../api/client';
import { Avatar } from '../../components/ui/avatar';
import { Badge } from '../../components/ui/badge';
import { Button, ButtonLink } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/states';
import { fullName, useCan, useSession } from '../../lib/auth';
import { formatDate, formatPhone } from '../../lib/format';
import { applyServerErrors } from '../../lib/forms';
import { AccountAccessCard } from './account-access-card';
import { RoleCard } from './role-card';
import { ROLE_TONES } from './role-meta';
import { useStaff, useUpdateStaff } from './staff-api';
import { PROFILE_FIELDS, profileFormValues } from './staff-profile';
import { StaffProfileFields } from './staff-profile-fields';

type FormInput = z.input<typeof updateStaffSchema>;
type FormOutput = z.output<typeof updateStaffSchema>;

function ProfileForm({ staff }: { staff: StaffDto }) {
  const update = useUpdateStaff(staff.id);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(updateStaffSchema),
    defaultValues: profileFormValues(staff),
  });
  const { errors, isDirty, dirtyFields } = form.formState;

  // Keep the form in step with the saved record (after a save or another tab's change).
  useEffect(() => form.reset(profileFormValues(staff)), [staff, form]);

  const submit = form.handleSubmit((values) => {
    const changes = Object.fromEntries(
      PROFILE_FIELDS.filter((field) => dirtyFields[field]).map((field) => [field, values[field]]),
    ) as UpdateStaffInput;
    if (Object.keys(changes).length === 0) return;
    update.mutate(changes, {
      onSuccess: () => toast.success('Details saved'),
      onError: (error) => {
        if (!applyServerErrors(error, form.setError, PROFILE_FIELDS))
          toast.error(errorMessage(error));
      },
    });
  });

  return (
    <form onSubmit={submit} noValidate>
      <div className="px-4 py-5 sm:px-5">
        <StaffProfileFields register={form.register} errors={errors} disabled={update.isPending} />
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-border px-4 py-3.5 sm:flex-row sm:justify-end sm:px-5">
        <Button
          variant="ghost"
          disabled={!isDirty || update.isPending}
          onClick={() => form.reset(profileFormValues(staff))}
        >
          Discard changes
        </Button>
        <Button type="submit" disabled={!isDirty} loading={update.isPending}>
          Save details
        </Button>
      </div>
    </form>
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

/** What a Manager sees: staff:read without staff:manage. */
function ProfileDetails({ staff }: { staff: StaffDto }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-4 py-5 sm:grid-cols-2 sm:px-5">
      <Detail label="First name">{staff.firstName}</Detail>
      <Detail label="Last name">{staff.lastName}</Detail>
      <Detail label="Work email" wide>
        {staff.email}
      </Detail>
      <Detail label="Phone">{formatPhone(staff.phone)}</Detail>
      <Detail label="Job title">{staff.jobTitle ?? '—'}</Detail>
      <Detail label="Hire date">{formatDate(staff.hireDate)}</Detail>
      <Detail label="Internal notes" wide>
        <span className="whitespace-pre-line">{staff.notes ?? '—'}</span>
      </Detail>
    </dl>
  );
}

function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading staff member" className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Skeleton className="size-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-96" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

export function StaffDetailPage() {
  const { id = '' } = useParams();
  const session = useSession();
  const can = useCan();
  const staff = useStaff(id);

  const back = (
    <Link
      to="/staff"
      className="mb-4 inline-flex items-center gap-1.5 rounded-sm text-13 font-medium text-fg-secondary hover:text-fg"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Staff
    </Link>
  );

  if (staff.isPending)
    return (
      <>
        {back}
        <DetailSkeleton />
      </>
    );

  if (staff.isError) {
    const missing =
      staff.error instanceof ApiError && (staff.error.status === 404 || staff.error.status === 400);
    return (
      <>
        {back}
        <Card>
          {missing ? (
            <EmptyState
              icon={<UserX aria-hidden />}
              title="Staff member not found"
              description="The link may be wrong, or the person is a member rather than a staff account."
              action={
                <ButtonLink to="/staff" variant="secondary" size="sm">
                  Back to staff
                </ButtonLink>
              }
            />
          ) : (
            <ErrorState error={staff.error} onRetry={() => staff.refetch()} />
          )}
        </Card>
      </>
    );
  }

  const record = staff.data;
  const isSelf = record.id === session.user.id;
  const canManage = can('staff:manage');

  return (
    <>
      {back}
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar user={record} size="lg" />
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xl font-semibold tracking-tight text-fg sm:text-2xl">
              <span className="truncate">{fullName(record)}</span>
              <Badge tone={ROLE_TONES[record.role]}>{ROLE_LABELS[record.role]}</Badge>
              {!record.isActive && (
                <Badge tone="danger" dot>
                  Deactivated
                </Badge>
              )}
            </h1>
            <p className="mt-0.5 truncate text-sm text-fg-secondary">
              {record.jobTitle ? `${record.jobTitle} · ` : ''}
              {record.email}
            </p>
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

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader
            title="Details"
            description={
              canManage
                ? 'Changes are recorded in the audit log.'
                : 'Only an Admin can edit staff details.'
            }
          />
          {canManage ? <ProfileForm staff={record} /> : <ProfileDetails staff={record} />}
        </Card>
        <div className="flex flex-col gap-6">
          <RoleCard
            key={`${record.id}:${record.role}`}
            staff={record}
            canAssign={can('staff:assign-role')}
            isSelf={isSelf}
          />
          <AccountAccessCard staff={record} canManage={canManage} isSelf={isSelf} />
        </div>
      </div>
    </>
  );
}
