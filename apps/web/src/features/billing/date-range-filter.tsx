import { X } from 'lucide-react';
import { Input } from '../../components/ui/form-field';
import { cn } from '../../lib/cn';

/** Optional inclusive date range; either end may be left open. */
export function DateRangeFilter({
  label,
  from,
  to,
  max,
  onChange,
  className,
}: {
  /** What the dates refer to, e.g. "Due" or "Received". */
  label: string;
  from: string | null | undefined;
  to: string | null | undefined;
  max?: string;
  onChange: (from: string | null, to: string | null) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="shrink-0 text-13 text-fg-muted">{label}</span>
      <Input
        type="date"
        aria-label={`${label} from`}
        value={from ?? ''}
        max={to ?? max}
        onChange={(event) => onChange(event.target.value || null, to ?? null)}
        className="min-w-0"
      />
      <span aria-hidden className="text-fg-muted">
        –
      </span>
      <Input
        type="date"
        aria-label={`${label} to`}
        value={to ?? ''}
        min={from ?? undefined}
        max={max}
        onChange={(event) => onChange(from ?? null, event.target.value || null)}
        className="min-w-0"
      />
      {(from || to) && (
        <button
          type="button"
          onClick={() => onChange(null, null)}
          aria-label={`Clear ${label.toLowerCase()} dates`}
          title="Clear dates"
          className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
