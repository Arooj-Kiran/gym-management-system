import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordSchema, type ResetPasswordInput, type StaffDto } from '@gms/shared';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { fullName } from '../../lib/auth';
import { applyServerErrors } from '../../lib/forms';
import { generateTemporaryPassword } from '../../lib/password';
import { useResetPassword } from './staff-api';
import { TemporaryPasswordField } from './temporary-password-field';

const FORM_ID = 'reset-password-form';

export function ResetPasswordDialog({
  staff,
  open,
  onOpenChange,
}: {
  staff: StaffDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const reset = useResetPassword(staff.id);
  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { temporaryPassword: generateTemporaryPassword() },
  });
  const temporaryPassword = useWatch({ control: form.control, name: 'temporaryPassword' });

  const close = (next: boolean) => {
    if (!next) form.reset({ temporaryPassword: generateTemporaryPassword() });
    onOpenChange(next);
  };

  const submit = form.handleSubmit((values) =>
    reset.mutate(values, {
      onSuccess: () => {
        toast.success(`Password reset for ${fullName(staff)}`, {
          description:
            'Their devices were signed out. They must choose a new password at next sign-in.',
        });
        close(false);
      },
      onError: (error) => {
        if (!applyServerErrors(error, form.setError, ['temporaryPassword']))
          toast.error(errorMessage(error));
      },
    }),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={`Reset password for ${fullName(staff)}?`}
      description="They will be signed out everywhere and must set a new password the next time they sign in."
      size="sm"
      busy={reset.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={reset.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} variant="danger" loading={reset.isPending}>
            Reset password
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate>
        <TemporaryPasswordField
          error={form.formState.errors.temporaryPassword?.message}
          value={temporaryPassword}
          onGenerate={(password) =>
            form.setValue('temporaryPassword', password, { shouldValidate: true })
          }
          inputProps={form.register('temporaryPassword')}
        />
      </form>
    </Dialog>
  );
}
