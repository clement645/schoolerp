<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/vue-query';
import { Bell, CheckCheck } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppPagination from '@/components/ui/AppPagination.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import { NOTIFICATIONS_KEY } from '@/composables/useNotifications';
import { errorMessage } from '@/services/http';
import { formatDateTime, safeRedirectPath } from '@/utils/format';
import { notificationsApi, timeAgo, type AppNotification } from './communication.service';

const PAGE_SIZE = 20;

const router = useRouter();
const queryClient = useQueryClient();
const page = ref(1);
const unreadOnly = ref(false);
watch(unreadOnly, () => {
  page.value = 1;
});

const params = computed(() => ({
  page: page.value,
  pageSize: PAGE_SIZE,
  unreadOnly: unreadOnly.value,
}));
const list = useQuery({
  queryKey: [NOTIFICATIONS_KEY, 'all', params],
  queryFn: () => notificationsApi.list(params.value),
  placeholderData: keepPreviousData,
});
const problem = ref<string | null>(null);
const refresh = () => queryClient.invalidateQueries({ queryKey: [NOTIFICATIONS_KEY] });

async function open(notification: AppNotification): Promise<void> {
  problem.value = null;
  try {
    if (!notification.isRead) {
      await notificationsApi.markRead(notification.id);
      await refresh();
    }
    const path = safeRedirectPath(notification.link);
    if (path) await router.push(path);
  } catch (caught) {
    problem.value = errorMessage(caught);
  }
}
const marking = ref(false);
async function markAll(): Promise<void> {
  marking.value = true;
  problem.value = null;
  try {
    await notificationsApi.markAllRead();
    await refresh();
  } catch (caught) {
    problem.value = errorMessage(caught);
  } finally {
    marking.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1>Notifications</h1>
        <p class="text-fg-muted mt-1 text-sm">
          <template v-if="list.data.value"> {{ list.data.value.unread }} unread </template>
          <template v-else>Announcements, messages and results addressed to you.</template>
        </p>
      </div>
      <div class="flex items-center gap-3">
        <label class="flex items-center gap-2 text-sm">
          <input v-model="unreadOnly" type="checkbox" class="accent-primary size-4" />
          Unread only
        </label>
        <AppButton
          variant="secondary"
          :disabled="!list.data.value?.unread"
          :loading="marking"
          @click="markAll"
        >
          <template #icon><CheckCheck class="size-4" aria-hidden="true" /></template>
          Mark all as read
        </AppButton>
      </div>
    </header>

    <AppAlert v-if="problem">{{ problem }}</AppAlert>

    <AppCard flush>
      <p v-if="list.isError.value" class="text-danger p-5 text-sm" role="alert">
        {{ errorMessage(list.error.value) }}
      </p>
      <div v-else-if="!list.data.value" class="space-y-2 p-5" aria-busy="true">
        <AppSkeleton v-for="n in 4" :key="n" height="3rem" />
      </div>
      <AppEmptyState
        v-else-if="list.data.value.items.length === 0"
        :icon="Bell"
        :title="unreadOnly ? 'Nothing unread' : 'No notifications yet'"
        description="Announcements, messages and published results will appear here."
      />
      <ul v-else class="divide-line divide-y">
        <li v-for="notification in list.data.value.items" :key="notification.id">
          <button
            type="button"
            class="hover:bg-surface-muted focus-visible:outline-primary flex w-full gap-3 px-5 py-3.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2"
            @click="open(notification)"
          >
            <span
              class="mt-1.5 size-2 shrink-0 rounded-full"
              :class="notification.isRead ? 'bg-transparent' : 'bg-primary'"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1">
              <span
                class="block text-sm"
                :class="notification.isRead ? 'font-normal' : 'font-semibold'"
              >
                {{ notification.title }}
                <span v-if="!notification.isRead" class="sr-only">(unread)</span>
              </span>
              <span v-if="notification.body" class="text-fg-muted line-clamp-2 text-sm">
                {{ notification.body }}
              </span>
            </span>
            <time
              class="text-fg-muted shrink-0 text-xs"
              :datetime="notification.createdAt"
              :title="formatDateTime(notification.createdAt)"
            >
              {{ timeAgo(notification.createdAt) }}
            </time>
          </button>
        </li>
      </ul>
      <template #footer>
        <AppPagination
          v-model:page="page"
          :page-size="PAGE_SIZE"
          :total="list.data.value?.total ?? 0"
          :disabled="list.isFetching.value"
        />
      </template>
    </AppCard>
  </div>
</template>
