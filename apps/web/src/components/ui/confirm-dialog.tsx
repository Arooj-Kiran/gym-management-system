import { useState, type ReactNode } from 'react';
import { Button } from './button';
import { Dialog } from './dialog';
import { FormField, Textarea } from './form-field';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  /** Ask for a reason (stored in the audit log). `required` enforces a minimum of 3 characters. */
  reason?: 'none' | 'optional' | 'required';
  reasonLabel?: string;
  loading?: boolean;
  onConfirm: (reason: string | undefined) => void;
  children?: ReactNode;
}

/** Confirmation for sensitive actions (RULES §12). The confirm button is never the default focus. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = 'primary',
  reason = 'none',
  reasonLabel = 'Reason',
  loading,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const trimmed = text.trim();
  const reasonError =
    reason === 'required' && trimmed.length < 3
      ? 'Give a short reason (at least 3 characters)'
      : undefined;

  const close = (next: boolean) => {
    if (!next) {
      setText('');
      setTouched(false);
    }
    onOpenChange(next);
  };

  const submit = () => {
    setTouched(true);
    if (reasonError) return;
    onConfirm(trimmed || undefined);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={title}
      description={description}
      size="sm"
      busy={loading}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone} onClick={submit} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {children}
        {reason !== 'none' && (
          <FormField
            label={reasonLabel}
            optional={reason === 'optional'}
            error={touched ? reasonError : undefined}
            hint="Saved in the audit log."
          >
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={500}
              rows={3}
            />
          </FormField>
        )}
      </form>
    </Dialog>
  );
}
