import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
}

const tabId = (idPrefix: string, value: string) => `${idPrefix}-tab-${value}`;
const panelId = (idPrefix: string, value: string) => `${idPrefix}-panel-${value}`;

/**
 * WAI-ARIA tabs with automatic activation: arrow keys, Home and End move between tabs and only
 * the selected tab is in the tab order.
 */
export function Tabs<T extends string>({
  label,
  idPrefix,
  tabs,
  value,
  onChange,
  className,
}: {
  label: string;
  idPrefix: string;
  tabs: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent) => {
    const index = tabs.findIndex((tab) => tab.value === value);
    const target =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null;
    if (target === null) return;
    event.preventDefault();
    const next = tabs[target]!.value;
    onChange(next);
    refs.current.get(next)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('flex gap-1 border-b border-border', className)}
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(node) => {
              if (node) refs.current.set(tab.value, node);
              else refs.current.delete(tab.value);
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, tab.value)}
            aria-selected={selected}
            aria-controls={panelId(idPrefix, tab.value)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={cn(
              '-mb-px inline-flex h-10 cursor-pointer items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors duration-150 focus-visible:-outline-offset-2',
              selected
                ? 'border-primary text-fg'
                : 'border-transparent text-fg-secondary hover:border-border-strong hover:text-fg',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  idPrefix,
  value,
  children,
}: {
  idPrefix: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={panelId(idPrefix, value)}
      aria-labelledby={tabId(idPrefix, value)}
      className="focus-visible:outline-offset-4"
    >
      {children}
    </div>
  );
}
