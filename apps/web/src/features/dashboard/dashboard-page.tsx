import { permissionScope, ROLE_LABELS } from '@gms/shared';
import { useState } from 'react';
import { Card } from '../../components/ui/card';
import { PageHeader } from '../../components/ui/page-header';
import { ErrorState } from '../../components/ui/states';
import { useCan, useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { gymTodayIso } from '../../lib/format';
import { RecordPaymentDialog } from '../billing/record-payment-dialog';
import { quickActionsFor } from './dashboard-actions';
import { useDashboardSummary } from './dashboard-api';
import {
  MemberActivity,
  QuickActions,
  RecentActivity,
  RecentCheckIns,
  SetupChecklist,
  TrainerSchedule,
} from './dashboard-lists';
import { PeriodOverview } from './dashboard-period';
import {
  AttendanceStats,
  BillingOverview,
  MemberOverview,
  MembershipOverview,
  Stat,
  StaffStats,
  TrainerStats,
} from './dashboard-stats';

function greeting(date = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Asia/Karachi',
    }).format(date),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Role home: shows only what the signed-in role can actually use today. */
export function DashboardPage() {
  const session = useSession();
  const can = useCan();
  const role = session.user.role;

  // Mirrors the server: whole-gym member figures need unscoped member access.
  const seesMembers = permissionScope(role, 'members:read') === 'ALL';

  const summary = useDashboardSummary();
  const attendance = summary.data?.attendance ?? null;
  const billing = summary.data?.billing ?? null;
  const trainer = summary.data?.trainer ?? null;
  const isTrainer = role === 'TRAINER';
  const [recordingPayment, setRecordingPayment] = useState(false);
  const canRecordPayment = billing !== null && can('payments:record');
  const actions = quickActionsFor({
    role,
    userId: session.user.id,
    can,
    seesMembers,
    seesBilling: billing !== null,
    seesAttendance: attendance !== null,
    onRecordPayment: canRecordPayment ? () => setRecordingPayment(true) : null,
  });

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            {session.gym.name}
            <span aria-hidden>·</span>
            {ROLE_LABELS[role]}
          </span>
        }
        title={`${greeting()}, ${session.user.firstName}`}
        description={
          seesMembers
            ? 'Here is the current state of your members and recent front-desk activity.'
            : isTrainer
              ? 'Your classes, personal-training sessions and members. Times are in gym time.'
              : 'Your workspace: the screens your role uses day to day.'
        }
      />

      <div className="flex flex-col gap-6">
        {isTrainer && summary.isError && (
          <Card>
            <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
          </Card>
        )}
        {isTrainer && summary.isPending && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="On your schedule today" value={0} loading />
            <Stat label="Next 7 days" value={0} loading />
            <Stat label="Assigned members" value={0} loading />
          </div>
        )}
        {trainer && <TrainerStats trainer={trainer} />}
        {seesMembers && <MemberOverview />}
        {attendance && (
          <AttendanceStats
            attendance={attendance}
            canReadLog={can('access:read-log')}
            today={gymTodayIso()}
          />
        )}
        {billing && <BillingOverview billing={billing} today={gymTodayIso()} />}
        {seesMembers && can('memberships:read') && <MembershipOverview />}
        {/* Trainers get no period figures from the server, so they get no trends section. */}
        {!isTrainer && can('reports:operational') && <PeriodOverview />}
        {can('staff:read') && <StaffStats />}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            {can('settings:manage') && <SetupChecklist />}
            <QuickActions actions={actions} />
          </div>
          {(seesMembers || attendance || trainer || can('audit:read')) && (
            // A trainer's day comes before the shortcuts once the columns stack.
            <div className={cn('flex flex-col gap-6', isTrainer && 'order-first xl:order-none')}>
              {trainer && <TrainerSchedule trainer={trainer} trainerId={session.user.id} />}
              {attendance && <RecentCheckIns attendance={attendance} />}
              {seesMembers && <MemberActivity />}
              {can('audit:read') && <RecentActivity />}
            </div>
          )}
        </div>
      </div>
      {canRecordPayment && (
        <RecordPaymentDialog open={recordingPayment} onOpenChange={setRecordingPayment} />
      )}
    </>
  );
}
