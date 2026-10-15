<script setup lang="ts">
import { ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { Download, FileText, Plus } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { formatDateTime, saveBlob } from '@/utils/format';
import {
  DOCUMENT_CATEGORIES,
  formatFileSize,
  studentsApi,
  type StudentDocument,
} from './students.service';

const props = defineProps<{ studentId: string; canManage: boolean }>();

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png'];

const documents = useQuery({
  queryKey: useSchoolQueryKey('students', 'documents', () => props.studentId),
  queryFn: () => studentsApi.listDocuments(props.studentId),
});

const categoryLabel = (value: string) =>
  DOCUMENT_CATEGORIES.find((category) => category.value === value)?.label ?? value;

// ── Upload ───────────────────────────────────────────────────────────────────
const uploading = ref(false);
const title = ref('');
const category = ref('BIRTH_CERTIFICATE');
const file = ref<File | null>(null);
const problem = ref<string | null>(null);

const upload = useSaveAction(async () => {
  if (!file.value) return;
  await studentsApi.uploadDocument(props.studentId, {
    title: title.value.trim(),
    category: category.value,
    file: file.value,
  });
});

watch(uploading, (isOpen) => {
  if (!isOpen) return;
  upload.reset();
  problem.value = null;
  title.value = '';
  category.value = 'BIRTH_CERTIFICATE';
  file.value = null;
});

function choose(event: Event): void {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null;
  problem.value = null;
}

async function submit(): Promise<void> {
  problem.value = null;
  if (title.value.trim().length < 2) problem.value = 'Give the document a title.';
  else if (!file.value) problem.value = 'Choose a file to upload.';
  else if (!ACCEPTED.includes(file.value.type)) problem.value = 'Upload a PDF, JPEG or PNG file.';
  else if (file.value.size > MAX_BYTES) problem.value = 'The file must be 5 MB or smaller.';
  if (problem.value) return;
  if (await upload.run()) uploading.value = false;
}

// ── Download and delete ──────────────────────────────────────────────────────
const downloadError = ref<string | null>(null);
const downloadingId = ref<string | null>(null);
async function download(document: StudentDocument): Promise<void> {
  downloadError.value = null;
  downloadingId.value = document.id;
  try {
    saveBlob(await studentsApi.downloadDocument(props.studentId, document.id), document.fileName);
  } catch (error) {
    downloadError.value = errorMessage(error);
  } finally {
    downloadingId.value = null;
  }
}

const deleting = ref<StudentDocument | null>(null);
const remove = useSaveAction((document: StudentDocument) =>
  studentsApi.deleteDocument(props.studentId, document.id),
);
function askToDelete(document: StudentDocument): void {
  remove.reset();
  deleting.value = document;
}
async function confirmDelete(): Promise<void> {
  if (deleting.value && (await remove.run(deleting.value))) deleting.value = null;
}
</script>

<template>
  <AppCard
    title="Documents"
    subtitle="Private to administrators. Every download is recorded in the audit log."
    flush
  >
    <template v-if="props.canManage" #actions>
      <AppButton size="sm" @click="uploading = true">
        <template #icon><Plus class="size-3.5" aria-hidden="true" /></template>
        Add document
      </AppButton>
    </template>

    <AppAlert v-if="downloadError" class="m-4">{{ downloadError }}</AppAlert>

    <div v-if="documents.isPending.value" class="space-y-3 p-5" aria-busy="true">
      <AppSkeleton v-for="n in 2" :key="n" height="2.5rem" />
    </div>
    <AppAlert v-else-if="documents.isError.value" class="m-4">
      {{ errorMessage(documents.error.value) }}
    </AppAlert>
    <AppEmptyState
      v-else-if="documents.data.value?.length === 0"
      :icon="FileText"
      title="No documents on file"
      description="Keep birth certificates, medical notes and transfer letters with the record."
    />
    <ul v-else class="divide-line divide-y">
      <li
        v-for="document in documents.data.value"
        :key="document.id"
        class="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
      >
        <div class="flex min-w-0 items-start gap-3">
          <FileText class="text-fg-muted mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div class="min-w-0 text-sm">
            <p class="flex flex-wrap items-center gap-2 font-medium">
              {{ document.title }}
              <AppBadge>{{ categoryLabel(document.category) }}</AppBadge>
            </p>
            <p class="text-fg-muted mt-0.5 truncate text-xs">
              {{ document.fileName }} · {{ formatFileSize(document.sizeBytes) }} · added
              {{ formatDateTime(document.createdAt) }}
              <template v-if="document.uploadedBy"> by {{ document.uploadedBy }}</template>
            </p>
          </div>
        </div>
        <div class="flex gap-2">
          <AppButton
            variant="outline"
            size="sm"
            :loading="downloadingId === document.id"
            :aria-label="`Download ${document.title}`"
            @click="download(document)"
          >
            <template #icon><Download class="size-3.5" aria-hidden="true" /></template>
            Download
          </AppButton>
          <AppButton
            v-if="props.canManage"
            variant="ghost"
            size="sm"
            :aria-label="`Delete ${document.title}`"
            @click="askToDelete(document)"
          >
            Delete
          </AppButton>
        </div>
      </li>
    </ul>

    <template v-if="props.canManage">
      <AppModal v-model:open="uploading" title="Add document" :dismissible="!upload.pending.value">
        <form id="document-form" class="space-y-4" novalidate @submit.prevent="submit">
          <AppAlert v-if="problem || upload.error.value" data-testid="document-form-error">
            {{ problem ?? upload.error.value }}
          </AppAlert>
          <AppInput
            v-model="title"
            label="Title"
            placeholder="e.g. Birth certificate"
            autocomplete="off"
            data-autofocus
            required
          />
          <AppSelect v-model="category" :options="DOCUMENT_CATEGORIES" label="Category" required />
          <div>
            <label for="document-file" class="mb-1.5 block text-sm font-medium">
              File <span class="text-danger" aria-hidden="true">*</span>
            </label>
            <input
              id="document-file"
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              class="text-fg-muted file:border-line file:bg-surface file:text-fg hover:file:bg-surface-muted file:rounded-control block w-full text-sm file:mr-3 file:h-9 file:cursor-pointer file:border file:px-3 file:text-sm file:font-medium"
              data-testid="document-file"
              @change="choose"
            />
            <p class="text-fg-muted mt-1.5 text-xs">PDF, JPEG or PNG, up to 5 MB.</p>
          </div>
        </form>
        <template #footer>
          <AppButton variant="outline" :disabled="upload.pending.value" @click="uploading = false">
            Cancel
          </AppButton>
          <AppButton type="submit" form="document-form" :loading="upload.pending.value">
            Upload
          </AppButton>
        </template>
      </AppModal>

      <AppConfirmDialog
        :open="deleting !== null"
        title="Delete document?"
        confirm-label="Delete"
        tone="danger"
        :loading="remove.pending.value"
        :error="remove.error.value"
        @confirm="confirmDelete"
        @cancel="deleting = null"
      >
        <strong>{{ deleting?.title }}</strong> will be permanently deleted. This cannot be undone.
      </AppConfirmDialog>
    </template>
  </AppCard>
</template>
