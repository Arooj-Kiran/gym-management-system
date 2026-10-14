import { Navigate, useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/states';
import { useLogout, useMe } from '../../lib/auth';
import { FullPageLoader } from '../../routes/guards';
import { AuthLayout } from './auth-layout';
import { ChangePasswordForm } from './change-password-form';

/** Forced change after an Admin created the account or reset its password. */
export function ChangePasswordPage() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  if (me.isPending) return <FullPageLoader />;
  if (me.isError)
    return (
      <ErrorState
        error={me.error}
        onRetry={() => me.refetch()}
        className="min-h-dvh justify-center"
      />
    );
  if (!me.data) return <Navigate to="/login" replace />;
  if (!me.data.user.mustChangePassword) return <Navigate to="/" replace />;

  return (
    <AuthLayout
      title="Set your own password"
      description={
        <>
          Signed in as <span className="font-medium text-fg">{me.data.user.email}</span>. Replace
          the temporary password before you continue.
        </>
      }
    >
      <ChangePasswordForm
        currentLabel="Temporary password"
        submitLabel="Save password and continue"
        onChanged={() => navigate('/', { replace: true })}
      />
      <div className="mt-6 border-t border-border pt-5">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3"
          loading={logout.isPending}
          onClick={() =>
            logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) })
          }
        >
          Sign out instead
        </Button>
      </div>
    </AuthLayout>
  );
}
