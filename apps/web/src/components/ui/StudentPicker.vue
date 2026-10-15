<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { refDebounced } from '@vueuse/core';
import { Search, X } from '@lucide/vue';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { studentsApi } from '@/features/students/students.service';

export interface PickedStudent {
  id: string;
  name: string;
  admissionNumber: string;
  class: string | null;
}

const props = withDefaults(
  defineProps<{ label?: string; error?: string; required?: boolean; disabled?: boolean }>(),
  { label: 'Learner' },
);
const picked = defineModel<PickedStudent | null>({ default: null });

const inputId = useId();
const listId = useId();
const term = ref('');
const open = ref(false);
const active = ref(0);
const debounced = refDebounced(term, 250);
const searching = computed(() => debounced.value.trim().length >= 2);

const results = useQuery({
  queryKey: useSchoolQueryKey('students', 'picker', debounced),
  queryFn: () => studentsApi.list({ search: debounced.value.trim(), page: 1, pageSize: 8 }),
  enabled: searching,
});
const options = computed<PickedStudent[]>(() =>
  (results.data.value?.items ?? []).map((student) => ({
    id: student.id,
    name: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' '),
    admissionNumber: student.admissionNumber,
    class: student.class?.name ?? null,
  })),
);
watch(options, () => {
  active.value = 0;
});

function choose(student: PickedStudent): void {
  picked.value = student;
  term.value = '';
  open.value = false;
}
function onKeydown(event: KeyboardEvent): void {
  if (!open.value || options.value.length === 0) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    active.value = (active.value + 1) % options.value.length;
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    active.value = (active.value - 1 + options.value.length) % options.value.length;
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const student = options.value[active.value];
    if (student) choose(student);
  } else if (event.key === 'Escape') {
    event.stopPropagation();
    open.value = false;
  }
}
</script>

<template>
  <div>
    <label :for="inputId" class="mb-1.5 block text-sm font-medium">
      {{ props.label }}
      <span v-if="props.required" class="text-danger" aria-hidden="true">*</span>
    </label>

    <div
      v-if="picked"
      class="border-line bg-surface-muted rounded-control flex h-10 items-center justify-between gap-2 border px-3 text-sm"
      data-testid="picked-student"
    >
      <span class="truncate">
        <span class="font-medium">{{ picked.name }}</span>
        <span class="text-fg-muted">
          · {{ picked.admissionNumber
          }}<template v-if="picked.class"> · {{ picked.class }}</template>
        </span>
      </span>
      <button
        v-if="!props.disabled"
        type="button"
        class="text-fg-muted hover:text-fg shrink-0"
        aria-label="Choose a different learner"
        @click="picked = null"
      >
        <X class="size-4" aria-hidden="true" />
      </button>
    </div>

    <div v-else class="relative">
      <Search
        class="text-fg-muted pointer-events-none absolute top-3 left-3 size-4"
        aria-hidden="true"
      />
      <input
        :id="inputId"
        v-model="term"
        type="search"
        role="combobox"
        autocomplete="off"
        class="form-control pl-9"
        placeholder="Search by name or admission number"
        :disabled="props.disabled"
        :aria-expanded="open && searching"
        :aria-controls="listId"
        :aria-invalid="props.error ? 'true' : undefined"
        @focus="open = true"
        @input="open = true"
        @keydown="onKeydown"
        @blur="open = false"
      />
      <ul
        v-if="open && searching"
        :id="listId"
        role="listbox"
        class="bg-surface border-line shadow-overlay absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border py-1 text-sm"
      >
        <li v-if="results.isPending.value" class="text-fg-muted px-3 py-2">Searching…</li>
        <li v-else-if="options.length === 0" class="text-fg-muted px-3 py-2">
          No learners match “{{ debounced.trim() }}”.
        </li>
        <!-- mousedown, not click: it fires before the input's blur closes the list. -->
        <li
          v-for="(student, index) in options"
          :key="student.id"
          role="option"
          :aria-selected="index === active"
          class="cursor-pointer px-3 py-2"
          :class="index === active ? 'bg-primary-light' : 'hover:bg-surface-muted'"
          @mousedown.prevent="choose(student)"
        >
          <span class="font-medium">{{ student.name }}</span>
          <span class="text-fg-muted">
            · {{ student.admissionNumber
            }}<template v-if="student.class"> · {{ student.class }}</template>
          </span>
        </li>
      </ul>
    </div>
    <p v-if="props.error" class="text-danger mt-1.5 text-xs" role="alert">{{ props.error }}</p>
  </div>
</template>
