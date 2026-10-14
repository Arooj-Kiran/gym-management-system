import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Prevent closing by Escape/overlay while a request is in flight. */
  busy?: boolean;
}

const WIDTHS = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' };

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  busy,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-overlay animate-fade-in" />
        <RadixDialog.Content
          className={cn(
            'fixed inset-x-3 top-1/2 z-50 mx-auto flex max-h-[calc(100dvh-24px)] -translate-y-1/2 flex-col',
            'rounded-xl border border-border bg-surface shadow-lg animate-pop-in focus:outline-none',
            WIDTHS[size],
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="flex items-start gap-4 border-b border-border px-5 py-4 sm:px-6">
            <div className="min-w-0 flex-1">
              <RadixDialog.Title className="text-base font-semibold text-fg">
                {title}
              </RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="mt-1 text-13 text-fg-secondary">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              disabled={busy}
              className="-mt-1 -mr-2 inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-50"
              aria-label="Close"
            >
              <X className="size-4" aria-hidden />
            </RadixDialog.Close>
          </div>
          <div className="overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
          {footer && (
            <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface-muted/50 px-5 py-3.5 sm:flex-row sm:justify-end sm:px-6 rounded-b-xl">
              {footer}
            </div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
