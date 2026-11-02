import { zodResolver } from '@hookform/resolvers/zod';
import {
  createEquipmentSchema,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_CONDITION_LABELS,
  EQUIPMENT_CONDITIONS,
  EQUIPMENT_LIMITS,
  MAINTENANCE_TYPE_LABELS,
  MAINTENANCE_TYPES,
  recordMaintenanceSchema,
  type EquipmentDto,
  type EquipmentStatus,
} from '@gms/shared';
import {
  useForm,
  useWatch,
  type FieldValues,
  type Path,
  type UseFormSetError,
} from 'react-hook-form';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { z } from 'zod';
import { ApiError, errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Input, Select, Textarea } from '../../components/ui/form-field';
import { useSession } from '../../lib/auth';
import { formatDate, gymTodayIso } from '../../lib/format';
import { moneyInputValue } from '../billing/billing-format';
import {
  useChangeEquipmentStatus,
  useCreateEquipment,
  useRecordMaintenance,
  useUpdateEquipment,
} from './equipment-api';
import { emptyToNull, optionalMoneyInput } from './equipment-format';

/**
 * Put server field errors on the form. `renames` maps API paths to form fields where they
 * differ (costs are typed in major units but sent in minor units).
 */
function applyErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly string[],
  renames: Record<string, string> = {},
) {
  if (!(error instanceof ApiError) || error.details.length === 0) return false;
  let applied = false;
  for (const detail of error.details) {
    const field = renames[detail.path] ?? detail.path;
    if (!fields.includes(field)) continue;
    setError(
      field as Path<T>,
      { type: 'server', message: detail.message },
      { shouldFocus: !applied },
    );
    applied = true;
  }
  return applied;
}

// --- Add / edit -------------------------------------------------------------------------------

const equipmentFormSchema = createEquipmentSchema
  .omit({ purchaseCostMinor: true })
  .extend({ purchaseCost: optionalMoneyInput });
type EquipmentFormInput = z.input<typeof equipmentFormSchema>;
type EquipmentFormOutput = z.output<typeof equipmentFormSchema>;

const EQUIPMENT_FORM_ID = 'equipment-form';
const EQUIPMENT_FIELDS = [
  'name',
  'category',
  'brand',
  'model',
  'serialNumber',
  'location',
  'purchaseDate',
  'purchaseCost',
  'condition',
  'maintenanceIntervalDays',
  'nextMaintenanceDate',
  'notes',
];

const equipmentDefaults = (item?: EquipmentDto): EquipmentFormInput => ({
  name: item?.name ?? '',
  category: item?.category ?? ('' as EquipmentFormInput['category']),
  brand: item?.brand ?? '',
  model: item?.model ?? '',
  serialNumber: item?.serialNumber ?? '',
  location: item?.location ?? '',
  purchaseDate: item?.purchaseDate ?? '',
  purchaseCost:
    item && item.purchaseCostMinor !== null ? moneyInputValue(item.purchaseCostMinor) : '',
  condition: item?.condition ?? 'GOOD',
  maintenanceIntervalDays: item?.maintenanceIntervalDays ?? '',
  nextMaintenanceDate: item?.nextMaintenanceDate ?? '',
  notes: item?.notes ?? '',
});

export function EquipmentFormDialog({
  item,
  open,
  onOpenChange,
}: {
  /** Edit this item; omit to add a new one. */
  item?: EquipmentDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { gym } = useSession();
  const navigate = useNavigate();
  const create = useCreateEquipment();
  const update = useUpdateEquipment();
  const saving = create.isPending || update.isPending;
  const form = useForm<EquipmentFormInput, unknown, EquipmentFormOutput>({
    resolver: zodResolver(equipmentFormSchema),
    defaultValues: equipmentDefaults(item),
  });
  const { errors } = form.formState;
  const today = gymTodayIso();

  const close = (next: boolean) => {
    if (!next) form.reset(equipmentDefaults(item));
    onOpenChange(next);
  };

  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'DUPLICATE_SERIAL_NUMBER') {
      form.setError(
        'serialNumber',
        { type: 'server', message: error.message },
        { shouldFocus: true },
      );
      return;
    }
    const applied = applyErrors(error, form.setError, EQUIPMENT_FIELDS, {
      purchaseCostMinor: 'purchaseCost',
    });
    if (!applied) toast.error(errorMessage(error));
  };

  const submit = form.handleSubmit(({ purchaseCost, ...values }) => {
    const input = { ...values, purchaseCostMinor: purchaseCost };
    if (item) {
      update.mutate(
        { id: item.id, input },
        {
          onSuccess: (saved) => {
            toast.success(`${saved.name} saved`);
            onOpenChange(false);
          },
          onError,
        },
      );
    } else {
      create.mutate(input, {
        onSuccess: (saved) => {
          toast.success(`${saved.name} added as ${saved.assetTag}`);
          onOpenChange(false);
          form.reset(equipmentDefaults());
          navigate(`/equipment/${saved.id}`);
        },
        onError,
      });
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={item ? `Edit ${item.name}` : 'Add equipment'}
      description={
        item
          ? `${item.assetTag}. Status changes have their own action so they always carry a reason.`
          : 'An asset tag is given automatically when you save.'
      }
      size="lg"
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={EQUIPMENT_FORM_ID} loading={saving}>
            {item ? 'Save changes' : 'Add equipment'}
          </Button>
        </>
      }
    >
      <form
        id={EQUIPMENT_FORM_ID}
        onSubmit={submit}
        noValidate
        aria-label={item ? 'Edit equipment' : 'Add equipment'}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <FormField label="Name" error={errors.name?.message} className="sm:col-span-2">
          <Input autoComplete="off" placeholder="e.g. Treadmill 3" {...form.register('name')} />
        </FormField>
        <FormField label="Category" error={errors.category?.message}>
          <Select {...form.register('category')}>
            <option value="">Choose a category</option>
            {EQUIPMENT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {EQUIPMENT_CATEGORY_LABELS[category]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Condition" error={errors.condition?.message}>
          <Select {...form.register('condition')}>
            {EQUIPMENT_CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {EQUIPMENT_CONDITION_LABELS[condition]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Brand" optional error={errors.brand?.message}>
          <Input
            autoComplete="off"
            maxLength={EQUIPMENT_LIMITS.shortTextMax}
            {...form.register('brand')}
          />
        </FormField>
        <FormField label="Model" optional error={errors.model?.message}>
          <Input
            autoComplete="off"
            maxLength={EQUIPMENT_LIMITS.shortTextMax}
            {...form.register('model')}
          />
        </FormField>
        <FormField label="Serial number" optional error={errors.serialNumber?.message}>
          <Input
            autoComplete="off"
            maxLength={EQUIPMENT_LIMITS.shortTextMax}
            className="font-mono"
            {...form.register('serialNumber')}
          />
        </FormField>
        <FormField label="Location" optional error={errors.location?.message}>
          <Input
            autoComplete="off"
            maxLength={EQUIPMENT_LIMITS.shortTextMax}
            placeholder="e.g. Cardio floor"
            {...form.register('location')}
          />
        </FormField>
        <FormField label="Purchased on" optional error={errors.purchaseDate?.message}>
          <Input type="date" max={today} {...form.register('purchaseDate')} />
        </FormField>
        <FormField
          label={`Purchase cost (${gym.currencyCode})`}
          optional
          error={errors.purchaseCost?.message}
        >
          <Input inputMode="decimal" autoComplete="off" {...form.register('purchaseCost')} />
        </FormField>
        <FormField
          label="Service every (days)"
          optional
          error={errors.maintenanceIntervalDays?.message}
          hint="Sets the next date after each maintenance."
        >
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={EQUIPMENT_LIMITS.maxIntervalDays}
            {...form.register('maintenanceIntervalDays', { setValueAs: emptyToNull })}
          />
        </FormField>
        <FormField label="Next maintenance" optional error={errors.nextMaintenanceDate?.message}>
          <Input type="date" {...form.register('nextMaintenanceDate')} />
        </FormField>
        <FormField label="Notes" optional error={errors.notes?.message} className="sm:col-span-2">
          <Textarea rows={3} maxLength={EQUIPMENT_LIMITS.notesMax} {...form.register('notes')} />
        </FormField>
      </form>
    </Dialog>
  );
}

// --- Status -----------------------------------------------------------------------------------

const STATUS_COPY: Record<
  EquipmentStatus,
  { title: (name: string) => string; description: string; confirm: string; toast: string }
> = {
  IN_SERVICE: {
    title: (name) => `Return ${name} to service?`,
    description: 'Members and staff can use it again. The out-of-service reason is cleared.',
    confirm: 'Return to service',
    toast: 'back in service',
  },
  OUT_OF_SERVICE: {
    title: (name) => `Take ${name} out of service?`,
    description:
      'Use this while it waits for a repair or a part. Maintenance can still be recorded, and you can return it to service at any time.',
    confirm: 'Take out of service',
    toast: 'taken out of service',
  },
  RETIRED: {
    title: (name) => `Retire ${name}?`,
    description:
      'Retiring is final: the item stays in the register with its history, but it can no longer be edited, serviced or returned to service.',
    confirm: 'Retire item',
    toast: 'retired',
  },
};

export function EquipmentStatusDialog({
  item,
  status,
  onOpenChange,
}: {
  item: EquipmentDto;
  /** The status to move to; null keeps the dialog closed. */
  status: EquipmentStatus | null;
  onOpenChange: (open: boolean) => void;
}) {
  const change = useChangeEquipmentStatus();
  const copy = STATUS_COPY[status ?? 'OUT_OF_SERVICE'];
  return (
    <ConfirmDialog
      open={status !== null}
      onOpenChange={onOpenChange}
      title={copy.title(item.name)}
      description={copy.description}
      confirmLabel={copy.confirm}
      tone={status === 'RETIRED' ? 'danger' : 'primary'}
      reason={status === 'IN_SERVICE' ? 'optional' : 'required'}
      reasonLabel={status === 'IN_SERVICE' ? 'Note for the audit log' : 'Reason'}
      loading={change.isPending}
      onConfirm={(reason) =>
        status &&
        change.mutate(
          { id: item.id, input: { status, reason } },
          {
            onSuccess: (saved) => {
              toast.success(`${saved.name} ${copy.toast}`);
              onOpenChange(false);
            },
            onError: (error) => toast.error(errorMessage(error)),
          },
        )
      }
    />
  );
}

// --- Maintenance ------------------------------------------------------------------------------

const maintenanceFormSchema = recordMaintenanceSchema
  .omit({ costMinor: true })
  .extend({ cost: optionalMoneyInput });
type MaintenanceFormInput = z.input<typeof maintenanceFormSchema>;
type MaintenanceFormOutput = z.output<typeof maintenanceFormSchema>;

const MAINTENANCE_FORM_ID = 'maintenance-form';
const MAINTENANCE_FIELDS = [
  'type',
  'performedOn',
  'performedByName',
  'cost',
  'description',
  'repairNotes',
  'conditionAfter',
  'nextMaintenanceDate',
];

export function RecordMaintenanceDialog({
  item,
  open,
  onOpenChange,
}: {
  item: EquipmentDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { gym } = useSession();
  const record = useRecordMaintenance();
  const today = gymTodayIso();
  const defaults: MaintenanceFormInput = {
    type: 'PREVENTIVE',
    performedOn: today,
    performedByName: '',
    cost: '',
    description: '',
    repairNotes: '',
    conditionAfter: item.condition,
    nextMaintenanceDate: '',
  };
  const form = useForm<MaintenanceFormInput, unknown, MaintenanceFormOutput>({
    resolver: zodResolver(maintenanceFormSchema),
    defaultValues: defaults,
  });
  const { errors } = form.formState;
  const type = useWatch({ control: form.control, name: 'type' });

  const close = (next: boolean) => {
    if (!next) form.reset(defaults);
    onOpenChange(next);
  };

  const submit = form.handleSubmit(({ cost, ...values }) =>
    record.mutate(
      { id: item.id, input: { ...values, costMinor: cost } },
      {
        onSuccess: (saved) => {
          toast.success(
            saved.nextMaintenanceDate
              ? `Maintenance recorded · next due ${formatDate(saved.nextMaintenanceDate)}`
              : 'Maintenance recorded',
          );
          onOpenChange(false);
          form.reset(defaults);
        },
        onError: (error) => {
          const applied = applyErrors(error, form.setError, MAINTENANCE_FIELDS, {
            costMinor: 'cost',
          });
          if (!applied) toast.error(errorMessage(error));
        },
      },
    ),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Record maintenance"
      description={`${item.name} · ${item.assetTag}`}
      size="lg"
      busy={record.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={record.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={MAINTENANCE_FORM_ID} loading={record.isPending}>
            Save record
          </Button>
        </>
      }
    >
      <form
        id={MAINTENANCE_FORM_ID}
        onSubmit={submit}
        noValidate
        aria-label="Record maintenance"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <FormField label="Type" error={errors.type?.message}>
          <Select {...form.register('type')}>
            {MAINTENANCE_TYPES.map((value) => (
              <option key={value} value={value}>
                {MAINTENANCE_TYPE_LABELS[value]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Done on" error={errors.performedOn?.message}>
          <Input type="date" max={today} {...form.register('performedOn')} />
        </FormField>
        <FormField
          label="What was done"
          error={errors.description?.message}
          className="sm:col-span-2"
        >
          <Textarea
            rows={3}
            maxLength={EQUIPMENT_LIMITS.descriptionMax}
            placeholder={
              type === 'REPAIR'
                ? 'e.g. Replaced the worn running belt'
                : 'e.g. Lubricated the deck, checked belt tension and safety key'
            }
            {...form.register('description')}
          />
        </FormField>
        <FormField label="Done by" optional error={errors.performedByName?.message}>
          <Input
            autoComplete="off"
            maxLength={EQUIPMENT_LIMITS.shortTextMax}
            placeholder="Technician or company"
            {...form.register('performedByName')}
          />
        </FormField>
        <FormField label={`Cost (${gym.currencyCode})`} optional error={errors.cost?.message}>
          <Input inputMode="decimal" autoComplete="off" {...form.register('cost')} />
        </FormField>
        <FormField label="Condition afterwards" error={errors.conditionAfter?.message}>
          <Select {...form.register('conditionAfter')}>
            {EQUIPMENT_CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {EQUIPMENT_CONDITION_LABELS[condition]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label="Next maintenance"
          optional
          error={errors.nextMaintenanceDate?.message}
          hint={
            item.maintenanceIntervalDays
              ? `Leave empty to schedule it ${item.maintenanceIntervalDays} days after this visit.`
              : 'Leave empty if nothing is planned.'
          }
        >
          <Input type="date" {...form.register('nextMaintenanceDate')} />
        </FormField>
        <FormField
          label={type === 'REPAIR' ? 'Repair notes' : 'Findings'}
          optional
          error={errors.repairNotes?.message}
          className="sm:col-span-2"
        >
          <Textarea
            rows={2}
            maxLength={EQUIPMENT_LIMITS.notesMax}
            placeholder="Parts used, warranty, anything to watch"
            {...form.register('repairNotes')}
          />
        </FormField>
      </form>
    </Dialog>
  );
}
