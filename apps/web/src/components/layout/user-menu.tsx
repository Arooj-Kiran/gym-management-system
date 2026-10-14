import * as Menu from '@radix-ui/react-dropdown-menu';
import { ROLE_LABELS } from '@gms/shared';
import { LogOut, Moon, Sun, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { fullName, useLogout, useSession } from '../../lib/auth';
import { useTheme } from '../../lib/theme';

const ITEM =
  'flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm text-fg outline-none select-none data-[highlighted]:bg-surface-muted [&_svg]:size-4 [&_svg]:text-fg-muted';

export function UserMenu({
  trigger,
  align = 'end',
  side = 'bottom',
}: {
  trigger: ReactNode;
  align?: 'start' | 'end';
  side?: 'top' | 'bottom';
}) {
  const { user } = useSession();
  const navigate = useNavigate();
  const logout = useLogout();
  const { theme, toggle } = useTheme();

  const signOut = () =>
    logout.mutate(undefined, {
      onSuccess: () => navigate('/login', { replace: true }),
      onError: () => {
        toast.error('Sign-out did not reach the server. Your local session was cleared.');
        navigate('/login', { replace: true });
      },
    });

  return (
    <Menu.Root>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align={align}
          side={side}
          sideOffset={6}
          className="z-50 w-60 rounded-lg border border-border bg-surface p-1.5 shadow-lg animate-pop-in"
        >
          <div className="px-2.5 pt-1.5 pb-2.5">
            <p className="truncate text-sm font-medium text-fg">{fullName(user)}</p>
            <p className="truncate text-13 text-fg-muted">{user.email}</p>
            <p className="mt-1 text-xs text-fg-secondary">{ROLE_LABELS[user.role]}</p>
          </div>
          <Menu.Separator className="-mx-1.5 my-1 h-px bg-border" />
          <Menu.Item className={ITEM} onSelect={() => navigate('/account')}>
            <UserRound aria-hidden />
            My account
          </Menu.Item>
          <Menu.Item className={ITEM} onSelect={toggle}>
            {theme === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </Menu.Item>
          <Menu.Separator className="-mx-1.5 my-1 h-px bg-border" />
          <Menu.Item className={ITEM} onSelect={signOut} disabled={logout.isPending}>
            <LogOut aria-hidden />
            Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
