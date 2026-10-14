import { PASSWORD_MIN_LENGTH } from '@gms/shared';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { FormField, Input } from '../../components/ui/form-field';
import { generateTemporaryPassword } from '../../lib/password';

interface TemporaryPasswordFieldProps {
  error?: string;
  value: string;
  onGenerate: (password: string) => void;
  inputProps: ComponentProps<typeof Input>;
}

/**
 * Temporary password chosen by the Admin. It is shown in clear text on purpose: the Admin has to
 * hand it over, and the staff member must replace it at first sign-in.
 */
export function TemporaryPasswordField({
  error,
  value,
  onGenerate,
  inputProps,
}: TemporaryPasswordFieldProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <FormField
      label="Temporary password"
      error={error}
      hint={`At least ${PASSWORD_MIN_LENGTH} characters. They must change it when they first sign in.`}
    >
      <TemporaryPasswordControl
        inputProps={inputProps}
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              icon={<RefreshCw aria-hidden />}
              onClick={() => onGenerate(generateTemporaryPassword())}
            >
              Generate
            </Button>
            <Button
              type="button"
              variant="secondary"
              aria-label={copied ? 'Copied' : 'Copy password'}
              title="Copy password"
              disabled={!value}
              onClick={copy}
              className="px-3"
            >
              {copied ? <Check className="text-success" aria-hidden /> : <Copy aria-hidden />}
            </Button>
          </>
        }
      />
    </FormField>
  );
}

/** Receives id/aria props from FormField and passes them to the input. */
function TemporaryPasswordControl({
  inputProps,
  actions,
  ...aria
}: {
  inputProps: ComponentProps<typeof Input>;
  actions: ReactNode;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  return (
    <div className="flex gap-2">
      <Input
        type="text"
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 font-mono tracking-wide"
        {...inputProps}
        {...aria}
      />
      {actions}
    </div>
  );
}
