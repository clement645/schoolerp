<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { refDebounced } from '@vueuse/core';
import { ArrowUpRight, Download, Search, Upload, UserPlus } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppPagination from '@/components/ui/AppPagination.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppTable from '@/components/ui/AppTable.vue';
import type { TableColumn, TableSort } from '@/components/ui/table';
import { useClassOptions } from '@/composables/useClassOptions';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import { saveBlob } from '@/utils/format';
import ImportStudentsModal from './ImportStudentsModal.vue';
import PromoteStudentsModal from './PromoteStudentsModal.vue';
import StudentFormModal from './StudentFormModal.vue';
import {
  fullName,
  STATUS_LABELS,
  STATUS_VARIANTS,
  studentsApi,
  type StudentFilters,
  type StudentStatus,
  type StudentSummary,
} from './students.service';

const PAGE_SIZE = 25;
const ALL = 'all';

const auth = useAuthStore();
const canManage = computed(() => auth.can('students:manage'));
// Teachers see only the classes they are assigned to.
const scoped = computed(() => !auth.can('records:all_classes'));

const columns: TableColumn[] = [
  { key: 'name', label: 'Student', sortable: true },
  { key: 'admissionNumber', label: 'Adm. no.', sortable: true },
  { key: 'class', label: 'Class', sortable: true },
  { key: 'gender', label: 'Gender' },
  { key: 'status', label: 'Status' },
];

const STATUS_OPTIONS = [
  { value: ALL, label: 'All statuses' },
  ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

const page = ref(1);
const search = ref('');
const debouncedSearch = refDebounced(search, 300);
const classId = ref(ALL);
const streamId = ref(ALL);
const status = ref<string>('ACTIVE');
const sort = ref<TableSort | null>({ key: 'name', direction: 'asc' });

const selectedClassId = computed(() => (classId.value === ALL ? '' : classId.value));
const { classOptions, streamOptions } = useClassOptions(selectedClassId, { activeOnly: false });
const classFilterOptions = computed(() => [
  { value: ALL, label: 'All classes' },
  ...classOptions.value,
]);
const streamFilterOptions = computed(() => [
  { value: ALL, label: 'All streams' },
  ...streamOptions.value,
]);

watch(classId, () => {
  streamId.value = ALL;
});

const filters = computed<StudentFilters>(() => ({
  search: debouncedSearch.value.trim(),
  classId: classId.value === ALL ? '' : classId.value,
  streamId: streamId.value === ALL ? '' : streamId.value,
  status: status.value === ALL ? '' : (status.value as StudentStatus),
  sort: (sort.value?.key ?? 'name') as StudentFilters['sort'],
  order: sort.value?.direction ?? 'asc',
}));
// Any change to what is being asked for starts again from the first page.
watch(filters, () => {
  page.value = 1;
});

const students = useQuery({
  queryKey: useSchoolQueryKey('students', 'list', filters, page),
  queryFn: () => studentsApi.list({ ...filters.value, page: page.value, pageSize: PAGE_SIZE }),
  placeholderData: keepPreviousData,
});

const filtered = computed(
  () => filters.value.search || filters.value.classId || status.value !== 'ACTIVE',
);

const admitting = ref(false);
const importing = ref(false);
const promoting = ref(false);

const exporting = ref(false);
const exportError = ref<string | null>(null);
async function exportCsv(): Promise<void> {
  exporting.value = true;
  exportError.value = null;
  try {
    const { blob, filename } = await studentsApi.exportCsv(filters.value);
    saveBlob(blob, filename);
  } catch (error) {
    exportError.value = errorMessage(error);
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1>Students</h1>
        <p class="text-fg-muted mt-1 text-sm">
          {{
            scoped
              ? 'Students in the classes you are assigned to this academic year.'
              : 'Everyone enrolled at the school, past and present.'
          }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <AppButton variant="outline" :loading="exporting" @click="exportCsv">
          <template #icon><Download class="size-4" aria-hidden="true" /></template>
          Export
        </AppButton>
        <template v-if="canManage">
          <AppButton variant="outline" @click="importing = true">
            <template #icon><Upload class="size-4" aria-hidden="true" /></template>
            Import
          </AppButton>
          <AppButton variant="outline" @click="promoting = true">
            <template #icon><ArrowUpRight class="size-4" aria-hidden="true" /></template>
            Promote
          </AppButton>
          <AppButton @click="admitting = true">
            <template #icon><UserPlus class="size-4" aria-hidden="true" /></template>
            Admit student
          </AppButton>
        </template>
      </div>
    </header>

    <AppAlert v-if="exportError" data-testid="export-error">{{ exportError }}</AppAlert>

    <AppCard flush>
      <div
        class="border-line grid gap-3 border-b p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]"
      >
        <AppInput
          v-model="search"
          type="search"
          placeholder="Search by name or admission number"
          aria-label="Search students"
        >
          <template #leading><Search class="size-4" aria-hidden="true" /></template>
        </AppInput>
        <AppSelect v-model="classId" :options="classFilterOptions" aria-label="Filter by class" />
        <AppSelect
          v-model="streamId"
          :options="streamFilterOptions"
          :disabled="streamOptions.length === 0"
          aria-label="Filter by stream"
        />
        <AppSelect v-model="status" :options="STATUS_OPTIONS" aria-label="Filter by status" />
      </div>

      <AppTable
        v-model:sort="sort"
        caption="Students"
        :columns="columns"
        :rows="students.data.value?.items ?? []"
        :row-key="(student: StudentSummary) => student.id"
        :loading="students.isPending.value"
        :error="students.isError.value ? errorMessage(students.error.value) : null"
        :empty-title="filtered ? 'No students match these filters' : 'No students yet'"
        :empty-description="
          filtered
            ? 'Try a different search, class or status.'
            : scoped
              ? 'You have no class assignments for the current academic year.'
              : 'Admit your first student, or import a class list.'
        "
      >
        <template #cell-name="{ row }">
          <RouterLink
            :to="{ name: 'student-profile', params: { id: row.id } }"
            class="text-primary focus-visible:outline-primary rounded font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {{ fullName(row) }}
          </RouterLink>
        </template>
        <template #cell-admissionNumber="{ row }">
          <code class="text-fg-muted text-xs">{{ row.admissionNumber }}</code>
        </template>
        <template #cell-class="{ row }">
          <template v-if="row.class">
            {{ row.class.name }}
            <span v-if="row.stream" class="text-fg-muted">{{ row.stream.name }}</span>
          </template>
          <span v-else class="text-fg-muted">—</span>
        </template>
        <template #cell-gender="{ row }">
          <span class="text-fg-muted">{{
            row.gender === 'OTHER' ? 'Other' : row.gender === 'MALE' ? 'Male' : 'Female'
          }}</span>
        </template>
        <template #cell-status="{ row }">
          <AppBadge :variant="STATUS_VARIANTS[row.status]" dot>
            {{ STATUS_LABELS[row.status] }}
          </AppBadge>
        </template>
        <template #error-action>
          <AppButton size="sm" variant="outline" @click="students.refetch()">Try again</AppButton>
        </template>
      </AppTable>

      <template #footer>
        <AppPagination
          v-model:page="page"
          :page-size="PAGE_SIZE"
          :total="students.data.value?.total ?? 0"
          :disabled="students.isFetching.value"
        />
      </template>
    </AppCard>

    <template v-if="canManage">
      <StudentFormModal v-model:open="admitting" :student="null" />
      <ImportStudentsModal v-model:open="importing" />
      <PromoteStudentsModal v-model:open="promoting" />
    </template>
  </div>
</template>
