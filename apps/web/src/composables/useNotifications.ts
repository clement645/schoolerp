import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, type ComputedRef } from 'vue';
import { useRouter } from 'vue-router';
import {
  notificationsApi,
  timeAgo,
  type AppNotification,
} from '@/features/communication/communication.service';
import { useAuthStore } from '@/stores/auth';
import { safeRedirectPath } from '@/utils/format';

export const NOTIFICATIONS_KEY = 'notifications';

/** The signed-in user's latest notifications, refreshed every minute. */
export function useNotifications(): {
  latest: ComputedRef<(AppNotification & { time: string })[] | null>;
  unread: ComputedRef<number>;
  open: (id: string) => Promise<void>;
} {
  const auth = useAuthStore();
  const router = useRouter();
  const queryClient = useQueryClient();
  // Platform staff belong to no school and have no notifications.
  const enabled = computed(() => Boolean(auth.user?.tenant));

  const query = useQuery({
    queryKey: [NOTIFICATIONS_KEY, 'latest', computed(() => auth.user?.id ?? null)],
    queryFn: () => notificationsApi.list({ page: 1, pageSize: 8 }),
    enabled,
    refetchInterval: 60_000,
  });

  async function open(id: string): Promise<void> {
    const notification = query.data.value?.items.find((item) => item.id === id);
    if (!notification) return;
    if (!notification.isRead) {
      await notificationsApi.markRead(id).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: [NOTIFICATIONS_KEY] });
    }
    // Links are written by the server, but only same-site paths are followed.
    const path = safeRedirectPath(notification.link);
    if (path) void router.push(path);
  }

  return {
    latest: computed(() =>
      enabled.value
        ? (query.data.value?.items ?? []).map((item) => ({
            ...item,
            time: timeAgo(item.createdAt),
          }))
        : null,
    ),
    unread: computed(() => query.data.value?.unread ?? 0),
    open,
  };
}
