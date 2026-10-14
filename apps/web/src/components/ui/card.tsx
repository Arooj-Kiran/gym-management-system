import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-surface shadow-xs', className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  id,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
      <div className="min-w-0">
        <h2 id={id} className="text-sm font-semibold text-fg">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-13 text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
