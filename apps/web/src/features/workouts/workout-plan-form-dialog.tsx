import { zodResolver } from '@hookform/resolvers/zod';
import {
  createWorkoutPlanSchema,
  DIFFICULTY_LEVEL_LABELS,
  DIFFICULTY_LEVELS,
  permissionScope,
  WORKOUT_LIMITS,
  type WorkoutPlanDto,
} from '@gms/shared';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { z } from 'zod';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Input, Select, Textarea } from '../../components/ui/form-field';
import { fullName, useSession } from '../../lib/auth';
import { applyServerErrors } from '../../lib/forms';
import { useTrainers } from '../scheduling/scheduling-api';
import { useCreateWorkoutPlan, useUpdateWorkoutPlan } from './workouts-api';

type FormInput = z.input<typeof createWorkoutPlanSchema>;
type FormOutput = z.output<typeof createWorkoutPlanSchema>;

const FORM_ID = 'workout-plan-form';
const FIELDS = ['name', 'difficulty', 'goal', 'description', 'isTemplate', 'ownerTrainerId'];

const defaultsFor = (plan?: WorkoutPlanDto): FormInput => ({
  name: plan?.name ?? '',
  difficulty: plan?.difficulty ?? 'BEGINNER',
  goal: plan?.goal ?? '',
  description: plan?.description ?? '',
  isTemplate: plan?.isTemplate ?? false,
  ownerTrainerId: null,
});

export function WorkoutPlanFormDialog({
  plan,
  open,
  onOpenChange,
}: {
  /** Edit this plan's details; omit to start a new plan. */
  plan?: WorkoutPlanDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useSession();
  const navigate = useNavigate();
  // Admins and Managers choose who owns a new plan; a trainer always owns their own.
  const choosesOwner = !plan && permissionScope(user.role, 'workouts:manage') === 'ALL';
  const trainers = useTrainers(open && choosesOwner);
  const create = useCreateWorkoutPlan();
  const update = useUpdateWorkoutPlan();
  const saving = create.isPending || update.isPending;
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createWorkoutPlanSchema),
    defaultValues: defaultsFor(plan),
  });
  const { errors } = form.formState;

  const close = (next: boolean) => {
    if (!next) form.reset(defaultsFor(plan));
    onOpenChange(next);
  };

  const onError = (error: unknown) => {
    if (!applyServerErrors(error, form.setError, FIELDS)) toast.error(errorMessage(error));
  };

  const submit = form.handleSubmit(({ ownerTrainerId, ...details }) => {
    if (plan) {
      update.mutate(
        { id: plan.id, input: details },
        {
          onSuccess: (saved) => {
            toast.success(`${saved.name} saved`);
            onOpenChange(false);
            form.reset(defaultsFor(saved));
          },
          onError,
        },
      );
      return;
    }
    create.mutate(
      { ...details, ownerTrainerId: choosesOwner ? ownerTrainerId : undefined },
      {
        onSuccess: (saved) => {
          toast.success(`${saved.name} created`, { description: 'Now add its exercises.' });
          form.reset(defaultsFor());
          onOpenChange(false);
          void navigate(`/workout-plans/${saved.id}`);
        },
        onError,
      },
    );
  });

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={plan ? `Edit ${plan.name}` : 'New workout plan'}
      description={
        plan
          ? 'Members following this plan see the new details straight away.'
          : 'Give the plan a name and level first. You add the exercises on the next screen.'
      }
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={saving}>
            {plan ? 'Save plan' : 'Create plan'}
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        onSubmit={submit}
        noValidate
        aria-label={plan ? 'Edit workout plan' : 'New workout plan'}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <FormField label="Plan name" error={errors.name?.message} className="sm:col-span-2">
          <Input
            autoComplete="off"
            placeholder="e.g. 4-week strength foundation"
            {...form.register('name')}
          />
        </FormField>
        <FormField label="Level" error={errors.difficulty?.message}>
          <Select {...form.register('difficulty')}>
            {DIFFICULTY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {DIFFICULTY_LEVEL_LABELS[level]}
              </option>
            ))}
          </Select>
        </FormField>
        {choosesOwner ? (
          <FormField
            label="Trainer"
            optional
            error={errors.ownerTrainerId?.message}
            hint="Leave empty for a gym-wide plan."
          >
            <Select
              {...form.register('ownerTrainerId', { setValueAs: (value) => value || null })}
              disabled={trainers.isPending}
            >
              <option value="">No trainer (gym plan)</option>
              {trainers.data?.map((trainer) => (
                <option key={trainer.id} value={trainer.id}>
                  {fullName(trainer)}
                </option>
              ))}
            </Select>
          </FormField>
        ) : (
          <div className="hidden sm:block" />
        )}
        <FormField label="Goal" optional error={errors.goal?.message} className="sm:col-span-2">
          <Input
            autoComplete="off"
            maxLength={WORKOUT_LIMITS.goalMax}
            placeholder="e.g. Build a base for heavier lifting"
            {...form.register('goal')}
          />
        </FormField>
        <FormField
          label="Description"
          optional
          error={errors.description?.message}
          className="sm:col-span-2"
        >
          <Textarea
            rows={3}
            maxLength={WORKOUT_LIMITS.descriptionMax}
            {...form.register('description')}
          />
        </FormField>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-fg sm:col-span-2">
          <input
            type="checkbox"
            className="mt-0.5 size-4 cursor-pointer accent-primary"
            {...form.register('isTemplate')}
          />
          <span>
            Template
            <span className="block text-13 text-fg-muted">
              A starting point other trainers can duplicate and adjust for their members.
            </span>
          </span>
        </label>
      </form>
    </Dialog>
  );
}
