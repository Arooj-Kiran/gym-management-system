import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@gms/shared';
import { CircleAlert } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { ApiError, errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { FormField, Input } from '../../components/ui/form-field';
import { safeNext } from '../../lib/navigation';
import { FullPageLoader } from '../../routes/guards';
import { useLogin, useMe } from '../../lib/auth';
import { AuthLayout } from './auth-layout';
import { PasswordInput } from './password-input';

function loginErrorText(error: unknown) {
  if (error instanceof ApiError && error.code === 'RATE_LIMITED') {
    return 'Too many sign-in attempts. Wait a few minutes before trying again.';
  }
  return errorMessage(error);
}

export function LoginPage() {
  const me = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors } = form.formState;

  if (me.isPending) return <FullPageLoader />;
  if (me.data && !login.isPending) {
    return <Navigate to={me.data.user.mustChangePassword ? '/change-password' : next} replace />;
  }

  const submit = form.handleSubmit((values) =>
    login.mutate(values, {
      onSuccess: () => navigate(next, { replace: true }),
      onError: () => form.resetField('password'),
    }),
  );

  return (
    <AuthLayout
      title="Sign in"
      description="Use the work email and password your gym Admin gave you."
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        {login.isError && (
          <div
            role="alert"
            className="flex gap-2.5 rounded-md border border-danger/25 bg-danger-subtle px-3.5 py-3 text-13 text-danger-text"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{loginErrorText(login.error)}</p>
          </div>
        )}
        <FormField label="Email" error={errors.email?.message}>
          <Input
            type="email"
            autoComplete="username"
            inputMode="email"
            autoFocus
            {...form.register('email')}
          />
        </FormField>
        <FormField label="Password" error={errors.password?.message}>
          <PasswordInput autoComplete="current-password" {...form.register('password')} />
        </FormField>
        <Button type="submit" loading={login.isPending} className="mt-1 w-full">
          Sign in
        </Button>
        <p className="text-13 text-fg-muted">
          Forgot your password? Ask an Admin to reset it — you will set a new one at your next
          sign-in.
        </p>
      </form>
    </AuthLayout>
  );
}
