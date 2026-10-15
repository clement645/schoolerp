<script setup lang="ts">
import { ref, watch } from 'vue';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppPagination from '@/components/ui/AppPagination.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppTable from '@/components/ui/AppTable.vue';
import type { TableColumn } from '@/components/ui/table';
import { errorMessage } from '@/services/http';
import { formatDateTime } from '@/utils/format';
import { auditApi, describeAction, isAlertAction, type AuditLog } from './audit.service';

const PAGE_SIZE = 25;

// Values are action-name prefixes understood by the API.
const CATEGORIES = [
  { value: 'all', label: 'All activity' },
  { value: 'auth.', label: 'Sign-in and sessions' },
  { value: 'user.', label: 'User administration' },
  { value: 'student', label: 'Students' },
  { value: 'teacher.', label: 'Teachers' },
  { value: 'examination.', label: 'Examinations' },
  { value: 'marks.', label: 'Marks' },
  { value: 'school.', label: 'School profile' },
  { value: 'academic_year.', label: 'Academic years' },
  { value: 'term.', label: 'Terms' },
  { value: 'class.', label: 'Classes' },
  { value: 'subject.', label: 'Subjects' },
  { value: 'grading_scheme.', label: 'Grading schemes' },
  { value: 'tenant.', label: 'Tenant administration' },
];

const columns: TableColumn[] = [
  { key: 'createdAt', label: 'When' },
  { key: 'action', label: 'Event' },
  { key: 'actor', label: 'By' },
  { key: 'details', label: 'Details' },
  { key: 'ipAddress', label: 'IP address' },
];

const page = ref(1);
const category = ref('all');
watch(category, () => {
  page.value = 1;
});

const logs = useQuery({
  queryKey: ['audit-logs', { page, category }],
  queryFn: () =>
    auditApi.list({
      page: page.value,
      pageSize: PAGE_SIZE,
      action: category.value === 'all' ? undefined : category.value,
    }),
  placeholderData: keepPreviousData,
});

function summarise(details: unknown): string {
  if (details === null || details === undefined) return '';
  return JSON.stringify(details);
}
</script>

<template>
  <div class="space-y-6">
    <header>
      <h1>Audit logs</h1>
      <p class="text-fg-muted mt-1 text-sm">
        A permanent record of sign-ins and administrative changes. Entries cannot be edited or
        removed.
      </p>
    </header>

    <AppCard flush>
      <div class="border-line border-b p-4">
        <div class="max-w-xs">
          <AppSelect v-model="category" :options="CATEGORIES" aria-label="Filter by activity" />
        </div>
      </div>

      <AppTable
        caption="Audit log entries"
        :columns="columns"
        :rows="logs.data.value?.items ?? []"
        :row-key="(entry: AuditLog) => entry.id"
        :loading="logs.isPending.value"
        :error="logs.isError.value ? errorMessage(logs.error.value) : null"
        empty-title="No activity recorded"
        empty-description="Events appear here as people sign in and make changes."
      >
        <template #cell-createdAt="{ row }">
          <span class="whitespace-nowrap tabular-nums">{{ formatDateTime(row.createdAt) }}</span>
        </template>
        <template #cell-action="{ row }">
          <AppBadge :variant="isAlertAction(row.action) ? 'warning' : 'neutral'">
            {{ describeAction(row.action) }}
          </AppBadge>
        </template>
        <template #cell-actor="{ row }">
          <template v-if="row.actor">
            <p class="font-medium">{{ row.actor.name }}</p>
            <p class="text-fg-muted text-xs">{{ row.actor.email }}</p>
          </template>
          <span v-else class="text-fg-muted">
            {{ row.byPlatformStaff ? 'Platform administrator' : 'Unknown' }}
          </span>
        </template>
        <template #cell-details="{ row }">
          <code
            v-if="summarise(row.details)"
            class="text-fg-muted block max-w-md truncate text-xs"
            :title="summarise(row.details)"
          >
            {{ summarise(row.details) }}
          </code>
          <span v-else class="text-fg-muted">—</span>
        </template>
        <template #cell-ipAddress="{ row }">
          <span class="text-fg-muted tabular-nums">{{ row.ipAddress ?? '—' }}</span>
        </template>
        <template #error-action>
          <AppButton size="sm" variant="outline" @click="logs.refetch()">Try again</AppButton>
        </template>
      </AppTable>

      <template #footer>
        <AppPagination
          v-model:page="page"
          :page-size="PAGE_SIZE"
          :total="logs.data.value?.total ?? 0"
          :disabled="logs.isFetching.value"
        />
      </template>
    </AppCard>
  </div>
</template>
