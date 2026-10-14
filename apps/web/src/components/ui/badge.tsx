import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'danger' | 'warning';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-fg-secondary ring-border',
  primary: 'bg-primary-subtle text-primary-text ring-primary/20',
  success: 'bg-success-subtle text-success-text ring-success/25',
  danger: 'bg-danger-subtle text-danger-text ring-danger/25',
  warning: 'bg-warning-subtle text-warning-text ring-warning-text/25',
};

export function Badge({
  tone = 'neutral',
  dot,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        TONES[tone],
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}
