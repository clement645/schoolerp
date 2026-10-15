<script setup lang="ts">
import { Menu, PanelLeftClose, PanelLeftOpen } from '@lucide/vue';
import type { ResolvedNavigationGroup } from '@/navigation/navigation';
import GlobalSearch from './GlobalSearch.vue';
import NotificationsMenu, { type ShellNotification } from './NotificationsMenu.vue';
import UserMenu, { type ShellUser } from './UserMenu.vue';

const props = defineProps<{
  groups: readonly ResolvedNavigationGroup[];
  user: ShellUser | null;
  /** `null` hides the bell, for users who have no notifications at all. */
  notifications: readonly ShellNotification[] | null;
  unreadNotifications?: number;
  /** On phones the menu button opens the navigation drawer. */
  mobile: boolean;
  sidebarCollapsed: boolean;
}>();

const emit = defineEmits<{
  'toggle-navigation': [];
  profile: [];
  'sign-out': [];
  'select-notification': [id: string];
  'view-notifications': [];
}>();
</script>

<template>
  <header
    class="bg-surface border-line flex h-16 shrink-0 items-center gap-3 border-b px-4 sm:px-6"
  >
    <button
      type="button"
      class="text-fg-muted hover:bg-fg/5 hover:text-fg focus-visible:outline-primary rounded-control -ml-2 flex size-10 shrink-0 items-center justify-center focus-visible:outline-2"
      :aria-label="
        props.mobile
          ? 'Open navigation'
          : props.sidebarCollapsed
            ? 'Expand sidebar'
            : 'Collapse sidebar'
      "
      data-testid="navigation-toggle"
      @click="emit('toggle-navigation')"
    >
      <Menu v-if="props.mobile" class="size-5" aria-hidden="true" />
      <PanelLeftOpen v-else-if="props.sidebarCollapsed" class="size-5" aria-hidden="true" />
      <PanelLeftClose v-else class="size-5" aria-hidden="true" />
    </button>

    <div class="min-w-0 flex-1">
      <GlobalSearch :groups="props.groups" />
    </div>

    <div class="flex shrink-0 items-center gap-1 sm:gap-3">
      <NotificationsMenu
        v-if="props.user && props.notifications"
        :notifications="props.notifications"
        :unread-count="props.unreadNotifications"
        @select="emit('select-notification', $event)"
        @view-all="emit('view-notifications')"
      />
      <UserMenu :user="props.user" @profile="emit('profile')" @sign-out="emit('sign-out')" />
    </div>
  </header>
</template>
