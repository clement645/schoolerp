<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppModal from '@/components/ui/AppModal.vue';
import { useSaveAction } from '@/composables/useSaveAction';
import type { Subject } from '@/features/subjects/subjects.service';
import { classesApi, type SchoolClass } from './classes.service';

const props = defineProps<{
  schoolClass: SchoolClass | null;
  subjects: readonly Subject[];
}>();
const open = defineModel<boolean>('open', { required: true });

/** subjectId → whether it is compulsory, for every subject taught in the class. */
const chosen = ref(new Map<string, boolean>());

// Retired subjects can stay on a class, but cannot be newly added.
const selectable = computed(() =>
  props.subjects.filter((subject) => subject.isActive || chosen.value.has(subject.id)),
);

const save = useSaveAction(() =>
  classesApi.setSubjects(
    props.schoolClass?.id ?? '',
    [...chosen.value].map(([subjectId, isCompulsory]) => ({ subjectId, isCompulsory })),
  ),
);

watch(open, (isOpen) => {
  if (!isOpen) return;
  save.reset();
  chosen.value = new Map(
    props.schoolClass?.subjects.map((entry) => [entry.subjectId, entry.isCompulsory]),
  );
});

function toggle(subjectId: string, taught: boolean): void {
  const next = new Map(chosen.value);
  if (taught) next.set(subjectId, true);
  else next.delete(subjectId);
  chosen.value = next;
}

function setCompulsory(subjectId: string, isCompulsory: boolean): void {
  chosen.value = new Map(chosen.value).set(subjectId, isCompulsory);
}

async function submit(): Promise<void> {
  if (await save.run()) open.value = false;
}

const checked = (event: Event): boolean => (event.target as HTMLInputElement).checked;
</script>

<template>
  <AppModal
    v-model:open="open"
    title="Subjects taught"
    :description="props.schoolClass?.name"
    size="lg"
  >
    <AppAlert v-if="save.error.value" class="mb-4" data-testid="class-subjects-error">
      {{ save.error.value }}
    </AppAlert>

    <AppEmptyState
      v-if="selectable.length === 0"
      title="No subjects to choose from"
      description="Add subjects on the Subjects page first."
    />
    <ul v-else class="border-line divide-line rounded-control divide-y border">
      <li
        v-for="subject in selectable"
        :key="subject.id"
        class="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm"
      >
        <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            class="accent-primary size-4 shrink-0"
            :checked="chosen.has(subject.id)"
            @change="toggle(subject.id, checked($event))"
          />
          <span class="truncate font-medium">{{ subject.name }}</span>
          <code class="text-fg-muted text-xs">{{ subject.code }}</code>
          <span v-if="!subject.isActive" class="text-fg-muted text-xs">(inactive)</span>
        </label>
        <label
          v-if="chosen.has(subject.id)"
          class="text-fg-muted flex cursor-pointer items-center gap-2 text-xs"
        >
          <input
            type="checkbox"
            class="accent-primary size-3.5"
            :checked="chosen.get(subject.id)"
            :aria-label="`${subject.name} is compulsory`"
            @change="setCompulsory(subject.id, checked($event))"
          />
          Compulsory
        </label>
      </li>
    </ul>
    <p class="text-fg-muted mt-3 text-xs">
      Untick “Compulsory” for electives that only some learners take.
    </p>

    <template #footer>
      <AppButton variant="outline" :disabled="save.pending.value" @click="open = false">
        Cancel
      </AppButton>
      <AppButton :loading="save.pending.value" data-testid="save-class-subjects" @click="submit">
        Save subjects
      </AppButton>
    </template>
  </AppModal>
</template>
