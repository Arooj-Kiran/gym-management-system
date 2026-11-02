import {
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_CONDITION_LABELS,
  EQUIPMENT_STATUS_LABELS,
  MAINTENANCE_TYPE_LABELS,
  type EquipmentDto,
  type EquipmentStatus,
  type MaintenanceRecordDto,
  type MaintenanceType,
} from '@gms/shared';
import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  ArchiveX,
  ArrowLeft,
  CircleCheck,
  CirclePause,
  Ellipsis,
  Pencil,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Badge, type BadgeTone } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyState, ErrorState, ListSkeleton, Skeleton } from '../../components/ui/states';
import { useCan, useSession } from '../../lib/auth';
import { formatDate, formatMoney } from '../../lib/format';
import { useEquipment, useMaintenanceHistory } from './equipment-api';
import {
  EquipmentFormDialog,
  EquipmentStatusDialog,
  RecordMaintenanceDialog,
} from './equipment-dialogs';
import { CONDITION_TONES, maintenanceDue, STATUS_TONES } from './equipment-format';

const MENU_ITEM =
  'flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm text-fg outline-none select-none data-[highlighted]:bg-surface-muted [&_svg]:size-4 [&_svg]:text-fg-muted';

const TYPE_TONES: Record<MaintenanceType, BadgeTone> = {
  PREVENTIVE: 'primary',
  REPAIR: 'warning',
  INSPECTION: 'neutral',
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-13 text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-right text-sm break-words text-fg">{children}</dd>
    </div>
  );
}

function MaintenanceRecord({
  record,
  currency,
}: {
  record: MaintenanceRecordDto;
  currency: string;
}) {
  const meta = [
    record.performedByName && `By ${record.performedByName}`,
    record.costMinor !== null && formatMoney(record.costMinor, currency),
    record.recordedByName && `Recorded by ${record.recordedByName}`,
  ].filter(Boolean);
  return (
    <li className="grid grid-cols-1 gap-x-6 gap-y-1 px-4 py-4 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:px-5">
      <p className="text-sm font-medium text-fg tabular-nums">{formatDate(record.performedOn)}</p>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={TYPE_TONES[record.type]}>{MAINTENANCE_TYPE_LABELS[record.type]}</Badge>
          <span className="text-13 text-fg-muted">
            Left in{' '}
            <span className="text-fg-secondary">
              {EQUIPMENT_CONDITION_LABELS[record.conditionAfter].toLowerCase()}
            </span>{' '}
            condition
            {record.nextMaintenanceDate && ` · next ${formatDate(record.nextMaintenanceDate)}`}
          </span>
        </div>
        <p className="mt-1.5 text-sm whitespace-pre-line text-fg">{record.description}</p>
        {record.repairNotes && (
          <p className="mt-1 text-13 whitespace-pre-line text-fg-secondary">{record.repairNotes}</p>
        )}
        {meta.length > 0 && <p className="mt-1.5 text-13 text-fg-muted">{meta.join(' · ')}</p>}
      </div>
    </li>
  );
}

function MaintenanceHistory({
  item,
  canRecord,
  onRecord,
}: {
  item: EquipmentDto;
  canRecord: boolean;
  onRecord: () => void;
}) {
  const { gym } = useSession();
  const history = useMaintenanceHistory(item.id);
  return (
    <Card>
      <CardHeader
        id="maintenance-history-heading"
        title="Maintenance history"
        description={
          history.data && history.data.length > 0
            ? `${history.data.length} ${history.data.length === 1 ? 'visit' : 'visits'}, newest first`
            : undefined
        }
      />
      {history.isPending ? (
        <ListSkeleton rows={3} label="Loading maintenance history" />
      ) : history.isError ? (
        <ErrorState error={history.error} onRetry={() => history.refetch()} />
      ) : history.data.length === 0 ? (
        <EmptyState
          icon={<Wrench aria-hidden />}
          title="No maintenance recorded"
          description="Services, inspections and repairs appear here with their cost and the condition they left the item in."
          action={
            canRecord && (
              <Button size="sm" variant="secondary" onClick={onRecord}>
                Record maintenance
              </Button>
            )
          }
        />
      ) : (
        <ul aria-labelledby="maintenance-history-heading" className="divide-y divide-border">
          {history.data.map((record) => (
            <MaintenanceRecord key={record.id} record={record} currency={gym.currencyCode} />
          ))}
        </ul>
      )}
    </Card>
  );
}

export function EquipmentDetailPage() {
  const { id = '' } = useParams();
  const can = useCan();
  const { gym } = useSession();
  const equipment = useEquipment(id);
  const [editing, setEditing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [nextStatus, setNextStatus] = useState<EquipmentStatus | null>(null);

  const back = (
    <Link
      to="/equipment"
      className="inline-flex items-center gap-1.5 text-13 text-fg-secondary hover:text-fg"
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      Equipment
    </Link>
  );

  if (equipment.isPending)
    return (
      <>
        <PageHeader eyebrow={back} title="Equipment" />
        <Card className="p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-3 h-4 w-72" />
        </Card>
      </>
    );
  if (equipment.isError)
    return (
      <>
        <PageHeader eyebrow={back} title="Equipment" />
        <Card>
          <ErrorState error={equipment.error} onRetry={() => equipment.refetch()} />
        </Card>
      </>
    );

  const item = equipment.data;
  const retired = item.status === 'RETIRED';
  const canManage = can('equipment:manage') && !retired;
  const due = maintenanceDue(item);
  const makeModel = [item.brand, item.model].filter(Boolean).join(' ');

  return (
    <>
      <PageHeader
        eyebrow={back}
        title={item.name}
        description={
          <>
            <span className="font-mono">{item.assetTag}</span> ·{' '}
            {EQUIPMENT_CATEGORY_LABELS[item.category]}
            {item.location && ` · ${item.location}`}
          </>
        }
        actions={
          canManage && (
            <>
              <Button icon={<Wrench aria-hidden />} onClick={() => setRecording(true)}>
                Record maintenance
              </Button>
              <Button
                variant="secondary"
                icon={<Pencil aria-hidden />}
                onClick={() => setEditing(true)}
              >
                Edit details
              </Button>
              <Menu.Root>
                <Menu.Trigger asChild>
                  <Button
                    variant="secondary"
                    icon={<Ellipsis aria-hidden />}
                    aria-label="Change status"
                  />
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Content
                    align="end"
                    sideOffset={6}
                    className="z-50 w-56 rounded-lg border border-border bg-surface p-1.5 shadow-lg animate-pop-in"
                  >
                    {item.status === 'OUT_OF_SERVICE' ? (
                      <Menu.Item className={MENU_ITEM} onSelect={() => setNextStatus('IN_SERVICE')}>
                        <CircleCheck aria-hidden />
                        Return to service
                      </Menu.Item>
                    ) : (
                      <Menu.Item
                        className={MENU_ITEM}
                        onSelect={() => setNextStatus('OUT_OF_SERVICE')}
                      >
                        <CirclePause aria-hidden />
                        Take out of service
                      </Menu.Item>
                    )}
                    <Menu.Separator className="my-1 h-px bg-border" />
                    <Menu.Item className={MENU_ITEM} onSelect={() => setNextStatus('RETIRED')}>
                      <ArchiveX aria-hidden />
                      Retire item
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Portal>
              </Menu.Root>
            </>
          )
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="order-2 flex min-w-0 flex-col gap-6 lg:order-1">
          {item.status !== 'IN_SERVICE' && (
            <div
              role="status"
              className="flex items-start gap-3 rounded-lg border border-border bg-warning-subtle px-4 py-3 text-sm text-warning-text"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                <span className="font-medium">{retired ? 'Retired.' : 'Out of service.'}</span>{' '}
                {item.outOfServiceReason ??
                  (retired ? 'This item can no longer change.' : 'No reason was given.')}
              </p>
            </div>
          )}
          <MaintenanceHistory
            item={item}
            canRecord={canManage}
            onRecord={() => setRecording(true)}
          />
        </div>

        <div className="order-1 flex flex-col gap-6 lg:order-2">
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap gap-2">
              <Badge tone={STATUS_TONES[item.status]} dot>
                {EQUIPMENT_STATUS_LABELS[item.status]}
              </Badge>
              <Badge tone={CONDITION_TONES[item.condition]}>
                {EQUIPMENT_CONDITION_LABELS[item.condition]} condition
              </Badge>
              {due?.urgent && <Badge tone={due.tone}>{due.label}</Badge>}
            </div>
            <dl className="divide-y divide-border">
              <Fact label="Next service">
                {item.nextMaintenanceDate && !retired ? formatDate(item.nextMaintenanceDate) : '—'}
              </Fact>
              <Fact label="Last service">
                {item.lastMaintenanceOn ? formatDate(item.lastMaintenanceOn) : '—'}
              </Fact>
              <Fact label="Service every">
                {item.maintenanceIntervalDays ? `${item.maintenanceIntervalDays} days` : '—'}
              </Fact>
              <Fact label="Make and model">{makeModel || '—'}</Fact>
              <Fact label="Serial number">
                {item.serialNumber ? (
                  <span className="font-mono text-13">{item.serialNumber}</span>
                ) : (
                  '—'
                )}
              </Fact>
              <Fact label="Purchased">
                {item.purchaseDate ? formatDate(item.purchaseDate) : '—'}
              </Fact>
              {item.purchaseCostMinor !== null && (
                <Fact label="Cost">
                  <span className="tabular-nums">
                    {formatMoney(item.purchaseCostMinor, gym.currencyCode)}
                  </span>
                </Fact>
              )}
            </dl>
          </Card>
          {item.notes && (
            <Card className="p-5">
              <h2 className="text-13 font-medium text-fg-muted">Notes</h2>
              <p className="mt-1.5 text-sm whitespace-pre-line text-fg">{item.notes}</p>
            </Card>
          )}
        </div>
      </div>

      {canManage && (
        <>
          {editing && <EquipmentFormDialog item={item} open onOpenChange={setEditing} />}
          {recording && <RecordMaintenanceDialog item={item} open onOpenChange={setRecording} />}
          <EquipmentStatusDialog
            item={item}
            status={nextStatus}
            onOpenChange={(open) => !open && setNextStatus(null)}
          />
        </>
      )}
    </>
  );
}
