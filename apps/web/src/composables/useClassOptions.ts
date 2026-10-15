import { useQuery } from '@tanstack/vue-query';
import { computed, type Ref } from 'vue';
import { classesApi } from '@/features/classes/classes.service';
import { useSchoolQueryKey } from './useSchoolQueryKey';

/**
 * Class and stream choices for select boxes. Streams follow the chosen class.
 */
export function useClassOptions(selectedClassId: Ref<string>, options = { activeOnly: true }) {
  const classes = useQuery({ queryKey: useSchoolQueryKey('classes'), queryFn: classesApi.list });

  const available = computed(() =>
    (classes.data.value ?? []).filter((entry) => !options.activeOnly || entry.isActive),
  );
  const classOptions = computed(() =>
    available.value.map((entry) => ({ value: entry.id, label: entry.name })),
  );
  const selectedClass = computed(
    () => (classes.data.value ?? []).find((entry) => entry.id === selectedClassId.value) ?? null,
  );
  const streamOptions = computed(() =>
    (selectedClass.value?.streams ?? []).map((stream) => ({
      value: stream.id,
      label: stream.name,
    })),
  );

  return { classes, classOptions, selectedClass, streamOptions };
}
