<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { Plus } from '@lucide/vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue';
import AppTable from '@/components/ui/AppTable.vue';
import type { TableColumn } from '@/components/ui/table';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import SubjectFormModal from './SubjectFormModal.vue';
import { subjectsApi, type Subject } from './subjects.service';

const auth = useAuthStore();
const canManage = computed(() => auth.can('subjects:manage'));

const subjects = useQuery({ queryKey: useSchoolQueryKey('subjects'), queryFn: subjectsApi.list });

const columns = computed<TableColumn[]>(() => [
  { key: 'name', label: 'Subject' },
  { key: 'code', label: 'Code' },
  { key: 'classCount', label: 'Classes', align: 'right' },
  { key: 'isActive', label: 'Status' },
  ...(canManage.value ? [{ key: 'actions', label: '', align: 'right' as const }] : []),
]);

const formOpen = ref(false);
const editing = ref<Subject | null>(null);
const deleting = ref<Subject | null>(null);

function openForm(subject: Subject | null): void {
  editing.value = subject;
  formOpen.value = true;
}

const remove = useSaveAction((subject: Subject) => subjectsApi.delete(subject.id));

function askToDelete(subject: Subject): void {
  remove.reset();
  deleting.value = subject;
}

async function confirmDelete(): Promise<void> {
  if (deleting.value && (await remove.run(deleting.value))) deleting.value = null;
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1>Subjects</h1>
        <p class="text-fg-muted mt-1 text-sm">
          The subjects your school teaches. Assign them to classes on the Classes page.
        </p>
      </div>
      <AppButton v-if="canManage" @click="openForm(null)">
        <template #icon><Plus class="size-4" aria-hidden="true" /></template>
        Add subject
      </AppButton>
    </header>

    <AppCard flush>
      <AppTable
        caption="Subjects"
        :columns="columns"
        :rows="subjects.data.value ?? []"
        :row-key="(subject: Subject) => subject.id"
        :loading="subjects.isPending.value"
        :error="subjects.isError.value ? errorMessage(subjects.error.value) : null"
        empty-title="No subjects yet"
        :empty-description="canManage ? 'Add the subjects your school teaches.' : undefined"
      >
        <template #cell-name="{ row }">
          <span class="font-medium">{{ row.name }}</span>
        </template>
        <template #cell-code="{ row }">
          <code class="text-fg-muted text-xs">{{ row.code }}</code>
        </template>
        <template #cell-isActive="{ row }">
          <AppBadge :variant="row.isActive ? 'success' : 'neutral'" dot>
            {{ row.isActive ? 'Active' : 'Inactive' }}
          </AppBadge>
        </template>
        <template #cell-actions="{ row }">
          <div class="flex justify-end gap-2">
            <AppButton
              variant="outline"
              size="sm"
              :aria-label="`Edit ${row.name}`"
              @click="openForm(row)"
            >
              Edit
            </AppButton>
            <AppButton
              variant="ghost"
              size="sm"
              :aria-label="`Delete ${row.name}`"
              @click="askToDelete(row)"
            >
              Delete
            </AppButton>
          </div>
        </template>
        <template #error-action>
          <AppButton size="sm" variant="outline" @click="subjects.refetch()">Try again</AppButton>
        </template>
      </AppTable>
    </AppCard>

    <template v-if="canManage">
      <SubjectFormModal v-model:open="formOpen" :subject="editing" />
      <AppConfirmDialog
        :open="deleting !== null"
        title="Delete subject?"
        confirm-label="Delete"
        tone="danger"
        :loading="remove.pending.value"
        :error="remove.error.value"
        @confirm="confirmDelete"
        @cancel="deleting = null"
      >
        <strong>{{ deleting?.name }}</strong> will be removed. A subject that is taught in a class
        cannot be deleted — mark it inactive instead.
      </AppConfirmDialog>
    </template>
  </div>
</template>
