import { FlaskConical } from 'lucide-react';

/** Shown on every staff screen while fictional demo records exist (is_demo). */
export function DemoDataBanner() {
  return (
    <div
      role="note"
      aria-label="Demo data"
      className="border-b border-warning-text/20 bg-warning-subtle text-warning-text lg:pl-64"
    >
      <p className="mx-auto flex w-full max-w-[1200px] items-center gap-2.5 px-4 py-2 text-13 sm:px-6 lg:px-10">
        <FlaskConical className="size-4 shrink-0" aria-hidden />
        <span>
          <span className="font-semibold tracking-wide">DEMO DATA</span>
          <span className="mx-1.5" aria-hidden>
            ·
          </span>
          This workspace contains fictional sample members marked “Demo”. They are not real people.
        </span>
      </p>
    </div>
  );
}
