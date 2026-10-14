import { zodResolver } from '@hookform/resolvers/zod';
import { createStaffSchema, ROLE_LABELS, STAFF_ROLES } from '@gms/shared';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { z } from 'zod';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Select } from '../../components/ui/form-field';
import { fullName } from '../../lib/auth';
import { applyServerErrors } from '../../lib/forms';
import { generateTemporaryPassword } from '../../lib/password';
import { ROLE_DESCRIPTIONS } from './role-meta';
import { useCreateStaff } from './staff-api';
import { PROFILE_FIELDS, profileFormValues } from './staff-profile';
import { StaffProfileFields } from './staff-profile-fields';
import { TemporaryPasswordField } from './temporary-password-field';

type FormInput = z.input<typeof createStaffSchema>;
type FormOutput = z.output<typeof createStaffSchema>;

const FIELDS = [...PROFILE_FIELDS, 'role', 'temporaryPassword'] as const;
const FORM_ID = 'create-staff-form';

export function CreateStaffDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const create = useCreateStaff();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createStaffSchema),
    defaultValues: {
      ...profileFormValues(),
      role: 'RECEPTIONIST',
      temporaryPassword: generateTemporaryPassword(),
    },
  });
  const { errors } = form.formState;
  const role = useWatch({ control: form.control, name: 'role' });
  const temporaryPassword = useWatch({ control: form.control, name: 'temporaryPassword' });

  const close = (next: boolean) => {
    if (!next)
      form.reset({
        ...profileFormValues(),
        role: 'RECEPTIONIST',
        temporaryPassword: generateTemporaryPassword(),
      });
    onOpenChange(next);
  };

  const submit = form.handleSubmit((values) =>
    create.mutate(values, {
      onSuccess: (staff) => {
        toast.success(`Account created for ${fullName(staff)}`, {
          description:
            'Hand over the temporary password in person. They will be asked to change it.',
        });
        close(false);
        void navigate(`/staff/${staff.id}`);
      },
      onError: (error) => {
        if (!applyServerErrors(error, form.setError, FIELDS)) toast.error(errorMessage(error));
      },
    }),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Add a staff member"
      description="Creates a sign-in for the dashboard. Members are added from the member screens."
      size="lg"
      busy={create.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={create.isPending}>
            Create account
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className="flex flex-col gap-6">
        <StaffProfileFields register={form.register} errors={errors} />
        <div className="grid grid-cols-1 gap-4 border-t border-border pt-5 sm:grid-cols-2">
          <FormField label="Role" error={errors.role?.message} hint={ROLE_DESCRIPTIONS[role]}>
            <Select {...form.register('role')}>
              {STAFF_ROLES.map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABELS[value]}
                </option>
              ))}
            </Select>
          </FormField>
          <TemporaryPasswordField
            error={errors.temporaryPassword?.message}
            value={temporaryPassword}
            onGenerate={(password) =>
              form.setValue('temporaryPassword', password, { shouldValidate: true })
            }
            inputProps={form.register('temporaryPassword')}
          />
        </div>
      </form>
    </Dialog>
  );
}
