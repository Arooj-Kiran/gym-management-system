import { ROLE_LABELS } from '@gms/shared';
import type { ReactNode } from 'react';
import { Avatar } from '../../components/ui/avatar';
import { Badge } from '../../components/ui/badge';
import { Card, CardHeader } from '../../components/ui/card';
import { PageHeader } from '../../components/ui/page-header';
import { fullName, useSession } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { ChangePasswordForm } from '../auth/change-password-form';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-13 text-fg-muted">{label}</dt>
      <dd className="text-sm break-words text-fg">{children}</dd>
    </div>
  );
}

export function AccountPage() {
  const { user, gym } = useSession();

  return (
    <>
      <PageHeader
        title="My account"
        description="Your sign-in details. Ask an Admin if your name, email or role is wrong."
      />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <div className="flex items-center gap-4 border-b border-border px-4 py-5 sm:px-5">
            <Avatar user={user} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-fg">{fullName(user)}</p>
              <p className="truncate text-13 text-fg-secondary">{gym.name}</p>
            </div>
          </div>
          <dl className="divide-y divide-border px-4 sm:px-5">
            <Row label="Email">{user.email}</Row>
            <Row label="Role">
              <Badge tone={user.role === 'ADMIN' ? 'primary' : 'neutral'}>
                {ROLE_LABELS[user.role]}
              </Badge>
            </Row>
            <Row label="Last sign-in">{formatDateTime(user.lastLoginAt)}</Row>
          </dl>
        </Card>

        <Card>
          <CardHeader
            title="Change password"
            description="You stay signed in here; every other device is signed out."
          />
          <div className="px-4 py-5 sm:px-5">
            <ChangePasswordForm />
          </div>
        </Card>
      </div>
    </>
  );
}
