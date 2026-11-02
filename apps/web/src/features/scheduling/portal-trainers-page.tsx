import { Dumbbell, ShieldCheck } from 'lucide-react';
import { Avatar } from '../../components/ui/avatar';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/states';
import { fullName } from '../../lib/auth';
import { useMyTrainers } from './scheduling-api';
import { SpecializationTags } from './trainers-page';

/** Public trainer profiles; the member's own trainer first. */
export function PortalTrainersPage() {
  const trainers = useMyTrainers();
  const sorted = [...(trainers.data ?? [])].sort(
    (a, b) => Number(b.assignedToMe) - Number(a.assignedToMe),
  );

  return (
    <>
      <PageHeader
        title="Trainers"
        description="Who coaches at the gym. To book personal training, ask the front desk or your trainer."
      />
      {trainers.isPending ? (
        <div role="status" aria-label="Loading trainers" className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : trainers.isError ? (
        <Card>
          <ErrorState error={trainers.error} onRetry={() => trainers.refetch()} />
        </Card>
      ) : sorted.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Dumbbell aria-hidden />}
            title="No trainer profiles yet"
            description="Ask the front desk about personal training."
          />
        </Card>
      ) : (
        <ul aria-label="Trainers" className="grid gap-6 md:grid-cols-2">
          {sorted.map((trainer) => (
            <li key={trainer.id}>
              <Card className="flex h-full flex-col gap-4 p-5">
                <div className="flex items-center gap-4">
                  <Avatar user={trainer} size="lg" />
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-fg">{fullName(trainer)}</h2>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {trainer.assignedToMe && (
                        <Badge tone="primary" dot>
                          Your trainer
                        </Badge>
                      )}
                      {!trainer.isBookable && <Badge tone="neutral">Classes only</Badge>}
                    </div>
                  </div>
                </div>
                {trainer.bio && <p className="text-13 text-fg-secondary">{trainer.bio}</p>}
                <SpecializationTags tags={trainer.specializations} />
                {trainer.certifications.length > 0 && (
                  <p className="mt-auto flex items-start gap-2 border-t border-border pt-3 text-13 text-fg-muted">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>{trainer.certifications.join(' · ')}</span>
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
