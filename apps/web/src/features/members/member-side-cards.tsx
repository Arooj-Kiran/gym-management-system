import { zodResolver } from '@hookform/resolvers/zod';
import {
  createPortalAccountSchema,
  type CreatePortalAccountInput,
  type MemberDto,
} from '@gms/shared';
import { Archive, ArchiveRestore, Ban, Camera, KeyRound, ShieldCheck } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Dialog } from '../../components/ui/dialog';
import { fullName } from '../../lib/auth';
import { formatDate, formatDateTime, formatRelative } from '../../lib/format';
import { applyServerErrors } from '../../lib/forms';
import { generateTemporaryPassword } from '../../lib/password';
import { TemporaryPasswordField } from '../staff/temporary-password-field';
import { MemberAvatar } from './member-avatar';
import {
  useAccessBlock,
  useArchiveMember,
  useCreatePortalAccount,
  useUploadMemberPhoto,
} from './members-api';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-13 text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-right text-13 break-words text-fg">{children}</dd>
    </div>
  );
}

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** A photo picker shared by the staff detail page and the member portal. */
export function PhotoPicker({
  member,
  onUpload,
  uploading,
  disabled,
  label = 'Upload photo',
}: {
  member: { firstName: string; lastName: string; photoUrl: string | null };
  onUpload: (file: File, done: () => void) => void;
  uploading: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (file: File | undefined) => {
    if (!file) return;
    // The server decides by the file's content; this check only saves a round trip.
    if (!PHOTO_TYPES.includes(file.type)) {
      setError('Use a JPEG, PNG or WebP image.');
      return;
    }
    setError(null);
    onUpload(file, () => {
      if (input.current) input.current.value = '';
    });
  };

  return (
    <div className="flex items-center gap-4 px-4 py-4 sm:px-5">
      <MemberAvatar member={member} size="xl" />
      <div className="flex min-w-0 flex-col items-start gap-2">
        <input
          ref={input}
          type="file"
          accept={PHOTO_TYPES.join(',')}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => pick(event.target.files?.[0])}
          data-testid="photo-input"
        />
        <Button
          variant="secondary"
          size="sm"
          icon={<Camera aria-hidden />}
          loading={uploading}
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          {member.photoUrl ? 'Replace photo' : label}
        </Button>
        {error ? (
          <p role="alert" className="text-13 text-danger-text">
            {error}
          </p>
        ) : (
          <p className="text-13 text-fg-muted">JPEG, PNG or WebP. Used at the front desk.</p>
        )}
      </div>
    </div>
  );
}

export function PhotoCard({ member, canUpdate }: { member: MemberDto; canUpdate: boolean }) {
  const upload = useUploadMemberPhoto(member.id);
  const archived = Boolean(member.archivedAt);
  return (
    <Card>
      <CardHeader title="Photo" />
      <PhotoPicker
        member={member}
        uploading={upload.isPending}
        disabled={!canUpdate || archived}
        onUpload={(file, done) =>
          upload.mutate(file, {
            onSuccess: () => toast.success('Photo updated'),
            onError: (error) => toast.error(errorMessage(error)),
            onSettled: done,
          })
        }
      />
    </Card>
  );
}

export function EntryAccessCard({
  member,
  canRestrict,
}: {
  member: MemberDto;
  canRestrict: boolean;
}) {
  const [dialog, setDialog] = useState<'block' | 'unblock' | null>(null);
  const access = useAccessBlock(member.id);
  const name = fullName(member);
  const archived = Boolean(member.archivedAt);

  const run = (block: boolean) => (reason: string | undefined) =>
    access.mutate(
      { block, reason },
      {
        onSuccess: () => {
          toast.success(block ? `Entry blocked for ${name}` : `Entry unblocked for ${name}`);
          setDialog(null);
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );

  return (
    <Card>
      <CardHeader title="Entry" />
      <dl className="divide-y divide-border px-4 sm:px-5">
        <Row label="Gym entry">
          {member.accessBlocked ? (
            <Badge tone="danger">
              <Ban className="size-3" aria-hidden /> Blocked
            </Badge>
          ) : (
            <Badge tone="success" dot>
              Not blocked
            </Badge>
          )}
        </Row>
        {member.accessBlocked && (
          <>
            <Row label="Reason">{member.accessBlockReason ?? '—'}</Row>
            <Row label="Since">{formatDateTime(member.accessBlockedAt)}</Row>
          </>
        )}
      </dl>
      <p className="border-t border-border px-4 py-3 text-13 text-fg-muted sm:px-5">
        {member.accessBlocked
          ? 'Blocked members are refused at the door even with a valid membership.'
          : 'A block refuses entry at the door, whatever the membership says.'}
      </p>
      {canRestrict && !archived && (
        <div className="border-t border-border px-4 py-4 sm:px-5">
          {member.accessBlocked ? (
            <Button
              variant="secondary"
              className="w-full"
              icon={<ShieldCheck aria-hidden />}
              onClick={() => setDialog('unblock')}
            >
              Unblock entry
            </Button>
          ) : (
            <Button
              variant="secondary"
              className="w-full text-danger-text"
              icon={<Ban aria-hidden />}
              onClick={() => setDialog('block')}
            >
              Block entry
            </Button>
          )}
        </div>
      )}
      {canRestrict && (
        <>
          <ConfirmDialog
            open={dialog === 'block'}
            onOpenChange={(open) => setDialog(open ? 'block' : null)}
            title={`Block entry for ${name}?`}
            description="They will be refused at the door until a Manager or Admin unblocks them. Their profile and history are not changed."
            confirmLabel="Block entry"
            tone="danger"
            reason="required"
            loading={access.isPending}
            onConfirm={run(true)}
          />
          <ConfirmDialog
            open={dialog === 'unblock'}
            onOpenChange={(open) => setDialog(open ? 'unblock' : null)}
            title={`Unblock entry for ${name}?`}
            description="They can enter again whenever their membership allows it."
            confirmLabel="Unblock entry"
            reason="optional"
            loading={access.isPending}
            onConfirm={run(false)}
          />
        </>
      )}
    </Card>
  );
}

const PORTAL_FORM_ID = 'portal-account-form';

function PortalAccountDialog({
  member,
  open,
  onOpenChange,
}: {
  member: MemberDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreatePortalAccount(member.id);
  const form = useForm<CreatePortalAccountInput>({
    resolver: zodResolver(createPortalAccountSchema),
    defaultValues: { temporaryPassword: generateTemporaryPassword() },
  });
  const temporaryPassword = useWatch({ control: form.control, name: 'temporaryPassword' });

  const close = (next: boolean) => {
    if (!next) form.reset({ temporaryPassword: generateTemporaryPassword() });
    onOpenChange(next);
  };

  const submit = form.handleSubmit((values) =>
    create.mutate(values, {
      onSuccess: () => {
        toast.success(`Portal login created for ${fullName(member)}`, {
          description: 'Hand over the temporary password in person. They must change it.',
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
      title={`Create a portal login for ${fullName(member)}?`}
      description={
        <>
          They sign in with <span className="font-medium text-fg">{member.email}</span> and must
          choose their own password the first time.
        </>
      }
      size="sm"
      busy={create.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={PORTAL_FORM_ID} loading={create.isPending}>
            Create login
          </Button>
        </>
      }
    >
      <form id={PORTAL_FORM_ID} onSubmit={submit} noValidate>
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

export function PortalAccountCard({
  member,
  canUpdate,
}: {
  member: MemberDto;
  canUpdate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const account = member.portalAccount;
  const archived = Boolean(member.archivedAt);

  return (
    <Card>
      <CardHeader title="Member portal" />
      {account ? (
        <dl className="divide-y divide-border px-4 sm:px-5">
          <Row label="Login email">{account.email}</Row>
          <Row label="Status">
            {account.isActive ? (
              <Badge tone="success" dot>
                Can sign in
              </Badge>
            ) : (
              <Badge tone="danger" dot>
                Disabled
              </Badge>
            )}
          </Row>
          <Row label="Password">
            {account.mustChangePassword ? 'Temporary, change pending' : 'Set by the member'}
          </Row>
          <Row label="Last sign-in">
            {account.lastLoginAt ? (
              <time dateTime={account.lastLoginAt} title={formatDateTime(account.lastLoginAt)}>
                {formatRelative(account.lastLoginAt)}
              </time>
            ) : (
              'Never'
            )}
          </Row>
        </dl>
      ) : (
        <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
          <p className="text-13 text-fg-secondary">
            No portal login yet. With one, the member can see their profile and the gym&apos;s
            plans.
          </p>
          {canUpdate && !archived && (
            <>
              <Button
                variant="secondary"
                icon={<KeyRound aria-hidden />}
                disabled={!member.email}
                onClick={() => setOpen(true)}
              >
                Create portal login
              </Button>
              {!member.email && (
                <p className="text-13 text-fg-muted">Add an email address to this member first.</p>
              )}
            </>
          )}
        </div>
      )}
      {archived && account && (
        <p className="border-t border-border px-4 py-3 text-13 text-fg-muted sm:px-5">
          The login is disabled while the member is archived.
        </p>
      )}
      {canUpdate && !account && member.email && (
        <PortalAccountDialog member={member} open={open} onOpenChange={setOpen} />
      )}
    </Card>
  );
}

export function RecordCard({ member, canArchive }: { member: MemberDto; canArchive: boolean }) {
  const [dialog, setDialog] = useState<'archive' | 'restore' | null>(null);
  const archive = useArchiveMember(member.id);
  const name = fullName(member);

  const run = (archiving: boolean) => (reason: string | undefined) =>
    archive.mutate(
      { archive: archiving, reason },
      {
        onSuccess: () => {
          toast.success(archiving ? `${name} archived` : `${name} restored`, {
            description: archiving
              ? 'Their portal login was signed out and disabled. History is kept.'
              : undefined,
          });
          setDialog(null);
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );

  return (
    <Card>
      <CardHeader title="Record" />
      <dl className="divide-y divide-border px-4 sm:px-5">
        <Row label="Member code">
          <span className="font-mono">{member.memberCode}</span>
        </Row>
        <Row label="Registered">{formatDate(member.registrationDate)}</Row>
        <Row label="Added to the system">{formatDateTime(member.createdAt)}</Row>
        <Row label="Last changed">{formatDateTime(member.updatedAt)}</Row>
        {member.archivedAt && <Row label="Archived">{formatDateTime(member.archivedAt)}</Row>}
      </dl>
      {canArchive && (
        <div className="border-t border-border px-4 py-4 sm:px-5">
          {member.archivedAt ? (
            <Button
              variant="secondary"
              className="w-full"
              icon={<ArchiveRestore aria-hidden />}
              onClick={() => setDialog('restore')}
            >
              Restore member
            </Button>
          ) : (
            <Button
              variant="secondary"
              className="w-full text-danger-text"
              icon={<Archive aria-hidden />}
              onClick={() => setDialog('archive')}
            >
              Archive member
            </Button>
          )}
        </div>
      )}
      {canArchive && (
        <>
          <ConfirmDialog
            open={dialog === 'archive'}
            onOpenChange={(open) => setDialog(open ? 'archive' : null)}
            title={`Archive ${name}?`}
            description="They leave the current member list and can no longer be edited or sign in to the portal. Nothing is deleted, and you can restore them later."
            confirmLabel="Archive member"
            tone="danger"
            reason="required"
            loading={archive.isPending}
            onConfirm={run(true)}
          />
          <ConfirmDialog
            open={dialog === 'restore'}
            onOpenChange={(open) => setDialog(open ? 'restore' : null)}
            title={`Restore ${name}?`}
            description="They return to the current member list. A portal login, if they had one, works again."
            confirmLabel="Restore member"
            reason="optional"
            loading={archive.isPending}
            onConfirm={run(false)}
          />
        </>
      )}
    </Card>
  );
}
