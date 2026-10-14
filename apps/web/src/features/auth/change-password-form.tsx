import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordSchema, PASSWORD_MIN_LENGTH } from '@gms/shared';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { FormField } from '../../components/ui/form-field';
import { useChangePassword } from '../../lib/auth';
import { applyServerErrors } from '../../lib/forms';
import { PasswordInput } from './password-input';

const formSchema = changePasswordSchema
  .extend({ confirmPassword: z.string().min(1, 'Repeat the new password') })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The passwords do not match',
  });
type FormValues = z.input<typeof formSchema>;

const FIELDS = ['currentPassword', 'newPassword', 'confirmPassword'] as const;

export function ChangePasswordForm({
  currentLabel = 'Current password',
  submitLabel = 'Change password',
  onChanged,
}: {
  currentLabel?: string;
  submitLabel?: string;
  onChanged?: () => void;
}) {
  const change = useChangePassword();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit(({ currentPassword, newPassword }) =>
    change.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          form.reset();
          toast.success('Password changed. Other devices have been signed out.');
          onChanged?.();
        },
        onError: (error) => {
          if (!applyServerErrors(error, form.setError, FIELDS)) toast.error(errorMessage(error));
        },
      },
    ),
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormField label={currentLabel} error={errors.currentPassword?.message}>
        <PasswordInput autoComplete="current-password" {...form.register('currentPassword')} />
      </FormField>
      <FormField
        label="New password"
        error={errors.newPassword?.message}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short sentence is easy to remember and hard to guess.`}
      >
        <PasswordInput autoComplete="new-password" {...form.register('newPassword')} />
      </FormField>
      <FormField label="Repeat new password" error={errors.confirmPassword?.message}>
        <PasswordInput autoComplete="new-password" {...form.register('confirmPassword')} />
      </FormField>
      <div className="pt-1">
        <Button type="submit" loading={change.isPending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
