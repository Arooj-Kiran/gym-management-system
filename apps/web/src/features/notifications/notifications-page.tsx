import { NOTIFICATION_TYPE_LABELS, type NotificationDto } from '@gms/shared';
import { BellOff, CheckCheck } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatDateTime, formatRelative } from '../../lib/format';
import { useUrlFilters } from '../billing/use-url-filters';
import { NOTIFICATION_ICONS, notificationLink, URGENT_TYPES } from './notification-format';
import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from './notifications-api';

const PAGE_SIZE = 20;

function NotificationRow({
  notification,
  isMember,
}: {
  notification: NotificationDto;
  isMember: boolean;
}) {
  const markRead = useMarkRead();
  const Icon = NOTIFICATION_ICONS[notification.type];
  const isUnread = !notification.readAt;
  const urgent = URGENT_TYPES.includes(notification.type);
  const link = notificationLink(notification, isMember);
  const read = () => isUnread && markRead.mutate(notification.id);

  return (
    <li
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-4 sm:px-5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-start',
        isUnread && 'bg-primary-subtle/40',
      )}
    >
      <span
        className={cn(
          'flex size-9 items-center justify-center rounded-md',
          urgent ? 'bg-warning-subtle text-warning-text' : 'bg-primary-subtle text-primary-text',
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {isUnread && <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden />}
          <span className="text-xs font-medium text-fg-muted">
            {NOTIFICATION_TYPE_LABELS[notification.type]}
          </span>
          <time
            dateTime={notification.createdAt}
            title={formatDateTime(notification.createdAt)}
            className="text-xs text-fg-muted"
          >
            · {formatRelative(notification.createdAt)}
          </time>
        </p>
        <h2
          className={cn('mt-1 text-sm', isUnread ? 'font-semibold text-fg' : 'font-medium text-fg')}
        >
          {isUnread && <span className="sr-only">Unread: </span>}
          {link ? (
            <Link to={link} onClick={read} className="hover:text-primary-text hover:underline">
              {notification.title}
            </Link>
          ) : (
            notification.title
          )}
        </h2>
        <p className="mt-0.5 text-13 text-fg-secondary">{notification.body}</p>
      </div>
      {isUnread && (
        <div className="col-start-2 md:col-start-auto">
          <Button variant="ghost" size="sm" loading={markRead.isPending} onClick={read}>
            Mark as read<span className="sr-only">: {notification.title}</span>
          </Button>
        </div>
      )}
    </li>
  );
}

export function NotificationsPage() {
  const { user } = useSession();
  const { text, page, update } = useUrlFilters();
  const unreadOnly = text('show') === 'unread';
  const list = useNotifications({
    page,
    pageSize: PAGE_SIZE,
    unreadOnly: unreadOnly ? 'true' : undefined,
  });
  const unread = useUnreadCount();
  const markAll = useMarkAllRead();
  const count = unread.data ?? 0;
  const isMember = user.role === 'MEMBER';

  return (
    <>
      <PageHeader
        title="Notifications"
        description={
          isMember
            ? 'Reminders about your membership, payments, classes and appointments.'
            : 'Reminders and alerts for you: sessions you run, and for managers, equipment that needs servicing.'
        }
        actions={
          <Button
            variant="secondary"
            icon={<CheckCheck aria-hidden />}
            disabled={count === 0}
            loading={markAll.isPending}
            onClick={() =>
              markAll.mutate(undefined, {
                onSuccess: ({ updated }) =>
                  toast.success(
                    updated === 1
                      ? '1 notification marked as read'
                      : `${updated} notifications marked as read`,
                  ),
                onError: (error) => toast.error(errorMessage(error)),
              })
            }
          >
            Mark all as read
          </Button>
        }
      />

      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-border p-4 sm:px-5">
          <div
            role="group"
            aria-label="Show"
            className="inline-flex rounded-md border border-border bg-surface-muted p-0.5"
          >
            {[
              { value: null, label: 'All' },
              { value: 'unread', label: count > 0 ? `Unread (${count})` : 'Unread' },
            ].map((option) => {
              const active = unreadOnly === (option.value === 'unread');
              return (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => update({ show: option.value })}
                  className={cn(
                    'h-8 cursor-pointer rounded-[5px] px-3 text-13 font-medium transition-colors duration-150',
                    active ? 'bg-surface text-fg shadow-xs' : 'text-fg-secondary hover:text-fg',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        {list.isPending ? (
          <ListSkeleton rows={6} label="Loading notifications" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.data.length === 0 ? (
          <EmptyState
            icon={<BellOff aria-hidden />}
            title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}
            description={
              unreadOnly
                ? 'You are all caught up.'
                : 'Reminders appear here as they are created. They are also sent by email, SMS or WhatsApp once those channels are set up.'
            }
            action={
              unreadOnly && (
                <Button variant="secondary" size="sm" onClick={() => update({ show: null })}>
                  Show all
                </Button>
              )
            }
          />
        ) : (
          <>
            <ul
              aria-label="Notifications"
              aria-busy={list.isPlaceholderData}
              className={cn(
                'divide-y divide-border transition-opacity',
                list.isPlaceholderData && 'opacity-60',
              )}
            >
              {list.data.data.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  isMember={isMember}
                />
              ))}
            </ul>
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              noun="notifications"
              onPageChange={(page) => update({ page: page > 1 ? String(page) : null }, false)}
            />
          </>
        )}
      </Card>
    </>
  );
}
