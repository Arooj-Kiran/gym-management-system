import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary shadow-xs hover:bg-primary-hover active:bg-primary-active',
  secondary:
    'border border-border-strong bg-surface text-fg shadow-xs hover:bg-surface-hover active:bg-surface-muted',
  ghost: 'text-fg-secondary hover:bg-surface-muted hover:text-fg active:bg-surface-muted',
  danger: 'bg-danger text-white shadow-xs hover:bg-danger-hover active:bg-danger-hover',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-13',
  md: 'h-10 gap-2 px-4 text-sm',
};

function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  extra?: string,
) {
  return cn(
    'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md font-medium whitespace-nowrap',
    'transition-colors duration-150 ease-out select-none',
    'disabled:cursor-not-allowed disabled:opacity-55 [&_svg]:size-4 [&_svg]:shrink-0',
    VARIANTS[variant],
    SIZES[size],
    extra,
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant,
  size,
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

export function ButtonLink({
  variant,
  size,
  icon,
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      className={buttonClasses(
        variant,
        size,
        typeof className === 'string' ? className : undefined,
      )}
      {...props}
    >
      {icon}
      {children}
    </Link>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

/** Square icon-only button; `label` is required so screen readers announce it. */
export function IconButton({
  label,
  className,
  children,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-fg-secondary',
        'transition-colors duration-150 hover:bg-surface-muted hover:text-fg [&_svg]:size-[18px]',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
