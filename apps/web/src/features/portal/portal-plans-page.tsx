import { PLAN_TYPE_LABELS, type PlanDto } from '@gms/shared';
import { CalendarDays, Check, Clock, Tags } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/states';
import { useSession } from '../../lib/auth';
import { formatMoney } from '../../lib/format';
import { planDays, planDuration, planHours } from '../plans/plan-format';
import { usePlanList } from '../plans/plans-api';

function PlanCard({ plan, currency }: { plan: PlanDto; currency: string }) {
  return (
    <li>
      <Card className="flex h-full flex-col">
        <div className="border-b border-border px-5 py-4">
          <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
            {PLAN_TYPE_LABELS[plan.planType]} · {planDuration(plan)}
          </p>
          <h2 className="mt-1 text-base font-semibold text-fg">{plan.name}</h2>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-fg tabular-nums">
            {formatMoney(plan.priceMinor, currency)}
          </p>
          {plan.allowPartialPayment && (
            <p className="mt-0.5 text-13 text-fg-muted">Can be paid in instalments</p>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-4 px-5 py-4">
          {plan.description && <p className="text-13 text-fg-secondary">{plan.description}</p>}
          {plan.benefits.length > 0 && (
            <ul className="flex flex-col gap-1.5 text-13 text-fg">
              {plan.benefits.map((benefit) => (
                <li key={benefit} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  {benefit}
                </li>
              ))}
            </ul>
          )}
          <dl className="mt-auto flex flex-col gap-1.5 border-t border-border pt-3 text-13 text-fg-secondary">
            <div className="flex items-center gap-2">
              <dt>
                <CalendarDays className="size-4 text-fg-muted" aria-hidden />
                <span className="sr-only">Days</span>
              </dt>
              <dd>{planDays(plan.accessDays)}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt>
                <Clock className="size-4 text-fg-muted" aria-hidden />
                <span className="sr-only">Hours</span>
              </dt>
              <dd>{planHours(plan)}</dd>
            </div>
          </dl>
        </div>
      </Card>
    </li>
  );
}

/** Read-only list of active plans (plans:read is LIMITED for members). */
export function PortalPlansPage() {
  const { gym } = useSession();
  const list = usePlanList({
    page: 1,
    pageSize: 100,
    status: 'active',
    sort: 'price',
    order: 'asc',
  });

  return (
    <>
      <PageHeader
        title="Membership plans"
        eyebrow={gym.name}
        description="Plans currently offered. To join or renew, visit the front desk."
      />
      {list.isPending ? (
        <div
          role="status"
          aria-label="Loading plans"
          className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3"
        >
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      ) : list.isError ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        </Card>
      ) : list.data.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Tags aria-hidden />}
            title="No plans are on offer right now"
            description="Ask the front desk about current membership options."
          />
        </Card>
      ) : (
        <ul
          aria-label="Membership plans"
          className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3"
        >
          {list.data.data.map((plan) => (
            <PlanCard key={plan.id} plan={plan} currency={gym.currencyCode} />
          ))}
        </ul>
      )}
    </>
  );
}
