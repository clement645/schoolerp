<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { refDebounced } from '@vueuse/core';
import { Search, UserPlus } from '@lucide/vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppPagination from '@/components/ui/AppPagination.vue';
import AppTable from '@/components/ui/AppTable.vue';
import type { TableColumn } from '@/components/ui/table';
import { errorMessage } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import { formatDateTime } from '@/utils/format';
import CreateUserModal from './CreateUserModal.vue';
import ManageUserModal from './ManageUserModal.vue';
import { usersApi, type User } from './users.service';

const PAGE_SIZE = 20;

const auth = useAuthStore();
const canManage = computed(() => auth.can('users:manage'));

const page = ref(1);
const search = ref('');
const debouncedSearch = refDebounced(search, 300);
watch(debouncedSearch, () => {
  page.value = 1;
});

const users = useQuery({
  queryKey: ['users', { page, search: debouncedSearch }],
  queryFn: () =>
    usersApi.list({ page: page.value, pageSize: PAGE_SIZE, search: debouncedSearch.value.trim() }),
  placeholderData: keepPreviousData,
});

const roles = useQuery({
  queryKey: ['roles'],
  queryFn: usersApi.listRoles,
  enabled: canManage,
  staleTime: 5 * 60_000,
});
// The platform role is never assignable from a school account.
const assignableRoles = computed(() =>
  (roles.data.value ?? []).filter((role) => role.key !== 'SUPER_ADMIN'),
);

const columns = computed<TableColumn[]>(() => [
  { key: 'name', label: 'User' },
  { key: 'roles', label: 'Roles' },
  { key: 'status', label: 'Status' },
  { key: 'lastLoginAt', label: 'Last sign-in' },
  ...(canManage.value ? [{ key: 'actions', label: '', align: 'right' as const }] : []),
]);

const creating = ref(false);
const managing = ref<User | null>(null);
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1>Users &amp; Roles</h1>
        <p class="text-fg-muted mt-1 text-sm">
          Manage who can sign in to your school account and what they can do.
        </p>
      </div>
      <AppButton v-if="canManage" :disabled="!roles.data.value" @click="creating = true">
        <template #icon><UserPlus class="size-4" aria-hidden="true" /></template>
        Add user
      </AppButton>
    </header>

    <AppCard flush>
      <div class="border-line border-b p-4">
        <div class="max-w-sm">
          <AppInput
            v-model="search"
            type="search"
            placeholder="Search by name or email"
            aria-label="Search users"
          >
            <template #leading><Search class="size-4" aria-hidden="true" /></template>
          </AppInput>
        </div>
      </div>

      <AppTable
        caption="Users"
        :columns="columns"
        :rows="users.data.value?.items ?? []"
        :row-key="(user: User) => user.id"
        :loading="users.isPending.value"
        :error="users.isError.value ? errorMessage(users.error.value) : null"
        :empty-title="debouncedSearch ? 'No users match your search' : 'No users yet'"
        :empty-description="debouncedSearch ? 'Try a different name or email address.' : undefined"
      >
        <template #cell-name="{ row }">
          <p class="font-medium">{{ row.firstName }} {{ row.lastName }}</p>
          <p class="text-fg-muted text-xs">{{ row.email }}</p>
        </template>
        <template #cell-roles="{ row }">
          <div class="flex max-w-xs flex-wrap gap-1">
            <AppBadge v-for="role in row.roles" :key="role.key" variant="primary">
              {{ role.name }}
            </AppBadge>
          </div>
        </template>
        <template #cell-status="{ row }">
          <AppBadge :variant="row.status === 'ACTIVE' ? 'success' : 'neutral'" dot>
            {{ row.status === 'ACTIVE' ? 'Active' : 'Disabled' }}
          </AppBadge>
        </template>
        <template #cell-lastLoginAt="{ row }">
          <span class="text-fg-muted whitespace-nowrap">
            {{ row.lastLoginAt ? formatDateTime(row.lastLoginAt) : 'Never' }}
          </span>
        </template>
        <template #cell-actions="{ row }">
          <AppButton
            variant="outline"
            size="sm"
            :aria-label="`Manage ${row.firstName} ${row.lastName}`"
            @click="managing = row"
          >
            Manage
          </AppButton>
        </template>
        <template #error-action>
          <AppButton size="sm" variant="outline" @click="users.refetch()">Try again</AppButton>
        </template>
      </AppTable>

      <template #footer>
        <AppPagination
          v-model:page="page"
          :page-size="PAGE_SIZE"
          :total="users.data.value?.total ?? 0"
          :disabled="users.isFetching.value"
        />
      </template>
    </AppCard>

    <template v-if="canManage">
      <CreateUserModal v-model:open="creating" :available-roles="assignableRoles" />
      <ManageUserModal
        :user="managing"
        :available-roles="assignableRoles"
        :current-user-id="auth.user?.id ?? null"
        @close="managing = null"
      />
    </template>
  </div>
</template>
