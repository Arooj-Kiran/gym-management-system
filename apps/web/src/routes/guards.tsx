import { isStaffRole, type Permission } from '@gms/shared';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { ErrorState } from '../components/ui/states';
import { ForbiddenPage } from '../features/errors/error-pages';
import { useCan, useMe } from '../lib/auth';

function FullPageStatus({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center bg-bg px-4">{children}</div>;
}

export function FullPageLoader() {
  return (
    <FullPageStatus>
      <div role="status" className="flex items-center gap-3 text-sm text-fg-muted">
        <span
          className="size-4 animate-spin rounded-full border-2 border-border-strong border-t-primary"
          aria-hidden
        />
        Loading your workspace…
      </div>
    </FullPageStatus>
  );
}

export function RequireAuth() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) return <FullPageLoader />;
  if (me.isError) {
    return (
      <FullPageStatus>
        <ErrorState
          error={me.error}
          title="We could not check your session"
          onRetry={() => me.refetch()}
        />
      </FullPageStatus>
    );
  }
  if (!me.data) {
    const next = `${location.pathname}${location.search}`;
    return (
      <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />
    );
  }
  if (me.data.user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <Outlet />;
}

export function RequirePermission({ permission }: { permission: Permission }) {
  const can = useCan();
  return can(permission) ? <Outlet /> : <ForbiddenPage />;
}

export function RequireStaff() {
  const me = useMe();
  return me.data && isStaffRole(me.data.user.role) ? (
    <Outlet />
  ) : (
    <Navigate to="/account" replace />
  );
}
