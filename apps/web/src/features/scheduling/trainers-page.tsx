import type { TrainerDto } from '@gms/shared';
import { ChevronRight, Dumbbell, UsersRound } from 'lucide-react';
import { Link } from 'react-router';
import { Avatar } from '../../components/ui/avatar';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { fullName, useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { useTrainers } from './scheduling-api';

export function SpecializationTags({ tags, limit }: { tags: string[]; limit?: number }) {
  const shown = limit ? tags.slice(0, limit) : tags;
  const rest = tags.length - shown.length;
  if (tags.length === 0) return null;
  return (
    <ul aria-label="Specializations" className="flex flex-wrap gap-1.5">
      {shown.map((tag) => (
        <li
          key={tag}
          className="rounded-sm border border-border bg-surface-muted px-1.5 py-0.5 text-xs text-fg-secondary"
        >
          {tag}
        </li>
      ))}
      {rest > 0 && <li className="px-1 py-0.5 text-xs text-fg-muted">+{rest} more</li>}
    </ul>
  );
}

function TrainerRow({ trainer, isMe }: { trainer: TrainerDto; isMe: boolean }) {
  return (
    <li>
      <Link
        to={`/trainers/${trainer.id}`}
        className={cn(
          'group flex items-center gap-4 px-4 py-4 transition-colors duration-150 hover:bg-surface-hover focus-visible:-outline-offset-2 sm:px-5',
          !trainer.isActive && 'opacity-60',
        )}
      >
        <Avatar user={trainer} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
            {fullName(trainer)}
            {isMe && <Badge tone="primary">You</Badge>}
            {!trainer.isActive ? (
              <Badge tone="neutral">Inactive</Badge>
            ) : !trainer.isBookable ? (
              <Badge tone="warning">Not taking clients</Badge>
            ) : (
              !trainer.hasWeeklyHours && <Badge tone="warning">No weekly hours</Badge>
            )}
          </p>
          {trainer.bio && (
            <p className="mt-0.5 line-clamp-1 text-13 text-fg-muted">{trainer.bio}</p>
          )}
          <div className="mt-2">
            <SpecializationTags tags={trainer.specializations} limit={4} />
          </div>
        </div>
        <p className="hidden shrink-0 items-center gap-1.5 text-13 text-fg-secondary tabular-nums sm:flex">
          <UsersRound className="size-4 text-fg-muted" aria-hidden />
          {trainer.activeMemberCount} {trainer.activeMemberCount === 1 ? 'member' : 'members'}
        </p>
        <ChevronRight
          className="size-4 shrink-0 text-fg-muted transition-transform duration-150 group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
    </li>
  );
}

export function TrainersPage() {
  const { user } = useSession();
  const trainers = useTrainers();

  return (
    <>
      <PageHeader
        title="Trainers"
        description="Profiles, weekly hours, schedules and assigned members."
      />
      <Card>
        {trainers.isPending ? (
          <ListSkeleton rows={4} label="Loading trainers" />
        ) : trainers.isError ? (
          <ErrorState error={trainers.error} onRetry={() => trainers.refetch()} />
        ) : trainers.data.length === 0 ? (
          <EmptyState
            icon={<Dumbbell aria-hidden />}
            title="No trainers yet"
            description="An Admin adds a trainer from Staff by giving the account the Trainer role."
          />
        ) : (
          <ul aria-label="Trainers" className="divide-y divide-border">
            {trainers.data.map((trainer) => (
              <TrainerRow key={trainer.id} trainer={trainer} isMe={trainer.id === user.id} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
