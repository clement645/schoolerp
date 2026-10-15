<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { refDebounced } from '@vueuse/core';
import { Search, UserPlus } from '@lucide/vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppPagination from '@/components/ui/AppPagination.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppTable from '@/components/ui/AppTable.vue';
import AppTabs from '@/components/ui/AppTabs.vue';
import type { TableColumn } from '@/components/ui/table';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import TeacherFormModal from './TeacherFormModal.vue';
import {
  teachersApi,
  type TeacherDetail,
  type TeacherSummary,
  type Workload,
} from './teachers.service';

const PAGE_SIZE = 25;
const ALL = 'all';
const TABS = [
  { id: 'directory', label: 'Directory' },
  { id: 'workload', label: 'Workload' },
];
const STATUS_OPTIONS = [
  { value: ALL, label: 'All staff' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];

const auth = useAuthStore();
const router = useRouter();
const canManage = computed(() => auth.can('teachers:manage'));

const tab = ref('directory');
const page = ref(1);
const search = ref('');
const debouncedSearch = refDebounced(search, 300);
const status = ref('ACTIVE');
watch([debouncedSearch, status], () => {
  page.value = 1;
});

const teachers = useQuery({
  queryKey: useSchoolQueryKey('teachers', 'list', debouncedSearch, status, page),
  queryFn: () =>
    teachersApi.list({
      page: page.value,
      pageSize: PAGE_SIZE,
      search: debouncedSearch.value.trim(),
      status: status.value === ALL ? '' : status.value,
    }),
  placeholderData: keepPreviousData,
});

const workload = useQuery({
  queryKey: useSchoolQueryKey('teachers', 'workload'),
  queryFn: teachersApi.workload,
  enabled: computed(() => tab.value === 'workload'),
});

const columns: TableColumn[] = [
  { key: 'name', label: 'Teacher' },
  { key: 'staffNumber', label: 'Staff no.' },
  { key: 'phone', label: 'Phone' },
  { key: 'account', label: 'Login account' },
  { key: 'status', label: 'Status' },
];
const workloadColumns: TableColumn[] = [
  { key: 'teacher', label: 'Teacher' },
  { key: 'teachingAssignments', label: 'Teaching assignments', align: 'right' },
  { key: 'subjects', label: 'Subjects' },
  { key: 'classes', label: 'Classes taught' },
  { key: 'classTeacherOf', label: 'Class teacher of' },
];
type WorkloadRow = Workload['rows'][number];

const adding = ref(false);
function opened(teacher: TeacherDetail): void {
  void router.push({ name: 'teacher-profile', params: { id: teacher.id } });
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1>Teachers</h1>
        <p class="text-fg-muted mt-1 text-sm">
          Teaching staff, the subjects and classes they are responsible for.
        </p>
      </div>
      <AppButton v-if="canManage" @click="adding = true">
        <template #icon><UserPlus class="size-4" aria-hidden="true" /></template>
        Add teacher
      </AppButton>
    </header>

    <AppTabs v-model="tab" :tabs="TABS" label="Teacher sections" />

    <section :id="`panel-${tab}`" role="tabpanel" :aria-labelledby="`tab-${tab}`">
      <AppCard v-if="tab === 'directory'" flush>
        <div
          class="border-line grid gap-3 border-b p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:max-w-2xl"
        >
          <AppInput
            v-model="search"
            type="search"
            placeholder="Search by name or staff number"
            aria-label="Search teachers"
          >
            <template #leading><Search class="size-4" aria-hidden="true" /></template>
          </AppInput>
          <AppSelect v-model="status" :options="STATUS_OPTIONS" aria-label="Filter by status" />
        </div>

        <AppTable
          caption="Teachers"
          :columns="columns"
          :rows="teachers.data.value?.items ?? []"
          :row-key="(teacher: TeacherSummary) => teacher.id"
          :loading="teachers.isPending.value"
          :error="teachers.isError.value ? errorMessage(teachers.error.value) : null"
          :empty-title="
            debouncedSearch || status !== 'ACTIVE' ? 'No teachers match' : 'No teachers yet'
          "
          :empty-description="
            debouncedSearch || status !== 'ACTIVE'
              ? undefined
              : 'Add your teaching staff to assign them classes.'
          "
        >
          <template #cell-name="{ row }">
            <RouterLink
              :to="{ name: 'teacher-profile', params: { id: row.id } }"
              class="text-primary focus-visible:outline-primary rounded font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {{ row.firstName }} {{ row.lastName }}
            </RouterLink>
          </template>
          <template #cell-staffNumber="{ row }">
            <code class="text-fg-muted text-xs">{{ row.staffNumber }}</code>
          </template>
          <template #cell-account="{ row }">
            <span v-if="row.user" class="text-fg-muted">{{ row.user.email }}</span>
            <AppBadge v-else>Not linked</AppBadge>
          </template>
          <template #cell-status="{ row }">
            <AppBadge :variant="row.status === 'ACTIVE' ? 'success' : 'neutral'" dot>
              {{ row.status === 'ACTIVE' ? 'Active' : 'Inactive' }}
            </AppBadge>
          </template>
          <template #error-action>
            <AppButton size="sm" variant="outline" @click="teachers.refetch()">Try again</AppButton>
          </template>
        </AppTable>

        <template #footer>
          <AppPagination
            v-model:page="page"
            :page-size="PAGE_SIZE"
            :total="teachers.data.value?.total ?? 0"
            :disabled="teachers.isFetching.value"
          />
        </template>
      </AppCard>

      <AppCard
        v-else
        title="Workload"
        :subtitle="
          workload.data.value?.academicYear
            ? `Responsibilities of active teachers in ${workload.data.value.academicYear.name}.`
            : 'Responsibilities of active teachers in the current academic year.'
        "
        flush
      >
        <AppTable
          caption="Teacher workload"
          :columns="workloadColumns"
          :rows="workload.data.value?.rows ?? []"
          :row-key="(row: WorkloadRow) => row.teacher.id"
          :loading="workload.isPending.value"
          :error="workload.isError.value ? errorMessage(workload.error.value) : null"
          :empty-title="
            workload.data.value && !workload.data.value.academicYear
              ? 'No current academic year'
              : 'No active teachers'
          "
          :empty-description="
            workload.data.value && !workload.data.value.academicYear
              ? 'Set the current academic year in School Settings.'
              : undefined
          "
        >
          <template #cell-teacher="{ row }">
            <RouterLink
              :to="{ name: 'teacher-profile', params: { id: row.teacher.id } }"
              class="text-primary rounded font-medium hover:underline"
            >
              {{ row.teacher.name }}
            </RouterLink>
          </template>
          <template #cell-teachingAssignments="{ row }">
            <span class="tabular-nums" :class="{ 'text-fg-muted': row.teachingAssignments === 0 }">
              {{ row.teachingAssignments }}
            </span>
          </template>
          <template #cell-subjects="{ row }">{{ row.subjects.join(', ') || '—' }}</template>
          <template #cell-classes="{ row }">{{ row.classes.join(', ') || '—' }}</template>
          <template #cell-classTeacherOf="{ row }">
            <div v-if="row.classTeacherOf.length" class="flex flex-wrap gap-1">
              <AppBadge v-for="label in row.classTeacherOf" :key="label" variant="primary">
                {{ label }}
              </AppBadge>
            </div>
            <span v-else class="text-fg-muted">—</span>
          </template>
          <template #error-action>
            <AppButton size="sm" variant="outline" @click="workload.refetch()">Try again</AppButton>
          </template>
        </AppTable>
      </AppCard>
    </section>

    <TeacherFormModal v-if="canManage" v-model:open="adding" :teacher="null" @saved="opened" />
  </div>
</template>
