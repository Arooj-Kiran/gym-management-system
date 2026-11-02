import * as Menu from '@radix-ui/react-dropdown-menu';
import { Bell, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Skeleton } from '../../components/ui/states';
import { useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatRelative } from '../../lib/format';
import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from './notifications-api';
import {
  countLabel,
  NOTIFICATION_ICONS,
  notificationLink,
  URGENT_TYPES,
} from './notification-format';

const RECENT = 6;
const ITEM =
  'flex cursor-pointer gap-3 rounded-md px-2.5 py-2.5 outline-none select-none data-[highlighted]:bg-surface-muted';
const FOOTER_ITEM =
  'flex h-9 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md px-2.5 text-13 font-medium text-fg-secondary outline-none select-none data-[disabled]:cursor-default data-[disabled]:opacity-50 data-[highlighted]:bg-surface-muted data-[highlighted]:text-fg [&_svg]:size-4';

/** The bell in the app chrome: unread count, the latest few, and a way to the full list. */
export function NotificationBell() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const recent = useNotifications({ pageSize: RECENT }, open);
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const count = unread.data ?? 0;
  const isMember = user.role === 'MEMBER';

  const label = count > 0 ? `Notifications, ${count} unread` : 'Notifications';

  // Non-modal: a modal menu marks the page aria-hidden while its controls stay focusable.
  return (
    <Menu.Root open={open} onOpenChange={setOpen} modal={false}>
      <Menu.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className="relative inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-fg transition-colors duration-150 hover:bg-sidebar-raised hover:text-white focus-visible:outline-sidebar-accent data-[state=open]:bg-sidebar-raised data-[state=open]:text-white"
          data-testid="notification-bell"
        >
          <Bell className="size-[18px]" aria-hidden />
          {count > 0 && (
            <span
              className="absolute top-1.5 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-2xs leading-none font-semibold text-white tabular-nums ring-2 ring-sidebar"
              aria-hidden
            >
              {countLabel(count)}
            </span>
          )}
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-[min(24rem,calc(100vw-1.5rem))] rounded-lg border border-border bg-surface p-1.5 shadow-lg animate-pop-in"
        >
          <div className="flex items-baseline justify-between gap-3 px-2.5 pt-1.5 pb-2">
            <p className="text-sm font-semibold text-fg">Notifications</p>
            <p className="text-13 text-fg-muted tabular-nums">
              {count > 0 ? `${count} unread` : 'All caught up'}
            </p>
          </div>
          <Menu.Separator className="-mx-1.5 mb-1 h-px bg-border" />

          {recent.isPending ? (
            <div className="flex flex-col gap-3 px-2.5 py-2" aria-label="Loading notifications">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : recent.isError ? (
            <p className="px-2.5 py-4 text-13 text-danger-text">{errorMessage(recent.error)}</p>
          ) : recent.data.data.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-13 text-fg-muted">
              Reminders about memberships, payments and sessions appear here.
            </p>
          ) : (
            <div className="max-h-[min(26rem,60vh)] overflow-y-auto">
              {recent.data.data.map((notification) => {
                const Icon = NOTIFICATION_ICONS[notification.type];
                const isUnread = !notification.readAt;
                const urgent = URGENT_TYPES.includes(notification.type);
                return (
                  <Menu.Item
                    key={notification.id}
                    className={ITEM}
                    onSelect={() => {
                      if (isUnread) markRead.mutate(notification.id);
                      navigate(notificationLink(notification, isMember) ?? '/notifications');
                    }}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md',
                        urgent
                          ? 'bg-warning-subtle text-warning-text'
                          : 'bg-primary-subtle text-primary-text',
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block text-sm',
                          isUnread ? 'font-semibold text-fg' : 'font-medium text-fg-secondary',
                        )}
                      >
                        {isUnread && <span className="sr-only">Unread: </span>}
                        {notification.title}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-13 text-fg-muted">
                        {notification.body}
                      </span>
                      <span className="mt-1 block text-xs text-fg-muted">
                        {formatRelative(notification.createdAt)}
                      </span>
                    </span>
                    {isUnread && (
                      <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-hidden />
                    )}
                  </Menu.Item>
                );
              })}
            </div>
          )}

          <Menu.Separator className="-mx-1.5 mt-1 mb-1 h-px bg-border" />
          <div className="flex gap-1">
            <Menu.Item
              className={FOOTER_ITEM}
              disabled={count === 0 || markAll.isPending}
              onSelect={(event) => {
                event.preventDefault();
                markAll.mutate(undefined, {
                  onSuccess: () => toast.success('All notifications marked as read'),
                  onError: (error) => toast.error(errorMessage(error)),
                });
              }}
            >
              <CheckCheck aria-hidden />
              Mark all read
            </Menu.Item>
            <Menu.Item className={FOOTER_ITEM} onSelect={() => navigate('/notifications')}>
              View all
            </Menu.Item>
          </div>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
