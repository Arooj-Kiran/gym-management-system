import { zodResolver } from '@hookform/resolvers/zod';
import {
  createWorkoutAssignmentSchema,
  permissionScope,
  WORKOUT_LIMITS,
  type WorkoutPlanDto,
} from '@gms/shared';
import { useState } from 'react';
import { useForm, type UseFormRegister } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { ApiError, errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Input, Select, Textarea } from '../../components/ui/form-field';
import { Skeleton } from '../../components/ui/states';
import { fullName, useSession } from '../../lib/auth';
import { gymTodayIso } from '../../lib/format';
import { applyServerErrors } from '../../lib/forms';
import { MemberPicker, type PickedMember } from '../members/member-picker';
import { useTrainerMembers, useTrainers } from '../scheduling/scheduling-api';
import { plural } from './workout-format';
import { useAssignWorkout, useWorkoutPlanList } from './workouts-api';

type FormInput = z.input<typeof createWorkoutAssignmentSchema>;
type FormOutput = z.output<typeof createWorkoutAssignmentSchema>;

const FORM_ID = 'assign-workout-form';
const FIELDS = ['planId', 'memberId', 'trainerId', 'startDate', 'endDate', 'trainerNotes'];
const nullIfEmpty = { setValueAs: (value: string) => value || null };

/** A trainer picks from their own members; Admins and Managers search every member. */
function TrainerMemberSelect({
  register,
  error,
  enabled,
}: {
  register: UseFormRegister<FormInput>;
  error?: string;
  enabled: boolean;
}) {
  const { user } = useSession();
  const members = useTrainerMembers(user.id, enabled);
  if (members.isPending) return <Skeleton className="h-16" />;
  if (members.isError)
    return (
      <p role="alert" className="text-13 text-danger-text">
        Your members could not be loaded: {errorMessage(members.error)}
      </p>
    );
  if (members.data.length === 0)
    return (
      <p className="text-13 text-fg-secondary">
        No members are assigned to you yet. An Admin or Manager assigns members to trainers.
      </p>
    );
  return (
    <FormField label="Member" error={error}>
      <Select {...register('memberId')}>
        <option value="">Choose one of your members</option>
        {members.data.map(({ member }) => (
          <option key={member.id} value={member.id}>
            {fullName(member)} · {member.memberCode}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

export function AssignWorkoutDialog({
  plan,
  member,
  open,
  onOpenChange,
}: {
  /** Fixed plan (from the plan page); otherwise the user picks one. */
  plan?: Pick<WorkoutPlanDto, 'id' | 'name'>;
  /** Fixed member (from the member page); otherwise the user picks one. */
  member?: PickedMember;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useSession();
  const today = gymTodayIso();
  const fullScope = permissionScope(user.role, 'workouts:assign') === 'ALL';
  const plans = useWorkoutPlanList({ status: 'ACTIVE', pageSize: 100 }, open && !plan);
  const trainers = useTrainers(open && fullScope);
  const assign = useAssignWorkout();
  const [picked, setPicked] = useState<PickedMember | null>(member ?? null);
  const defaults: FormInput = {
    planId: plan?.id ?? '',
    memberId: member?.id ?? '',
    trainerId: null,
    startDate: today,
    endDate: null,
    trainerNotes: '',
  };
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createWorkoutAssignmentSchema),
    defaultValues: defaults,
  });
  const { errors } = form.formState;
  const usablePlans = plans.data?.data.filter((item) => item.itemCount > 0) ?? [];

  const close = (next: boolean) => {
    if (!next) {
      form.reset(defaults);
      setPicked(member ?? null);
    }
    onOpenChange(next);
  };

  const submit = form.handleSubmit((values) =>
    assign.mutate(
      { ...values, trainerId: fullScope ? values.trainerId : undefined },
      {
        onSuccess: (assignment) => {
          toast.success(`${assignment.plan.name} assigned to ${fullName(assignment.member)}`, {
            description: 'They can follow it and log workouts in the member portal.',
          });
          close(false);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'ASSIGNMENT_EXISTS') {
            form.setError('memberId', { type: 'server', message: error.message });
            return;
          }
          if (!applyServerErrors(error, form.setError, FIELDS)) toast.error(errorMessage(error));
        },
      },
    ),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={plan ? `Assign ${plan.name}` : 'Assign a workout plan'}
      description="The member follows the plan in the portal and logs each session. You can add notes and close it later."
      size="lg"
      busy={assign.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={assign.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={assign.isPending}>
            Assign plan
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className="flex flex-col gap-4">
        {!plan &&
          (plans.isPending ? (
            <Skeleton className="h-16" />
          ) : plans.isError ? (
            <p role="alert" className="text-13 text-danger-text">
              Plans could not be loaded: {errorMessage(plans.error)}
            </p>
          ) : usablePlans.length === 0 ? (
            <p className="text-13 text-fg-secondary">
              There is no active plan with exercises yet. Build one under Workout plans first.
            </p>
          ) : (
            <FormField label="Plan" error={errors.planId?.message}>
              <Select {...form.register('planId')}>
                <option value="">Choose a plan</option>
                {usablePlans.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {plural(item.itemCount, 'exercise')}
                  </option>
                ))}
              </Select>
            </FormField>
          ))}

        {member ? (
          <p className="rounded-md border border-border bg-surface-muted/60 px-3.5 py-3 text-sm text-fg">
            <span className="block text-xs font-medium tracking-wide text-fg-muted uppercase">
              Member
            </span>
            {fullName(member)}{' '}
            <span className="font-mono text-13 text-fg-muted">{member.memberCode}</span>
          </p>
        ) : fullScope ? (
          <div className="flex flex-col gap-1.5">
            <MemberPicker
              name="assign-workout-member"
              selected={picked}
              onSelect={(next) => {
                setPicked(next);
                form.setValue('memberId', next.id, { shouldValidate: form.formState.isSubmitted });
              }}
            />
            {errors.memberId?.message && (
              <p role="alert" className="text-13 text-danger-text">
                {errors.memberId.message}
              </p>
            )}
          </div>
        ) : (
          <TrainerMemberSelect
            register={form.register}
            error={errors.memberId?.message}
            enabled={open}
          />
        )}

        {fullScope && (
          <FormField
            label="Responsible trainer"
            optional
            error={errors.trainerId?.message}
            hint="Must be a trainer already assigned to this member."
          >
            <Select {...form.register('trainerId', nullIfEmpty)} disabled={trainers.isPending}>
              <option value="">No trainer</option>
              {trainers.data?.map((trainer) => (
                <option key={trainer.id} value={trainer.id}>
                  {fullName(trainer)}
                </option>
              ))}
            </Select>
          </FormField>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Starts" error={errors.startDate?.message}>
            <Input type="date" {...form.register('startDate')} />
          </FormField>
          <FormField
            label="Ends"
            optional
            error={errors.endDate?.message}
            hint="Leave empty to run until you close it."
          >
            <Input type="date" min={today} {...form.register('endDate')} />
          </FormField>
        </div>
        <FormField
          label="Notes for the member"
          optional
          error={errors.trainerNotes?.message}
          hint="Shown with the plan in their portal."
        >
          <Textarea
            rows={3}
            maxLength={WORKOUT_LIMITS.notesMax}
            placeholder="e.g. Keep the first two weeks light and focus on form."
            {...form.register('trainerNotes')}
          />
        </FormField>
      </form>
    </Dialog>
  );
}
