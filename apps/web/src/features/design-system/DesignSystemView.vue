<!--
  Development-only component gallery (route is registered only when
  import.meta.env.DEV). The rows below are illustrative fixtures for exercising
  component states; they are never bundled into a production build.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { Plus, Search, Users } from '@lucide/vue';
import AppBadge, { type BadgeVariant } from '@/components/ui/AppBadge.vue';
import AppButton, { type ButtonVariant } from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppPagination from '@/components/ui/AppPagination.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import AppTable from '@/components/ui/AppTable.vue';
import type { TableColumn, TableSort } from '@/components/ui/table';

const SWATCHES = [
  { name: 'primary', class: 'bg-primary' },
  { name: 'primary-dark', class: 'bg-primary-dark' },
  { name: 'primary-light', class: 'bg-primary-light' },
  { name: 'background', class: 'bg-background' },
  { name: 'surface', class: 'bg-surface' },
  { name: 'fg', class: 'bg-fg' },
  { name: 'fg-muted', class: 'bg-fg-muted' },
  { name: 'line', class: 'bg-line' },
  { name: 'success', class: 'bg-success' },
  { name: 'warning', class: 'bg-warning' },
  { name: 'danger', class: 'bg-danger' },
  { name: 'info', class: 'bg-info' },
];

const BUTTON_VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'outline', 'ghost', 'danger'];
const BADGE_VARIANTS: BadgeVariant[] = [
  'neutral',
  'primary',
  'success',
  'warning',
  'danger',
  'info',
];

const name = ref('');
const search = ref('');
const classId = ref('');
const classOptions = [
  { value: 'g7', label: 'Grade 7' },
  { value: 'g8', label: 'Grade 8' },
  { value: 'g9', label: 'Grade 9', disabled: true },
];

interface DemoRow {
  id: number;
  student: string;
  className: string;
  mean: number | null;
  status: 'Active' | 'Pending';
}

const columns: TableColumn[] = [
  { key: 'student', label: 'Student', sortable: true },
  { key: 'className', label: 'Class' },
  { key: 'mean', label: 'Mean score', align: 'right', sortable: true },
  { key: 'status', label: 'Status' },
];

const allRows: DemoRow[] = Array.from({ length: 23 }, (_, index) => ({
  id: index + 1,
  student: `Demo Student ${String(index + 1).padStart(2, '0')}`,
  className: index % 2 === 0 ? 'Grade 7 A' : 'Grade 8 B',
  mean: index % 6 === 5 ? null : 48 + ((index * 7) % 45),
  status: index % 4 === 3 ? 'Pending' : 'Active',
}));

type TableState = 'data' | 'loading' | 'empty' | 'error';
const tableState = ref<TableState>('data');
const TABLE_STATES: TableState[] = ['data', 'loading', 'empty', 'error'];

const page = ref(1);
const pageSize = 5;
const sort = ref<TableSort | null>(null);

const sortedRows = computed(() => {
  const active = sort.value;
  if (!active) return allRows;
  const factor = active.direction === 'asc' ? 1 : -1;
  return [...allRows].sort((a, b) => {
    const left = Reflect.get(a, active.key) as string | number | null;
    const right = Reflect.get(b, active.key) as string | number | null;
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return left > right ? factor : -factor;
  });
});

const visibleRows = computed(() =>
  tableState.value === 'empty'
    ? []
    : sortedRows.value.slice((page.value - 1) * pageSize, page.value * pageSize),
);

const modalOpen = ref(false);
const loadingDemo = ref(false);

function simulateSave(): void {
  loadingDemo.value = true;
  window.setTimeout(() => {
    loadingDemo.value = false;
  }, 1200);
}
</script>

<template>
  <div class="space-y-6">
    <header>
      <h1>Design system</h1>
      <p class="text-fg-muted mt-1 text-sm">
        Development-only gallery of the shared UI components and tokens.
      </p>
    </header>

    <AppCard title="Colours" subtitle="Tokens defined in styles/main.css">
      <ul class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <li v-for="swatch in SWATCHES" :key="swatch.name">
          <span class="border-line rounded-control block h-12 border" :class="swatch.class" />
          <span class="text-fg-muted mt-1.5 block text-xs">{{ swatch.name }}</span>
        </li>
      </ul>
    </AppCard>

    <AppCard title="Typography" subtitle="Inter, with a compact dashboard scale">
      <div class="space-y-3">
        <h1>Heading 1 — Examination Management</h1>
        <h2>Heading 2 — Marks Compilation</h2>
        <h3>Heading 3 — Recent Fee Payments</h3>
        <p class="text-sm">Body — Create examinations, enter marks, and compile results.</p>
        <p class="text-fg-muted text-sm">Muted — Term 3, 2026</p>
        <p class="text-fg-muted text-xs font-semibold tracking-wide uppercase">Overline label</p>
      </div>
    </AppCard>

    <AppCard title="Buttons">
      <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-3">
          <AppButton v-for="variant in BUTTON_VARIANTS" :key="variant" :variant="variant">
            {{ variant }}
          </AppButton>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <AppButton size="sm">Small</AppButton>
          <AppButton size="md">Medium</AppButton>
          <AppButton size="lg">Large</AppButton>
          <AppButton>
            <template #icon><Plus class="size-4" aria-hidden="true" /></template>
            Create Exam
          </AppButton>
          <AppButton disabled>Disabled</AppButton>
          <AppButton :loading="loadingDemo" @click="simulateSave">Click to load</AppButton>
        </div>
      </div>
    </AppCard>

    <AppCard title="Badges">
      <div class="flex flex-wrap items-center gap-3">
        <AppBadge v-for="variant in BADGE_VARIANTS" :key="variant" :variant="variant">
          {{ variant }}
        </AppBadge>
        <AppBadge variant="success" dot>Published</AppBadge>
        <AppBadge variant="warning" dot>Awaiting approval</AppBadge>
      </div>
    </AppCard>

    <AppCard title="Form controls">
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AppInput v-model="name" label="First name" placeholder="e.g. Amina" required />
        <AppInput v-model="search" type="search" label="With leading icon" placeholder="Search…">
          <template #leading><Search class="size-4" aria-hidden="true" /></template>
        </AppInput>
        <AppInput label="With hint" hint="Shown on report cards." />
        <AppInput label="With error" model-value="12" error="Marks cannot exceed 10." />
        <AppInput label="Disabled" model-value="ADM-0001" disabled />
        <AppSelect
          v-model="classId"
          :options="classOptions"
          label="Class"
          placeholder="Select class"
        />
        <AppSelect
          :options="classOptions"
          label="Select with error"
          placeholder="Select class"
          error="Class is required."
        />
      </div>
    </AppCard>

    <AppCard title="Table" subtitle="Sorting, pagination and data states" flush>
      <template #actions>
        <AppButton
          v-for="state in TABLE_STATES"
          :key="state"
          size="sm"
          :variant="tableState === state ? 'primary' : 'outline'"
          @click="tableState = state"
        >
          {{ state }}
        </AppButton>
      </template>

      <AppTable
        v-model:sort="sort"
        caption="Demo students"
        :columns="columns"
        :rows="visibleRows"
        :row-key="(row: DemoRow) => row.id"
        :loading="tableState === 'loading'"
        :error="tableState === 'error' ? 'The server could not be reached.' : null"
        empty-title="No students found"
        empty-description="Students appear here once they are registered."
      >
        <template #cell-student="{ row }">
          <span class="font-medium">{{ row.student }}</span>
        </template>
        <template #cell-status="{ row }">
          <AppBadge :variant="row.status === 'Active' ? 'success' : 'warning'" dot>
            {{ row.status }}
          </AppBadge>
        </template>
        <template #error-action>
          <AppButton size="sm" variant="outline" @click="tableState = 'data'">Try again</AppButton>
        </template>
      </AppTable>

      <template #footer>
        <AppPagination
          v-model:page="page"
          :page-size="pageSize"
          :total="tableState === 'data' ? allRows.length : 0"
          :disabled="tableState !== 'data'"
        />
      </template>
    </AppCard>

    <div class="grid gap-6 lg:grid-cols-2">
      <AppCard title="Loading skeletons">
        <div class="flex items-center gap-4">
          <AppSkeleton circle width="3rem" height="3rem" />
          <div class="flex-1 space-y-2">
            <AppSkeleton width="50%" />
            <AppSkeleton width="80%" height="0.75rem" />
          </div>
        </div>
      </AppCard>

      <AppCard title="Empty state">
        <AppEmptyState
          :icon="Users"
          title="No teachers yet"
          description="Add your first teacher to start assigning classes."
        >
          <AppButton size="sm">Add teacher</AppButton>
        </AppEmptyState>
      </AppCard>
    </div>

    <AppCard title="Modal">
      <AppButton @click="modalOpen = true">Open modal</AppButton>
      <AppModal
        v-model:open="modalOpen"
        title="Create exam"
        description="Focus is trapped inside the dialog; Escape closes it."
      >
        <div class="space-y-4">
          <AppInput label="Examination name" placeholder="End Term Exam" required />
          <AppSelect :options="classOptions" label="Class" placeholder="Select class" />
        </div>
        <template #footer="{ close }">
          <AppButton variant="outline" @click="close">Cancel</AppButton>
          <AppButton @click="close">Create</AppButton>
        </template>
      </AppModal>
    </AppCard>
  </div>
</template>
