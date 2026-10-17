import { zodResolver } from '@hookform/resolvers/zod';
import { createMemberSchema, type MemberDto } from '@gms/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { fullName } from '../../lib/auth';
import { gymTodayIso } from '../../lib/format';
import { DuplicatePhoneDialog } from './duplicate-phone-dialog';
import { handleMemberSaveError, type PhoneWarning } from './member-errors';
import { MemberFields } from './member-fields';
import { MEMBER_FIELDS, memberFormValues } from './member-form';
import { useCreateMember } from './members-api';

type FormInput = z.input<typeof createMemberSchema>;
type FormOutput = z.output<typeof createMemberSchema>;

const FORM_ID = 'create-member-form';

export function CreateMemberDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const create = useCreateMember();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createMemberSchema),
    defaultValues: memberFormValues(undefined, gymTodayIso()),
  });
  const [pending, setPending] = useState<{ values: FormOutput; warning: PhoneWarning } | null>(
    null,
  );

  const close = (next: boolean) => {
    if (!next) {
      form.reset(memberFormValues(undefined, gymTodayIso()));
      setPending(null);
    }
    onOpenChange(next);
  };

  const done = (member: MemberDto) => {
    toast.success(`${fullName(member)} registered`, {
      description: `Member code ${member.memberCode}.`,
    });
    close(false);
    void navigate(`/members/${member.id}`);
  };

  const save = (values: FormOutput) =>
    create.mutate(values, {
      onSuccess: done,
      onError: (error) =>
        handleMemberSaveError(error, form.setError, MEMBER_FIELDS, (warning) =>
          setPending({ values, warning }),
        ),
    });

  const confirmShared = (reason: string) => {
    if (!pending) return;
    create.mutate(
      { ...pending.values, confirmDuplicatePhone: true, duplicatePhoneReason: reason },
      {
        onSuccess: done,
        onError: (error) => {
          setPending(null);
          handleMemberSaveError(error, form.setError, MEMBER_FIELDS, (warning) =>
            setPending({ values: pending.values, warning }),
          );
        },
      },
    );
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={close}
        title="Register a member"
        description="A member code is assigned automatically. Plans and payments are added later."
        size="lg"
        busy={create.isPending}
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" form={FORM_ID} loading={create.isPending && !pending}>
              Register member
            </Button>
          </>
        }
      >
        <form
          id={FORM_ID}
          onSubmit={form.handleSubmit(save)}
          noValidate
          aria-label="Register a member"
        >
          <MemberFields
            register={form.register}
            control={form.control}
            errors={form.formState.errors}
            disabled={create.isPending}
          />
        </form>
      </Dialog>
      <DuplicatePhoneDialog
        warning={pending?.warning ?? null}
        onOpenChange={(next) => !next && setPending(null)}
        loading={create.isPending}
        onConfirm={confirmShared}
      />
    </>
  );
}
