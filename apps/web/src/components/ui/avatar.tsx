import { cn } from '../../lib/cn';
import { initials } from '../../lib/auth';

export function Avatar({
  user,
  size = 'md',
  className,
}: {
  user: { firstName: string; lastName: string };
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const sizes = { sm: 'size-7 text-2xs', md: 'size-8 text-xs', lg: 'size-12 text-base' };
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-primary-subtle font-semibold text-primary-text',
        sizes[size],
        className,
      )}
    >
      {initials(user)}
    </span>
  );
}
