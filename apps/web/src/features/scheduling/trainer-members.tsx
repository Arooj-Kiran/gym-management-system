import { TRAINER_LIMITS, type TrainerAssignmentDto } from '@gms/shared';
import { UserRoundMinus, UserRoundPlus, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Textarea } from '../../components/ui/form-field';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { fullName } from '../../lib/auth';
import { formatDate } from '../../lib/format';
import { MemberAvatar } from '../members/member-avatar';
import { MemberPicker, type PickedMember } from '../members/member-picker';
import { MembershipStatusBadge } from '../memberships/membership-status-badge';
import { FormProblem } from './form-parts';
import { splitServerError, type Errors } from './form-utils';
import { useAssignments, useCreateAssignment, useEndAssignment } from './scheduling-api';

function AssignDialog({
  trainerId,
  trainerName,
  open,
  onOpenChange,
}: {
  trainerId: string;
  trainerName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateAssignment();
  const [member, setMember] = useState<PickedMember | null>(null);
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const shown: Errors = {
    ...(touched && !member ? { memberId: 'Choose a member' } : {}),
    ...serverErrors,
  };

  const close = (next: boolean) => {
    if (!next) {
      setMember(null);
      setNotes('');
      setTouched(false);
      setServerErrors({});
      setProblem(null);
    }
    onOpenChange(next);
  };

  const submit = () => {
    setTouched(true);
    setServerErrors({});
    setProblem(null);
    if (!member) return;
    create.mutate(
      { trainerId, memberId: member.id, notes: notes.trim() || null },
      {
        onSuccess: () => {
          toast.success(`${fullName(member)} assigned to ${trainerName}`);
          close(false);
        },
        onError: (error) => {
          const { fields, problem: message } = splitServerError(error);
          setServerErrors(fields);
          setProblem(message);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={`Assign a member to ${trainerName}`}
      description="The trainer will see the member’s name, photo and membership status, and can book personal training for them."
      size="lg"
      busy={create.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.isPending}>
            Assign member
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <FormProblem message={problem} />
        <div>
          <MemberPicker selected={member} onSelect={setMember} name="assign-member" />
          {shown.memberId && <p className="mt-1.5 text-13 text-danger-text">{shown.memberId}</p>}
        </div>
        <FormField
          label="Notes"
          optional
          error={shown.notes}
          hint="Goals or limits the trainer should know."
        >
          <Textarea
            rows={2}
            value={notes}
            maxLength={TRAINER_LIMITS.notesMax}
            placeholder="e.g. Marathon prep; avoid heavy deadlifts"
            onChange={(event) => setNotes(event.target.value)}
          />
        </FormField>
      </div>
    </Dialog>
  );
}

/** The trainer's current members, for staff who can see every assignment. */
export function TrainerMembers({
  trainerId,
  trainerName,
  canManage,
  linkMembers,
}: {
  trainerId: string;
  trainerName: string;
  canManage: boolean;
  linkMembers: boolean;
}) {
  const assignments = useAssignments({ trainerId });
  const end = useEndAssignment();
  const [assigning, setAssigning] = useState(false);
  const [ending, setEnding] = useState<TrainerAssignmentDto | null>(null);

  return (
    <Card>
      <CardHeader
        title="Assigned members"
        description="Members this trainer looks after. Ending an assignment keeps it on record."
        action={
          canManage && (
            <Button
              variant="secondary"
              size="sm"
              icon={<UserRoundPlus aria-hidden />}
              onClick={() => setAssigning(true)}
            >
              Assign member
            </Button>
          )
        }
      />
      {assignments.isPending ? (
        <ListSkeleton rows={3} label="Loading members" />
      ) : assignments.isError ? (
        <ErrorState error={assignments.error} onRetry={() => assignments.refetch()} />
      ) : assignments.data.length === 0 ? (
        <EmptyState
          icon={<UsersRound aria-hidden />}
          title="No members assigned"
          description={
            canManage
              ? 'Assign members who train with this trainer regularly.'
              : 'An Admin or Manager assigns members to trainers.'
          }
        />
      ) : (
        <ul aria-label="Assigned members" className="divide-y divide-border">
          {assignments.data.map((assignment) => (
            <li
              key={assignment.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <MemberAvatar member={assignment.member} />
                <div className="min-w-0">
                  {linkMembers ? (
                    <Link
                      to={`/members/${assignment.member.id}`}
                      className="block truncate text-sm font-medium text-fg hover:underline"
                    >
                      {fullName(assignment.member)}
                    </Link>
                  ) : (
                    <p className="truncate text-sm font-medium text-fg">
                      {fullName(assignment.member)}
                    </p>
                  )}
                  <p className="truncate text-13 text-fg-muted">
                    <span className="font-mono">{assignment.member.memberCode}</span> · since{' '}
                    {formatDate(assignment.startDate)}
                    {assignment.notes && ` · ${assignment.notes}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 pl-11 sm:pl-0">
                {assignment.member.currentMembership ? (
                  <MembershipStatusBadge
                    status={assignment.member.currentMembership.effectiveStatus}
                  />
                ) : (
                  <span className="text-13 text-fg-muted">No membership</span>
                )}
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<UserRoundMinus aria-hidden />}
                    onClick={() => setEnding(assignment)}
                  >
                    End
                    <span className="sr-only"> assignment for {fullName(assignment.member)}</span>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <>
          <AssignDialog
            trainerId={trainerId}
            trainerName={trainerName}
            open={assigning}
            onOpenChange={setAssigning}
          />
          <ConfirmDialog
            open={ending !== null}
            onOpenChange={(open) => !open && setEnding(null)}
            title={`End ${ending ? fullName(ending.member) : 'this member'}’s assignment?`}
            description={`${trainerName} will no longer see this member or be able to book sessions for them. Appointments already booked stay booked.`}
            confirmLabel="End assignment"
            tone="danger"
            reason="optional"
            loading={end.isPending}
            onConfirm={(reason) => {
              if (!ending) return;
              end.mutate(
                { id: ending.id, reason },
                {
                  onSuccess: () => {
                    toast.success('Assignment ended');
                    setEnding(null);
                  },
                  onError: (error) => toast.error(errorMessage(error)),
                },
              );
            }}
          />
        </>
      )}
    </Card>
  );
}
