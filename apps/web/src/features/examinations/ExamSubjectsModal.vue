<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { examsApi, type ExamSummary } from './examinations.service';

const props = defineProps<{ exam: ExamSummary | null; canManage: boolean }>();
const emit = defineEmits<{ close: [] }>();

const open = computed({
  get: () => props.exam !== null,
  set: (value) => {
    if (!value) emit('close');
  },
});
const examId = computed(() => props.exam?.id ?? '');

const detail = useQuery({
  queryKey: useSchoolQueryKey('examinations', 'detail', examId),
  queryFn: () => examsApi.get(examId.value),
  enabled: open,
});

const editable = computed(
  () => props.canManage && (props.exam?.status === 'DRAFT' || props.exam?.status === 'OPEN'),
);

/** examSubjectId → text being edited. */
const drafts = ref<Record<string, string>>({});
watch(
  () => detail.data.value,
  (loaded) => {
    drafts.value = Object.fromEntries(
      (loaded?.subjectsByClass ?? []).flatMap((group) =>
        group.subjects.map((subject) => [subject.examSubjectId, String(subject.maxMarks)]),
      ),
    );
  },
  { immediate: true },
);

const save = useSaveAction((examSubjectId: string) =>
  examsApi.setMaxMarks(examId.value, examSubjectId, Number(drafts.value[examSubjectId])),
);
const valid = (text: string | undefined) =>
  /^\d{1,4}(\.\d{1,2})?$/.test(text ?? '') && Number(text) >= 1;
</script>

<template>
  <AppModal
    v-model:open="open"
    :title="props.exam ? `${props.exam.name} — subjects` : 'Subjects'"
    description="The maximum mark for each subject. Scores are compared as percentages of it."
    size="lg"
  >
    <AppAlert v-if="save.error.value" class="mb-4" data-testid="max-marks-error">
      {{ save.error.value }}
    </AppAlert>
    <AppAlert v-else-if="!editable && props.canManage" tone="info" class="mb-4">
      Maximum marks can only be changed while the examination is a draft or open for marks entry.
    </AppAlert>

    <div v-if="detail.isPending.value" class="space-y-2" aria-busy="true">
      <AppSkeleton v-for="n in 4" :key="n" height="2.25rem" />
    </div>
    <AppAlert v-else-if="detail.isError.value">{{ errorMessage(detail.error.value) }}</AppAlert>
    <div v-else class="space-y-5">
      <section v-for="group in detail.data.value?.subjectsByClass" :key="group.class.id">
        <h3 class="text-sm">{{ group.class.name }}</h3>
        <ul class="border-line divide-line rounded-control mt-2 divide-y border">
          <li
            v-for="subject in group.subjects"
            :key="subject.examSubjectId"
            class="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm"
          >
            <span class="min-w-0">
              <span class="font-medium">{{ subject.name }}</span>
              <code class="text-fg-muted ml-2 text-xs">{{ subject.code }}</code>
              <span v-if="!subject.isCompulsory" class="text-fg-muted ml-2 text-xs">elective</span>
            </span>
            <span v-if="editable" class="flex items-center gap-2">
              <input
                v-model="drafts[subject.examSubjectId]"
                class="form-control h-9 w-24 text-right"
                inputmode="decimal"
                :aria-label="`Maximum marks for ${subject.name} in ${group.class.name}`"
              />
              <AppButton
                size="sm"
                variant="outline"
                :disabled="
                  !valid(drafts[subject.examSubjectId]) ||
                  Number(drafts[subject.examSubjectId]) === subject.maxMarks ||
                  save.pending.value
                "
                @click="save.run(subject.examSubjectId)"
              >
                Save
              </AppButton>
            </span>
            <span v-else class="tabular-nums">out of {{ subject.maxMarks }}</span>
          </li>
        </ul>
      </section>
    </div>

    <template #footer>
      <AppButton variant="outline" @click="emit('close')">Close</AppButton>
    </template>
  </AppModal>
</template>
