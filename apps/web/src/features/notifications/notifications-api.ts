import type {
  ChannelStatusDto,
  NotificationDto,
  NotificationListQuery,
  Paginated,
  UnreadCountDto,
} from '@gms/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { queryKeys } from '../../api/query-keys';

/** Reminder jobs run in the background, so the bell checks back every minute. */
const POLL_MS = 60_000;

export function useNotifications(query: NotificationListQuery, enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.notifications.list(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<NotificationDto>>('/notifications', { query: { ...query }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: queryKeys.notifications.unreadCount,
    queryFn: ({ signal }) => api.get<UnreadCountDto>('/notifications/unread-count', { signal }),
    select: (result) => result.count,
    refetchInterval: POLL_MS,
  });
}

function useNotificationMutation<TInput, TResult>(request: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all }),
  });
}

export const useMarkRead = () =>
  useNotificationMutation((id: string) => api.post<NotificationDto>(`/notifications/${id}/read`));

export const useMarkAllRead = () =>
  useNotificationMutation(() => api.post<{ updated: number }>('/notifications/read-all'));

export function useChannelStatus() {
  return useQuery({
    queryKey: queryKeys.notifications.channels,
    queryFn: ({ signal }) => api.get<ChannelStatusDto[]>('/notifications/channels', { signal }),
  });
}
