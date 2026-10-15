<script setup lang="ts">
import { Bell } from '@lucide/vue';
import AppDropdown from '@/components/ui/AppDropdown.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';

export interface ShellNotification {
  id: string;
  title: string;
  body: string;
  /** Preformatted time, e.g. "5 min ago". */
  time: string;
  read: boolean;
}

const props = defineProps<{
  notifications: readonly ShellNotification[];
  /** All unread notifications, when more exist than are listed here. */
  unreadCount?: number;
}>();

const emit = defineEmits<{
  select: [id: string];
  'view-all': [];
}>();

const unread = () =>
  props.unreadCount ?? props.notifications.filter((notification) => !notification.read).length;
</script>

<template>
  <AppDropdown
    :label="unread() > 0 ? `Notifications, ${unread()} unread` : 'Notifications'"
    width-class="w-80"
  >
    <template #trigger>
      <span
        class="text-fg-muted hover:bg-fg/5 hover:text-fg rounded-control relative flex size-10 items-center justify-center transition-colors"
      >
        <Bell class="size-5" aria-hidden="true" />
        <span
          v-if="unread() > 0"
          class="bg-danger ring-surface absolute top-2 right-2 size-2 rounded-full ring-2"
          data-testid="notifications-unread-dot"
        />
      </span>
    </template>

    <template #default="{ close }">
      <p class="border-line border-b px-4 py-3 text-sm font-semibold">Notifications</p>

      <ul v-if="props.notifications.length > 0" class="relative max-h-80 overflow-y-auto py-1">
        <li v-for="notification in props.notifications" :key="notification.id">
          <button
            type="button"
            class="hover:bg-surface-muted flex w-full gap-3 px-4 py-2.5 text-left focus-visible:outline-none"
            @click="
              close();
              emit('select', notification.id);
            "
          >
            <span
              class="mt-1.5 size-2 shrink-0 rounded-full"
              :class="notification.read ? 'bg-transparent' : 'bg-primary'"
              aria-hidden="true"
            />
            <span class="min-w-0">
              <span class="block truncate text-sm font-medium">{{ notification.title }}</span>
              <span class="text-fg-muted line-clamp-2 text-xs">{{ notification.body }}</span>
              <span class="text-fg-muted mt-0.5 block text-[0.6875rem]">
                {{ notification.time }}
              </span>
            </span>
          </button>
        </li>
      </ul>

      <AppEmptyState
        v-else
        :icon="Bell"
        title="No notifications"
        description="Updates about your school will appear here."
      />

      <button
        type="button"
        class="border-line text-primary hover:bg-surface-muted w-full border-t px-4 py-2.5 text-sm font-medium focus-visible:outline-none"
        @click="
          close();
          emit('view-all');
        "
      >
        View all notifications
      </button>
    </template>
  </AppDropdown>
</template>
