import { isStaffRole, permissionScope, ROLE_LABELS } from '@gms/shared';
import { NavLink } from 'react-router';
import { fullName, useCan, useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { Avatar } from '../ui/avatar';
import { NAV_SECTIONS, type NavItem } from './nav-items';
import { UserMenu } from './user-menu';

function useVisibleNav() {
  const { user } = useSession();
  const can = useCan();
  const visible = (item: NavItem) =>
    (!item.staffOnly || isStaffRole(user.role)) &&
    (!item.memberOnly || user.role === 'MEMBER') &&
    (!item.permission || can(item.permission)) &&
    (!item.fullScope || !item.permission || permissionScope(user.role, item.permission) === 'ALL');
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(visible),
  })).filter((section) => section.items.length > 0);
}

export function BrandMark({ gymName }: { gymName: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-raised ring-1 ring-sidebar-border">
        <svg viewBox="0 0 32 32" className="size-5" aria-hidden>
          <path
            d="M8 13v6M11 10v12M21 10v12M24 13v6M11 16h10"
            stroke="var(--sidebar-accent)"
            strokeWidth="2.6"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </span>
      <span className="truncate text-sm font-semibold text-white">{gymName}</span>
    </div>
  );
}

/** Navigation content shared by the desktop sidebar and the mobile drawer. */
export function SidebarContent({
  onNavigate,
  inDrawer,
}: {
  onNavigate?: () => void;
  inDrawer?: boolean;
}) {
  const session = useSession();
  const sections = useVisibleNav();

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-fg">
      <div
        className={cn(
          'flex h-16 shrink-0 items-center border-b border-sidebar-border pl-5',
          inDrawer ? 'pr-14' : 'pr-5',
        )}
      >
        <BrandMark gymName={session.gym.name} />
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-5">
        {sections.map((section) => (
          <div key={section.title} className="mb-6 last:mb-0">
            <p className="mb-1.5 px-3 text-2xs font-semibold tracking-wider text-sidebar-fg-muted uppercase">
              {section.title}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-150',
                        'focus-visible:outline-sidebar-accent',
                        isActive
                          ? 'bg-sidebar-active text-white'
                          : 'text-sidebar-fg hover:bg-sidebar-raised hover:text-white',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span
                            className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-sidebar-accent"
                            aria-hidden
                          />
                        )}
                        <item.icon
                          className={cn(
                            'size-[18px] shrink-0',
                            isActive
                              ? 'text-sidebar-accent'
                              : 'text-sidebar-fg-muted group-hover:text-sidebar-fg',
                          )}
                          aria-hidden
                        />
                        {item.label}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border p-3">
        <UserMenu
          align="start"
          side="top"
          trigger={
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left transition-colors duration-150 hover:bg-sidebar-raised focus-visible:outline-sidebar-accent"
            >
              <Avatar user={session.user} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-white">
                  {fullName(session.user)}
                </span>
                <span className="block truncate text-xs text-sidebar-fg-muted">
                  {ROLE_LABELS[session.user.role]}
                </span>
              </span>
            </button>
          }
        />
      </div>
    </div>
  );
}
