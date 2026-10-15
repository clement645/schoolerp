import { onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';
import { http } from '@/services/http';

/**
 * Loads a private image from the API for use in an `<img>`.
 *
 * Files are served only to authenticated requests, and an `<img src>` cannot
 * send the access token, so the image is fetched here and exposed as a
 * temporary object URL that is released when no longer needed. Pass `null`
 * when there is no image.
 */
export function useAuthorizedImage(path: MaybeRefOrGetter<string | null>): Ref<string | null> {
  const source = ref<string | null>(null);

  function release(): void {
    if (source.value) URL.revokeObjectURL(source.value);
    source.value = null;
  }

  watch(
    () => toValue(path),
    async (current, _previous, onCleanup) => {
      let superseded = false;
      onCleanup(() => {
        superseded = true;
      });
      release();
      if (!current) return;
      try {
        const response = await http.get<Blob>(current, { responseType: 'blob' });
        if (!superseded) source.value = URL.createObjectURL(response.data);
      } catch {
        // A missing or unavailable image falls back to the placeholder.
      }
    },
    { immediate: true },
  );

  onScopeDispose(release);
  return source;
}
