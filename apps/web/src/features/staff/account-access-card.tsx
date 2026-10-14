import type { StaffDto } from '@gms/shared';
import { KeyRound, Power, PowerOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { fullName } from '../../lib/auth';
import { formatDateTime, formatRelative } from '../../lib/format';
import { ResetPasswordDialog } from './reset-password-dialog';
import { useSetActive } from './staff-api';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-13 text-fg-muted">{label}</dt>
      <dd className="text-right text-13 text-fg">{children}</dd>
    </div>
  );
}

export function AccountAccessCard({
  staff,
  canManage,
  isSelf,
}: {
  staff: StaffDto;
  canManage: boolean;
  isSelf: boolean;
}) {
  const [dialog, setDialog] = useState<'deactivate' | 'activate' | 'reset' | null>(null);
  const setActive = useSetActive(staff.id);
  const name = fullName(staff);

  const toggle = (active: boolean) => (reason: string | undefined) =>
    setActive.mutate(
      { active, reason },
      {
        onSuccess: () => {
          toast.success(active ? `${name} can sign in again` : `${name} has been deactivated`, {
            description: active
              ? undefined
              : 'They were signed out everywhere. Their history is kept.',
          });
          setDialog(null);
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );

  return (
    <Card>
      <CardHeader title="Sign-in access" />
      <dl className="divide-y divide-border px-4 sm:px-5">
        <Row label="Status">
          {staff.isActive ? (
            <Badge tone="success" dot>
              Active
            </Badge>
          ) : (
            <Badge tone="danger" dot>
              Deactivated
            </Badge>
          )}
        </Row>
        <Row label="Last sign-in">
          {staff.lastLoginAt ? (
            <time dateTime={staff.lastLoginAt} title={formatDateTime(staff.lastLoginAt)}>
              {formatRelative(staff.lastLoginAt)}
            </time>
          ) : (
            'Never'
          )}
        </Row>
        <Row label="Password">
          {staff.mustChangePassword ? 'Temporary, change pending' : 'Set by the user'}
        </Row>
        <Row label="Account created">{formatDateTime(staff.createdAt)}</Row>
      </dl>

      {staff.isLocked && (
        <p
          role="status"
          className="mx-4 mb-4 rounded-md bg-warning-subtle px-3 py-2.5 text-13 text-warning-text sm:mx-5"
        >
          Locked after too many failed sign-ins. It unlocks automatically
          {canManage && !isSelf ? ', or reset the password to unlock it now.' : '.'}
        </p>
      )}

      {canManage && (
        <div className="flex flex-col gap-2 border-t border-border px-4 py-4 sm:px-5">
          {isSelf ? (
            <p className="text-13 text-fg-muted">
              You cannot reset or deactivate your own account here. Change your password from My
              account.
            </p>
          ) : (
            <>
              <Button
                variant="secondary"
                icon={<KeyRound aria-hidden />}
                onClick={() => setDialog('reset')}
              >
                Reset password
              </Button>
              {staff.isActive ? (
                <Button
                  variant="secondary"
                  icon={<PowerOff aria-hidden />}
                  onClick={() => setDialog('deactivate')}
                  className="text-danger-text"
                >
                  Deactivate account
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  icon={<Power aria-hidden />}
                  onClick={() => setDialog('activate')}
                >
                  Activate account
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {canManage && !isSelf && (
        <>
          <ResetPasswordDialog
            staff={staff}
            open={dialog === 'reset'}
            onOpenChange={(open) => setDialog(open ? 'reset' : null)}
          />
          <ConfirmDialog
            open={dialog === 'deactivate'}
            onOpenChange={(open) => setDialog(open ? 'deactivate' : null)}
            title={`Deactivate ${name}?`}
            description="They are signed out everywhere and cannot sign in until an Admin activates the account again. Records they created are kept."
            confirmLabel="Deactivate"
            tone="danger"
            reason="required"
            loading={setActive.isPending}
            onConfirm={toggle(false)}
          />
          <ConfirmDialog
            open={dialog === 'activate'}
            onOpenChange={(open) => setDialog(open ? 'activate' : null)}
            title={`Activate ${name}?`}
            description="They can sign in again with their existing password."
            confirmLabel="Activate"
            reason="optional"
            loading={setActive.isPending}
            onConfirm={toggle(true)}
          />
        </>
      )}
    </Card>
  );
}
