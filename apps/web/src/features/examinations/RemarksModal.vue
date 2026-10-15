<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import AppTextarea from '@/components/ui/AppTextarea.vue';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { REMARK_MAX_LENGTH, reportCardsApi, type RemarksInput } from './report-cards.service';

const props = defineProps<{
  examinationId: string;
  studentId: string | null;
  canEdit: { classTeacherRemarks: boolean; principalRemarks: boolean };
}>();
const open = defineModel<boolean>('open', { required: true });

const examinationId = computed(() => props.examinationId);
const studentId = computed(() => props.studentId ?? '');
const card = useQuery({
  queryKey: useSchoolQueryKey('report-cards', 'card', examinationId, studentId),
  queryFn: () => reportCardsApi.card(examinationId.value, studentId.value),
  enabled: computed(() => open.value && studentId.value !== ''),
  staleTime: 0,
});

const form = reactive({ classTeacher: '', principal: '' });
watch(
  [() => card.data.value, open],
  ([loaded, isOpen]) => {
    if (loaded && isOpen) {
      form.classTeacher = loaded.remarks.classTeacher ?? '';
      form.principal = loaded.remarks.principal ?? '';
    }
  },
  { immediate: true },
);

const save = useSaveAction((data: RemarksInput) =>
  reportCardsApi.saveRemarks(examinationId.value, studentId.value, data),
);
watch(open, (isOpen) => isOpen && save.reset());

async function submit(): Promise<void> {
  // Only what the person is allowed to write is sent.
  const data: RemarksInput = {};
  if (props.canEdit.classTeacherRemarks) data.classTeacherRemarks = form.classTeacher;
  if (props.canEdit.principalRemarks) data.principalRemarks = form.principal;
  if (await save.run(data)) open.value = false;
}
</script>

<template>
  <AppModal
    v-model:open="open"
    size="lg"
    title="Report card remarks"
    :description="
      card.data.value
        ? `${card.data.value.student.name} · ${card.data.value.examination.name}`
        : undefined
    "
  >
    <AppAlert v-if="card.isError.value">{{ errorMessage(card.error.value) }}</AppAlert>
    <div v-else-if="!card.data.value" class="space-y-3" aria-busy="true">
      <AppSkeleton height="5rem" />
      <AppSkeleton height="5rem" />
    </div>
    <form v-else id="remarks-form" class="space-y-4" novalidate @submit.prevent="submit">
      <AppAlert v-if="save.error.value">{{ save.error.value }}</AppAlert>
      <AppTextarea
        v-model="form.classTeacher"
        label="Class teacher's remarks"
        :max-length="REMARK_MAX_LENGTH"
        :disabled="!props.canEdit.classTeacherRemarks"
        :hint="
          props.canEdit.classTeacherRemarks ? undefined : 'Written by the learner’s class teacher.'
        "
        data-autofocus
      />
      <AppTextarea
        v-model="form.principal"
        label="Principal's remarks"
        :max-length="REMARK_MAX_LENGTH"
        :disabled="!props.canEdit.principalRemarks"
        :hint="props.canEdit.principalRemarks ? undefined : 'Written by those who approve results.'"
      />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="open = false">Cancel</AppButton>
      <AppButton
        type="submit"
        form="remarks-form"
        :loading="save.pending.value"
        :disabled="!card.data.value"
      >
        Save remarks
      </AppButton>
    </template>
  </AppModal>
</template>
