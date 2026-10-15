<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import { useClassOptions } from '@/composables/useClassOptions';
import { useSaveAction } from '@/composables/useSaveAction';
import { teachersApi, type TeacherDetail } from './teachers.service';

/** Select value meaning the assignment covers every stream of the class. */
const WHOLE_CLASS = 'whole-class';

const props = defineProps<{ teacher: TeacherDetail }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ saved: [teacher: TeacherDetail] }>();

const KIND_OPTIONS = [
  { value: 'SUBJECT_TEACHER', label: 'Teaches a subject' },
  { value: 'CLASS_TEACHER', label: 'Is the class teacher' },
];

const kind = ref<'SUBJECT_TEACHER' | 'CLASS_TEACHER'>('SUBJECT_TEACHER');
const classId = ref('');
const streamId = ref(WHOLE_CLASS);
const subjectId = ref('');
const problem = ref<string | null>(null);

const { classOptions, selectedClass, streamOptions } = useClassOptions(classId);
const streamChoices = computed(() => [
  { value: WHOLE_CLASS, label: streamOptions.value.length ? 'All streams' : 'Whole class' },
  ...streamOptions.value,
]);
// Only subjects the class actually takes can be taught to it.
const subjectOptions = computed(() =>
  (selectedClass.value?.subjects ?? []).map((subject) => ({
    value: subject.subjectId,
    label: `${subject.name} (${subject.code})`,
  })),
);

watch(classId, () => {
  streamId.value = WHOLE_CLASS;
  subjectId.value = '';
});

const saved = ref<TeacherDetail | null>(null);
const save = useSaveAction(async () => {
  saved.value = await teachersApi.addAssignment(props.teacher.id, {
    kind: kind.value,
    classId: classId.value,
    streamId: streamId.value === WHOLE_CLASS ? null : streamId.value,
    subjectId: kind.value === 'SUBJECT_TEACHER' ? subjectId.value : null,
  });
});

watch(open, (isOpen) => {
  if (!isOpen) return;
  save.reset();
  problem.value = null;
  kind.value = 'SUBJECT_TEACHER';
  classId.value = '';
  streamId.value = WHOLE_CLASS;
  subjectId.value = '';
});

async function submit(): Promise<void> {
  problem.value = null;
  if (!classId.value) problem.value = 'Choose a class.';
  else if (kind.value === 'SUBJECT_TEACHER' && !subjectId.value)
    problem.value = 'Choose a subject.';
  if (problem.value) return;

  if ((await save.run()) && saved.value) {
    emit('saved', saved.value);
    open.value = false;
  }
}
</script>

<template>
  <AppModal
    v-model:open="open"
    title="Add assignment"
    :description="`${props.teacher.firstName} ${props.teacher.lastName} · current academic year`"
  >
    <form id="assignment-form" class="space-y-4" novalidate @submit.prevent="submit">
      <AppAlert v-if="problem || save.error.value" data-testid="assignment-form-error">
        {{ problem ?? save.error.value }}
      </AppAlert>

      <AppSelect v-model="kind" :options="KIND_OPTIONS" label="Responsibility" required />
      <div class="grid gap-4 sm:grid-cols-2">
        <AppSelect
          v-model="classId"
          :options="classOptions"
          label="Class"
          placeholder="Select class"
          required
        />
        <AppSelect
          v-model="streamId"
          :options="streamChoices"
          label="Stream"
          :disabled="!classId"
        />
      </div>
      <AppSelect
        v-if="kind === 'SUBJECT_TEACHER'"
        v-model="subjectId"
        :options="subjectOptions"
        label="Subject"
        :placeholder="
          !classId
            ? 'Choose a class first'
            : subjectOptions.length
              ? 'Select subject'
              : 'This class has no subjects yet'
        "
        :disabled="subjectOptions.length === 0"
        hint="Subjects are assigned to classes on the Classes page."
        required
      />
      <p class="text-fg-muted text-xs">
        The teacher will be able to see the students of this class
        {{ streamId === WHOLE_CLASS ? '' : 'stream' }} when they sign in.
      </p>
    </form>

    <template #footer>
      <AppButton variant="outline" :disabled="save.pending.value" @click="open = false">
        Cancel
      </AppButton>
      <AppButton type="submit" form="assignment-form" :loading="save.pending.value">
        Add assignment
      </AppButton>
    </template>
  </AppModal>
</template>
