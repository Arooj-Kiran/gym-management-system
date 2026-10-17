import * as RadixDialog from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useSession } from '../../lib/auth';
import { isStaffRole } from '@gms/shared';
import { Avatar } from '../ui/avatar';
import { DemoDataBanner } from './demo-data-banner';
import { BrandMark, SidebarContent } from './sidebar';
import { UserMenu } from './user-menu';

/**
 * ≥1024px: fixed navy sidebar. Below 1024px: a top bar with a menu button that opens the same
 * navigation in a focus-trapped drawer.
 */
export function AppShell() {
  const session = useSession();
  const location = useLocation();
  // The drawer remembers the page it was opened on, so any navigation closes it.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const drawerOpen = openedOn === location.pathname;
  const setDrawerOpen = (open: boolean) => setOpenedOn(open ? location.pathname : null);

  // Growing past the breakpoint swaps the drawer for the fixed sidebar.
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const close = () => desktop.matches && setOpenedOn(null);
    desktop.addEventListener('change', close);
    return () => desktop.removeEventListener('change', close);
  }, []);

  return (
    <div className="min-h-dvh bg-bg">
      <a
        href="#main"
        className="sr-only z-[60] rounded-md bg-primary px-3 py-2 text-sm font-medium text-on-primary focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block" data-testid="sidebar">
        <SidebarContent />
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-sidebar-border bg-sidebar px-3 sm:px-4 lg:hidden">
        <RadixDialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
          <RadixDialog.Trigger
            className="inline-flex size-10 cursor-pointer items-center justify-center rounded-md text-sidebar-fg hover:bg-sidebar-raised hover:text-white focus-visible:outline-sidebar-accent"
            aria-label="Open navigation"
          >
            <Menu className="size-5" aria-hidden />
          </RadixDialog.Trigger>
          <RadixDialog.Portal>
            <RadixDialog.Overlay className="fixed inset-0 z-40 bg-overlay animate-fade-in lg:hidden" />
            <RadixDialog.Content
              className="fixed inset-y-0 left-0 z-50 w-[min(18rem,calc(100vw-3rem))] shadow-lg animate-slide-in-left focus:outline-none lg:hidden"
              aria-describedby={undefined}
              data-testid="nav-drawer"
            >
              <RadixDialog.Title className="sr-only">Navigation</RadixDialog.Title>
              <SidebarContent inDrawer onNavigate={() => setDrawerOpen(false)} />
              <RadixDialog.Close
                className="absolute top-3.5 right-3 inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-sidebar-fg-muted hover:bg-sidebar-raised hover:text-white"
                aria-label="Close navigation"
              >
                <X className="size-4.5" aria-hidden />
              </RadixDialog.Close>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        </RadixDialog.Root>

        <div className="min-w-0 flex-1">
          <BrandMark gymName={session.gym.name} />
        </div>

        <UserMenu
          trigger={
            <button
              type="button"
              aria-label="Account menu"
              className="inline-flex size-10 cursor-pointer items-center justify-center rounded-md hover:bg-sidebar-raised focus-visible:outline-sidebar-accent"
            >
              <Avatar user={session.user} size="sm" />
            </button>
          }
        />
      </header>

      {session.gym.hasDemoData && isStaffRole(session.user.role) && <DemoDataBanner />}

      <main id="main" tabIndex={-1} className="focus:outline-none lg:pl-64">
        <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
