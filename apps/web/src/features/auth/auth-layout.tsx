import { ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

function Mark() {
  return (
    <span className="flex size-9 items-center justify-center rounded-lg bg-sidebar-raised ring-1 ring-sidebar-border">
      <svg viewBox="0 0 32 32" className="size-5.5" aria-hidden>
        <path
          d="M8 13v6M11 10v12M21 10v12M24 13v6M11 16h10"
          stroke="var(--sidebar-accent)"
          strokeWidth="2.6"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </span>
  );
}

/** Split layout for signed-out screens: navy brand panel (desktop) beside a white form column. */
export function AuthLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh bg-surface lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-fg lg:flex xl:p-12">
        {/* Quiet plate-weight motif: thin horizontal rules, no gradients. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, #fff 0 1px, transparent 1px 48px)',
          }}
        />
        <div className="relative flex items-center gap-3">
          <Mark />
          <span className="text-sm font-semibold text-white">Gym Management</span>
        </div>
        <div className="relative max-w-sm">
          <p className="text-3xl leading-tight font-semibold tracking-tight text-white">
            The front desk, memberships and door access in one place.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-sidebar-fg-muted">
            Staff sign in with the account an Admin created for them. Every sensitive change is
            recorded in the audit log.
          </p>
        </div>
        <p className="relative flex items-center gap-2 text-xs text-sidebar-fg-muted">
          <ShieldCheck className="size-4 text-sidebar-accent" aria-hidden />
          Sessions end automatically after a period of inactivity.
        </p>
      </aside>

      <main className="flex items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="rounded-lg bg-sidebar p-0.5">
              <Mark />
            </span>
            <span className="text-sm font-semibold text-fg">Gym Management</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-fg-secondary">{description}</p>
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
