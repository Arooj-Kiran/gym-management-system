import { ROLE_LABELS, STAFF_ROLES, type StaffDto, type StaffRole } from '@gms/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Select } from '../../components/ui/form-field';
import { fullName } from '../../lib/auth';
import { ROLE_DESCRIPTIONS, ROLE_TONES } from './role-meta';
import { useChangeRole } from './staff-api';

export function RoleCard({
  staff,
  canAssign,
  isSelf,
}: {
  staff: StaffDto;
  canAssign: boolean;
  isSelf: boolean;
}) {
  const [draft, setDraft] = useState<StaffRole>(staff.role as StaffRole);
  const [confirming, setConfirming] = useState(false);
  const changeRole = useChangeRole(staff.id);
  const current = staff.role as StaffRole;
  const editable = canAssign && !isSelf && staff.isActive;

  const confirm = (reason: string | undefined) =>
    changeRole.mutate(
      { role: draft, reason },
      {
        onSuccess: (updated) => {
          toast.success(`${fullName(updated)} is now ${ROLE_LABELS[updated.role]}`, {
            description: 'The new permissions apply from their next action; no sign-out is needed.',
          });
          setConfirming(false);
        },
        onError: (error) => {
          toast.error(errorMessage(error));
          setConfirming(false);
          setDraft(current);
        },
      },
    );

  return (
    <Card>
      <CardHeader title="Role" id="role-heading" />
      <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
        {editable ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              aria-labelledby="role-heading"
              value={draft}
              onChange={(event) => setDraft(event.target.value as StaffRole)}
              className="flex-1"
            >
              {STAFF_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              disabled={draft === current}
              onClick={() => setConfirming(true)}
            >
              Change role
            </Button>
          </div>
        ) : (
          <div>
            <Badge tone={ROLE_TONES[current]}>{ROLE_LABELS[current]}</Badge>
          </div>
        )}
        <p className="text-13 text-fg-muted">{ROLE_DESCRIPTIONS[draft]}</p>
        {canAssign && isSelf && (
          <p className="text-13 text-fg-muted">
            You cannot change your own role. Another Admin can do this.
          </p>
        )}
        {canAssign && !isSelf && !staff.isActive && (
          <p className="text-13 text-fg-muted">Activate the account before changing its role.</p>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => {
          setConfirming(open);
          if (!open) setDraft(current);
        }}
        title={`Change role to ${ROLE_LABELS[draft]}?`}
        description={
          <>
            {fullName(staff)} goes from{' '}
            <strong className="font-medium text-fg">{ROLE_LABELS[current]}</strong> to{' '}
            <strong className="font-medium text-fg">{ROLE_LABELS[draft]}</strong>. What they can see
            and do changes at once.
          </>
        }
        confirmLabel="Change role"
        reason="optional"
        loading={changeRole.isPending}
        onConfirm={confirm}
      />
    </Card>
  );
}
