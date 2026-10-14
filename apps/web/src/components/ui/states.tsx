import { AlertTriangle, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { errorMessage } from '../../api/client';
import { cn } from '../../lib/cn';
import { Button } from './button';

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="mb-4 flex size-11 items-center justify-center rounded-lg bg-surface-muted text-fg-muted ring-1 ring-border [&_svg]:size-5">
        {icon}
      </div>
      <p className="text-sm font-semibold text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-13 text-fg-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title = 'This could not be loaded',
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center px-6 py-12 text-center', className)}
    >
      <div className="mb-4 flex size-11 items-center justify-center rounded-lg bg-danger-subtle text-danger-text [&_svg]:size-5">
        <AlertTriangle aria-hidden />
      </div>
      <p className="text-sm font-semibold text-fg">{title}</p>
      <p className="mt-1 max-w-sm text-13 text-fg-muted">{errorMessage(error)}</p>
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-5"
          icon={<RotateCw aria-hidden />}
          onClick={onRetry}
        >
          Try again
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-muted', className)} aria-hidden />;
}

/** Placeholder rows shown while a list loads; announced once to assistive tech. */
export function ListSkeleton({ rows = 5, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="divide-y divide-border">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="hidden h-5 w-16 sm:block" />
        </div>
      ))}
    </div>
  );
}
