import { permissionScope, TRAINER_LIMITS, type TrainerDto } from '@gms/shared';
import { ArrowLeft, Mail, Pencil, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Avatar } from '../../components/ui/avatar';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Input, Textarea } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { ErrorState, ListSkeleton, Skeleton } from '../../components/ui/states';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { fullName, useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { FormProblem } from './form-parts';
import { splitServerError, type Errors } from './form-utils';
import { ScheduleList } from './schedule-list';
import { useTrainer, useTrainerSchedule, useUpdateTrainer } from './scheduling-api';
import { TrainerHours } from './trainer-hours';
import { TrainerMembers } from './trainer-members';
import { SpecializationTags } from './trainers-page';
import { useWeek } from './use-week';
import { WeekNav } from './week-nav';

type Tab = 'schedule' | 'hours' | 'members';

/** "Strength, Mobility" ⇄ ["Strength", "Mobility"]. */
const parseTags = (value: string) =>
  value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

function ProfileDialog({
  trainer,
  fullEdit,
  onOpenChange,
}: {
  trainer: TrainerDto;
  /** Admin/Manager: certifications and "taking clients" as well as bio and specializations. */
  fullEdit: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateTrainer();
  const [bio, setBio] = useState(trainer.bio ?? '');
  const [specializations, setSpecializations] = useState(trainer.specializations.join(', '));
  const [certifications, setCertifications] = useState(trainer.certifications.join(', '));
  const [isBookable, setIsBookable] = useState(trainer.isBookable);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string | null>(null);

  const tagError = (tags: string[]) =>
    tags.length > TRAINER_LIMITS.tagsMax
      ? `Add at most ${TRAINER_LIMITS.tagsMax}`
      : tags.some((tag) => tag.length > TRAINER_LIMITS.tagMax)
        ? `Each entry must be ${TRAINER_LIMITS.tagMax} characters or fewer`
        : undefined;
  const errors: Errors = {
    specializations: tagError(parseTags(specializations)),
    certifications: fullEdit ? tagError(parseTags(certifications)) : undefined,
  };
  const shown: Errors = {
    specializations: serverErrors.specializations ?? errors.specializations,
    certifications: serverErrors.certifications ?? errors.certifications,
    bio: serverErrors.bio,
  };

  const submit = () => {
    setServerErrors({});
    setProblem(null);
    if (errors.specializations || errors.certifications) return;
    update.mutate(
      {
        id: trainer.id,
        input: {
          bio: bio.trim() || null,
          specializations: parseTags(specializations),
          ...(fullEdit ? { certifications: parseTags(certifications), isBookable } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success('Profile saved');
          onOpenChange(false);
        },
        onError: (error) => {
          const { fields, problem: message } = splitServerError(error);
          setServerErrors(fields);
          setProblem(message);
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Edit trainer profile"
      description="Members see the bio, specializations and certifications in the portal."
      size="lg"
      busy={update.isPending}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={update.isPending}
          >
            Cancel
          </Button>
          <Button onClick={submit} loading={update.isPending}>
            Save profile
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
        <FormProblem message={problem} />
        <FormField label="Bio" optional error={shown.bio}>
          <Textarea
            rows={4}
            value={bio}
            maxLength={TRAINER_LIMITS.bioMax}
            placeholder="Coaching background and the members you work best with"
            onChange={(event) => setBio(event.target.value)}
          />
        </FormField>
        <FormField
          label="Specializations"
          optional
          error={shown.specializations}
          hint="Separate with commas, e.g. Strength, Mobility, Rehab"
        >
          <Input
            value={specializations}
            onChange={(event) => setSpecializations(event.target.value)}
          />
        </FormField>
        {fullEdit && (
          <>
            <FormField
              label="Certifications"
              optional
              error={shown.certifications}
              hint="Separate with commas"
            >
              <Input
                value={certifications}
                onChange={(event) => setCertifications(event.target.value)}
              />
            </FormField>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-fg">
              <input
                type="checkbox"
                checked={isBookable}
                onChange={(event) => setIsBookable(event.target.checked)}
                className="mt-0.5 size-4 cursor-pointer accent-primary"
              />
              <span>
                Taking personal-training clients
                <span className="block text-13 text-fg-muted">
                  When off, no new appointments can be booked. Classes are not affected.
                </span>
              </span>
            </label>
          </>
        )}
        {!fullEdit && (
          <p className="text-13 text-fg-muted">
            Certifications and whether you take clients are changed by an Admin or Manager.
          </p>
        )}
      </form>
    </Dialog>
  );
}

function TrainerSchedule({ trainerId, isMe }: { trainerId: string; isMe: boolean }) {
  const week = useWeek();
  const schedule = useTrainerSchedule(trainerId, { from: week.from, to: week.to });
  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:px-5">
        <WeekNav week={week} />
        <p className="text-13 text-fg-muted sm:ml-auto">
          {isMe
            ? 'Your classes, appointments, shifts and time off.'
            : 'Classes, appointments and time off.'}
        </p>
      </div>
      {schedule.isPending ? (
        <ListSkeleton rows={6} label="Loading the schedule" />
      ) : schedule.isError ? (
        <ErrorState error={schedule.error} onRetry={() => schedule.refetch()} />
      ) : (
        <div
          aria-busy={schedule.isPlaceholderData}
          className={cn(schedule.isPlaceholderData && 'opacity-60')}
        >
          <ScheduleList
            items={schedule.data}
            from={week.from}
            to={week.to}
            today={week.today}
            label="Schedule by day"
          />
        </div>
      )}
    </Card>
  );
}

export function TrainerDetailPage() {
  const { id = '' } = useParams();
  const { user } = useSession();
  const trainer = useTrainer(id);
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);

  const isMe = user.id === id;
  const scope = (permission: Parameters<typeof permissionScope>[1]) =>
    permissionScope(user.role, permission);
  const editScope = scope('trainers:manage');
  const canEditProfile = editScope === 'ALL' || (editScope === 'OWN' && isMe);
  const hoursScope = scope('trainers:manage-availability');
  const canManageHours = hoursScope === 'ALL' || (hoursScope === 'OWN' && isMe);
  const seesMembers = scope('trainer-assignments:read') === 'ALL';
  const canAssign = scope('trainer-assignments:manage') === 'ALL';
  const linkMembers = scope('members:read') === 'ALL';

  const back = (
    <Link
      to="/trainers"
      className="inline-flex items-center gap-1.5 text-13 text-fg-secondary hover:text-fg"
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      Trainers
    </Link>
  );

  if (trainer.isPending)
    return (
      <>
        <PageHeader eyebrow={back} title="Trainer" />
        <Card className="p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-3 h-4 w-72" />
        </Card>
      </>
    );
  if (trainer.isError)
    return (
      <>
        <PageHeader eyebrow={back} title="Trainer" />
        <Card>
          <ErrorState error={trainer.error} onRetry={() => trainer.refetch()} />
        </Card>
      </>
    );

  const t = trainer.data;
  const name = fullName(t);
  const tabs: { value: Tab; label: string }[] = [
    { value: 'schedule', label: 'Schedule' },
    { value: 'hours', label: 'Hours and time off' },
    ...(seesMembers
      ? [{ value: 'members' as const, label: `Members (${t.activeMemberCount})` }]
      : []),
  ];
  // The tab lives in the URL (`?tab=hours`), so other screens can link straight to it.
  const tab: Tab = tabs.find((option) => option.value === params.get('tab'))?.value ?? 'schedule';
  const setTab = (next: Tab) =>
    setParams(next === 'schedule' ? {} : { tab: next }, { replace: true });

  return (
    <>
      <PageHeader
        eyebrow={back}
        title={isMe ? `${name} (you)` : name}
        actions={
          canEditProfile && (
            <Button
              variant="secondary"
              icon={<Pencil aria-hidden />}
              onClick={() => setEditing(true)}
            >
              Edit profile
            </Button>
          )
        }
      />

      <Card className="mb-6 flex flex-col gap-5 p-5 sm:flex-row">
        <Avatar user={t} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {!t.isActive ? (
              <Badge tone="neutral">Inactive account</Badge>
            ) : t.isBookable ? (
              <Badge tone="success" dot>
                Taking clients
              </Badge>
            ) : (
              <Badge tone="warning" dot>
                Not taking clients
              </Badge>
            )}
            <span className="inline-flex items-center gap-1.5 text-13 text-fg-secondary tabular-nums">
              <UsersRound className="size-4 text-fg-muted" aria-hidden />
              {t.activeMemberCount} assigned {t.activeMemberCount === 1 ? 'member' : 'members'}
            </span>
            <a
              href={`mailto:${t.email}`}
              className="inline-flex items-center gap-1.5 text-13 text-fg-secondary hover:text-fg hover:underline"
            >
              <Mail className="size-4 text-fg-muted" aria-hidden />
              {t.email}
            </a>
          </div>
          <p className={cn('mt-3 max-w-prose text-sm', t.bio ? 'text-fg' : 'text-fg-muted')}>
            {t.bio ?? 'No bio yet.'}
          </p>
          {(t.specializations.length > 0 || t.certifications.length > 0) && (
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              {t.specializations.length > 0 && (
                <div>
                  <dt className="mb-1.5 text-xs font-medium tracking-wide text-fg-muted uppercase">
                    Specializations
                  </dt>
                  <dd>
                    <SpecializationTags tags={t.specializations} />
                  </dd>
                </div>
              )}
              {t.certifications.length > 0 && (
                <div>
                  <dt className="mb-1.5 text-xs font-medium tracking-wide text-fg-muted uppercase">
                    Certifications
                  </dt>
                  <dd className="text-13 text-fg-secondary">{t.certifications.join(' · ')}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      </Card>

      <Tabs
        label="Trainer"
        idPrefix="trainer"
        value={tab}
        onChange={setTab}
        tabs={tabs}
        className="mb-4"
      />
      <TabPanel idPrefix="trainer" value={tab}>
        {tab === 'schedule' ? (
          <TrainerSchedule trainerId={t.id} isMe={isMe} />
        ) : tab === 'hours' ? (
          <TrainerHours trainerId={t.id} trainerName={name} canManage={canManageHours} />
        ) : (
          <TrainerMembers
            trainerId={t.id}
            trainerName={name}
            canManage={canAssign}
            linkMembers={linkMembers}
          />
        )}
      </TabPanel>

      {canEditProfile && editing && (
        <ProfileDialog trainer={t} fullEdit={editScope === 'ALL'} onOpenChange={setEditing} />
      )}
    </>
  );
}
