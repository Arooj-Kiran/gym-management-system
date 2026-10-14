import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  delayMs?: number;
}

/** Debounced search box; `label` is visually hidden but announced. */
export function SearchInput({
  value,
  onChange,
  label,
  placeholder,
  delayMs = 300,
}: SearchInputProps) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);

  // Follow outside changes (e.g. "clear filters") without fighting the user's own typing.
  if (synced !== value) {
    setSynced(value);
    if (draft.trim() !== value) setDraft(value);
  }

  useEffect(() => {
    if (draft.trim() === value) return;
    const timer = setTimeout(() => onChange(draft.trim()), delayMs);
    return () => clearTimeout(timer);
  }, [draft, value, onChange, delayMs]);

  return (
    <div className="relative w-full">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted"
        aria-hidden
      />
      <input
        type="search"
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        className="h-10 w-full rounded-md border border-border-strong bg-surface pr-9 pl-9 text-sm text-fg shadow-xs placeholder:text-fg-muted focus:border-primary focus:ring-3 focus:ring-primary/20 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {draft && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setDraft('');
            onChange('');
          }}
          className="absolute top-1/2 right-2 inline-flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm text-fg-muted hover:bg-surface-muted hover:text-fg"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
