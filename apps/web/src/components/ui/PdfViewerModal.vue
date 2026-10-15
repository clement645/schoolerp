<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { Download, Printer } from '@lucide/vue';
import type { DownloadedFile } from '@/services/http';
import { errorMessage } from '@/services/http';
import { saveBlob } from '@/utils/format';
import AppAlert from './AppAlert.vue';
import AppButton from './AppButton.vue';
import AppModal from './AppModal.vue';
import AppSkeleton from './AppSkeleton.vue';

/**
 * Shows a PDF fetched with the caller's credentials. The document is held as
 * an in-memory object URL — it never has a shareable address — and is released
 * when the dialog closes.
 */
const props = defineProps<{
  title: string;
  description?: string;
  /** Fetches the document; called each time the dialog opens. */
  load: (() => Promise<DownloadedFile>) | null;
}>();
const open = defineModel<boolean>('open', { required: true });

const url = ref<string | null>(null);
const file = ref<DownloadedFile | null>(null);
const error = ref<string | null>(null);
const frame = ref<HTMLIFrameElement | null>(null);
let request = 0;

function release(): void {
  if (url.value) URL.revokeObjectURL(url.value);
  url.value = null;
  file.value = null;
}

watch(
  [open, () => props.load],
  async ([isOpen, load]) => {
    const current = (request += 1);
    release();
    error.value = null;
    if (!isOpen || !load) return;
    try {
      const loaded = await load();
      // A slower, superseded request must not replace a newer document.
      if (current !== request) return;
      file.value = loaded;
      url.value = URL.createObjectURL(
        loaded.blob.type === 'application/pdf'
          ? loaded.blob
          : new Blob([loaded.blob], { type: 'application/pdf' }),
      );
    } catch (caught) {
      if (current === request) error.value = errorMessage(caught);
    }
  },
  { immediate: true },
);
onBeforeUnmount(release);

function download(): void {
  if (file.value) saveBlob(file.value.blob, file.value.filename);
}
function print(): void {
  frame.value?.contentWindow?.focus();
  frame.value?.contentWindow?.print();
}
</script>

<template>
  <AppModal v-model:open="open" size="xl" :title="props.title" :description="props.description">
    <AppAlert v-if="error">{{ error }}</AppAlert>
    <div v-else-if="!url" class="space-y-3" aria-busy="true" aria-label="Preparing the document">
      <AppSkeleton height="2rem" width="40%" />
      <AppSkeleton height="60vh" />
    </div>
    <iframe
      v-else
      ref="frame"
      :src="url"
      :title="props.title"
      class="border-line h-[65vh] w-full rounded-md border"
    />
    <template #footer>
      <AppButton variant="secondary" :disabled="!url" @click="print">
        <template #icon><Printer class="size-4" aria-hidden="true" /></template>
        Print
      </AppButton>
      <AppButton :disabled="!url" @click="download">
        <template #icon><Download class="size-4" aria-hidden="true" /></template>
        Download
      </AppButton>
    </template>
  </AppModal>
</template>
