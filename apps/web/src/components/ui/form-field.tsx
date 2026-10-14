import {
  cloneElement,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';

const CONTROL = cn(
  'w-full rounded-md border bg-surface text-sm text-fg shadow-xs placeholder:text-fg-muted',
  'transition-[border-color,box-shadow] duration-150 ease-out',
  'focus:border-primary focus:ring-3 focus:ring-primary/20 focus:outline-none',
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-muted',
  'aria-invalid:border-danger aria-invalid:focus:ring-danger/20',
);

export function Input({
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      className={cn(CONTROL, 'h-10 border-border-strong px-3', className)}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ref,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      ref={ref}
      className={cn(CONTROL, 'min-h-20 border-border-strong px-3 py-2', className)}
      {...props}
    />
  );
}

/** Native select: fully keyboard and screen-reader accessible, styled to match inputs. */
export function Select({
  className,
  children,
  ref,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> }) {
  return (
    <div className={cn('relative', className)}>
      <select
        ref={ref}
        className={cn(
          CONTROL,
          'h-10 cursor-pointer appearance-none border-border-strong pr-9 pl-3',
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-muted"
        aria-hidden
      />
    </div>
  );
}

interface FormFieldProps {
  label: string;
  children: ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>;
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  className?: string;
}

/** Label + control + hint/error, wired up with ids and aria attributes. */
export function FormField({ label, children, error, hint, optional, className }: FormFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-13 font-medium text-fg">
        {label}
        {optional && <span className="ml-1 font-normal text-fg-muted">(optional)</span>}
      </label>
      {isValidElement(children) &&
        cloneElement(children, {
          id,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': describedBy,
        })}
      {error ? (
        <p id={errorId} className="text-13 text-danger-text">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-13 text-fg-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
