import { ref, type Ref } from 'vue';
import { errorMessage, type DownloadedFile } from '@/services/http';
import { saveBlob } from '@/utils/format';

/** Fetches a generated file and hands it to the browser to save. */
export function useFileDownload(): {
  pending: Ref<string | null>;
  error: Ref<string | null>;
  download: (key: string, fetch: () => Promise<DownloadedFile>) => Promise<void>;
} {
  // Which download is running, so only its button shows progress.
  const pending = ref<string | null>(null);
  const error = ref<string | null>(null);

  async function download(key: string, fetch: () => Promise<DownloadedFile>): Promise<void> {
    pending.value = key;
    error.value = null;
    try {
      const file = await fetch();
      saveBlob(file.blob, file.filename);
    } catch (caught) {
      error.value = errorMessage(caught);
    } finally {
      pending.value = null;
    }
  }
  return { pending, error, download };
}
