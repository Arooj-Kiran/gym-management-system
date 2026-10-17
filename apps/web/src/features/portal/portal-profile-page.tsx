import { zodResolver } from '@hookform/resolvers/zod';
import { updateMyProfileSchema, type MyProfileDto, type UpdateMyProfileInput } from '@gms/shared';
import { Ban, UserX } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { ApiError, errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { FormField, Input } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/states';
import { fullName, useSession } from '../../lib/auth';
import { formatDate, formatPhone } from '../../lib/format';
import { applyServerErrors } from '../../lib/forms';
import { PhotoPicker } from '../members/member-side-cards';
import { useMyProfile, useUpdateMyProfile, useUploadMyPhoto } from './portal-api';

const CONTACT_FIELDS = [
  'emergencyContactName',
  'emergencyContactRelation',
  'emergencyContactPhone',
] as const;

type FormInput = z.input<typeof updateMyProfileSchema>;
type FormOutput = z.output<typeof updateMyProfileSchema>;

const contactValues = (profile: MyProfileDto) => ({
  emergencyContactName: profile.emergencyContactName ?? '',
  emergencyContactRelation: profile.emergencyContactRelation ?? '',
  emergencyContactPhone: profile.emergencyContactPhone ?? '',
});

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-13 text-fg-muted">{label}</dt>
      <dd className="text-sm break-words text-fg sm:text-right">{children}</dd>
    </div>
  );
}

function EmergencyContactForm({ profile }: { profile: MyProfileDto }) {
  const update = useUpdateMyProfile();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(updateMyProfileSchema),
    defaultValues: contactValues(profile),
  });
  const { errors, isDirty, dirtyFields } = form.formState;

  useEffect(() => form.reset(contactValues(profile)), [profile, form]);

  const submit = form.handleSubmit((values) => {
    const changes = Object.fromEntries(
      CONTACT_FIELDS.filter((field) => dirtyFields[field]).map((field) => [field, values[field]]),
    ) as UpdateMyProfileInput;
    if (Object.keys(changes).length === 0) return;
    update.mutate(changes, {
      onSuccess: () => toast.success('Emergency contact saved'),
      onError: (error) => {
        if (!applyServerErrors(error, form.setError, CONTACT_FIELDS))
          toast.error(errorMessage(error));
      },
    });
  });

  return (
    <form onSubmit={submit} noValidate aria-label="Emergency contact">
      <div className="grid grid-cols-1 gap-4 px-4 py-5 sm:grid-cols-2 sm:px-5">
        <FormField label="Contact name" optional error={errors.emergencyContactName?.message}>
          <Input
            autoComplete="off"
            disabled={update.isPending}
            {...form.register('emergencyContactName')}
          />
        </FormField>
        <FormField label="Relation" optional error={errors.emergencyContactRelation?.message}>
          <Input
            autoComplete="off"
            placeholder="e.g. Sister"
            disabled={update.isPending}
            {...form.register('emergencyContactRelation')}
          />
        </FormField>
        <FormField
          label="Contact phone"
          optional
          error={errors.emergencyContactPhone?.message}
          hint="Numbers without +92 are read as Pakistani."
          className="sm:col-span-2"
        >
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            disabled={update.isPending}
            {...form.register('emergencyContactPhone')}
          />
        </FormField>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-border px-4 py-3.5 sm:flex-row sm:justify-end sm:px-5">
        <Button
          variant="ghost"
          disabled={!isDirty || update.isPending}
          onClick={() => form.reset(contactValues(profile))}
        >
          Discard changes
        </Button>
        <Button type="submit" disabled={!isDirty} loading={update.isPending}>
          Save contact
        </Button>
      </div>
    </form>
  );
}

function ProfileSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading your profile"
      className="grid grid-cols-1 gap-6 lg:grid-cols-2"
    >
      <Skeleton className="h-80" />
      <Skeleton className="h-80" />
    </div>
  );
}

export function PortalProfilePage() {
  const { gym } = useSession();
  const profile = useMyProfile();
  const upload = useUploadMyPhoto();

  const header = (
    <PageHeader
      title="My profile"
      eyebrow={gym.name}
      description="Your membership details. Ask the front desk to correct your name, phone or email."
    />
  );

  if (profile.isPending)
    return (
      <>
        {header}
        <ProfileSkeleton />
      </>
    );

  if (profile.isError) {
    const missing = profile.error instanceof ApiError && profile.error.status === 404;
    return (
      <>
        {header}
        <Card>
          {missing ? (
            <EmptyState
              icon={<UserX aria-hidden />}
              title="No member profile is linked to this login"
              description="Please ask the front desk to check your membership record."
            />
          ) : (
            <ErrorState error={profile.error} onRetry={() => profile.refetch()} />
          )}
        </Card>
      </>
    );
  }

  const me = profile.data;
  return (
    <>
      {header}
      {me.accessBlocked && (
        <div
          role="status"
          className="mb-6 flex items-start gap-3 rounded-lg bg-danger-subtle px-4 py-3 text-13 text-danger-text"
        >
          <Ban className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>Gym entry is currently blocked on your account. Please speak to the front desk.</p>
        </div>
      )}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Card>
          <PhotoPicker
            member={me}
            uploading={upload.isPending}
            label="Add your photo"
            onUpload={(file, done) =>
              upload.mutate(file, {
                onSuccess: () => toast.success('Photo updated'),
                onError: (error) => toast.error(errorMessage(error)),
                onSettled: done,
              })
            }
          />
          <dl className="divide-y divide-border border-t border-border px-4 sm:px-5">
            <Row label="Name">{fullName(me)}</Row>
            <Row label="Member code">
              <span className="font-mono">{me.memberCode}</span>
            </Row>
            <Row label="Phone">{formatPhone(me.phone)}</Row>
            <Row label="Email">{me.email ?? '—'}</Row>
            <Row label="Member since">{formatDate(me.registrationDate)}</Row>
            <Row label="Account">
              {me.accountStatus === 'ACTIVE' ? (
                <Badge tone="success" dot>
                  Active
                </Badge>
              ) : (
                <Badge tone="warning" dot>
                  Inactive
                </Badge>
              )}
            </Row>
          </dl>
        </Card>
        <Card>
          <CardHeader
            title="Emergency contact"
            description="Who we call if something happens to you at the gym."
          />
          <EmergencyContactForm profile={me} />
        </Card>
      </div>
    </>
  );
}
