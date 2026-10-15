<!-- Moves a student to another class or stream, changes their status, or
     re-admits a student who had left. One dialog, because all three end by
     choosing where the student is (or that they are no longer) placed. -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import { useClassOptions } from '@/composables/useClassOptions';
import { useSaveAction } from '@/composables/useSaveAction';
import { todayIso } from '@/utils/format';
import { hasLeft, studentsApi, type StudentDetail, type StudentStatus } from './students.service';

export type PlacementMode = 'transfer' | 'status';

const props = defineProps<{ student: StudentDetail; mode: PlacementMode }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ saved: [student: StudentDetail] }>();

const classId = ref('');
const streamId = ref('');
const status = ref<string>('');
const effectiveDate = ref(todayIso());
const reason = ref('');
const problem = ref<string | null>(null);

const { classOptions, streamOptions } = useClassOptions(classId);
watch(classId, () => {
  streamId.value = '';
});

const left = computed(() => hasLeft(props.student.status));

/** The statuses reachable from where the student is now. */
const statusOptions = computed(() => {
  if (left.value) return [{ value: 'ACTIVE', label: 'Re-admit as an active student' }];
  const leaving = [
    { value: 'TRANSFERRED', label: 'Transferred to another school' },
    { value: 'WITHDRAWN', label: 'Withdrawn' },
    { value: 'GRADUATED', label: 'Graduated' },
  ];
  return props.student.status === 'ACTIVE'
    ? [{ value: 'SUSPENDED', label: 'Suspended' }, ...leaving]
    : [{ value: 'ACTIVE', label: 'Active (end the suspension)' }, ...leaving];
});

const leaving = computed(() => hasLeft(status.value as StudentStatus));
const needsPlacement = computed(
  () => props.mode === 'transfer' || (left.value && status.value === 'ACTIVE'),
);

const saved = ref<StudentDetail | null>(null);
const save = useSaveAction(async () => {
  const placement = { classId: classId.value, streamId: streamId.value || null };
  saved.value =
    props.mode === 'transfer'
      ? await studentsApi.transfer(props.student.id, placement)
      : await studentsApi.changeStatus(props.student.id, {
          status: status.value as StudentStatus,
          effectiveDate: effectiveDate.value,
          reason: leaving.value ? reason.value.trim() || null : null,
          ...(needsPlacement.value ? placement : {}),
        });
});

watch(open, (isOpen) => {
  if (!isOpen) return;
  save.reset();
  problem.value = null;
  classId.value = '';
  streamId.value = '';
  status.value = left.value ? 'ACTIVE' : '';
  effectiveDate.value = todayIso();
  reason.value = '';
});

async function submit(): Promise<void> {
  problem.value = null;
  if (props.mode === 'status' && !status.value) problem.value = 'Choose the new status.';
  else if (needsPlacement.value && !classId.value) problem.value = 'Choose a class.';
  else if (needsPlacement.value && streamOptions.value.length > 0 && !streamId.value) {
    problem.value = 'Choose a stream.';
  } else if (effectiveDate.value > todayIso()) {
    problem.value = 'The date cannot be in the future.';
  }
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
    :title="
      props.mode === 'transfer'
        ? 'Move class or stream'
        : left
          ? 'Re-admit student'
          : 'Change status'
    "
    :description="`${props.student.firstName} ${props.student.lastName}`"
  >
    <form id="placement-form" class="space-y-4" novalidate @submit.prevent="submit">
      <AppAlert v-if="problem || save.error.value" data-testid="placement-error">
        {{ problem ?? save.error.value }}
      </AppAlert>

      <template v-if="props.mode === 'status'">
        <AppSelect
          v-model="status"
          :options="statusOptions"
          label="New status"
          placeholder="Select status"
          required
        />
        <AppInput v-model="effectiveDate" type="date" label="Effective date" required />
        <AppInput
          v-if="leaving"
          v-model="reason"
          label="Reason"
          placeholder="e.g. Family relocated"
          hint="Kept on the student’s record."
          autocomplete="off"
        />
        <AppAlert v-if="leaving" tone="info">
          The student’s current enrolment ends on this date. Their record and history are kept, and
          they can be re-admitted later.
        </AppAlert>
      </template>

      <div v-if="needsPlacement" class="grid gap-4 sm:grid-cols-2">
        <AppSelect
          v-model="classId"
          :options="classOptions"
          label="Class"
          placeholder="Select class"
          required
        />
        <AppSelect
          v-model="streamId"
          :options="streamOptions"
          label="Stream"
          :placeholder="streamOptions.length ? 'Select stream' : 'No streams'"
          :disabled="streamOptions.length === 0"
          :required="streamOptions.length > 0"
        />
      </div>
    </form>

    <template #footer>
      <AppButton variant="outline" :disabled="save.pending.value" @click="open = false">
        Cancel
      </AppButton>
      <AppButton
        type="submit"
        form="placement-form"
        :variant="leaving ? 'danger' : 'primary'"
        :loading="save.pending.value"
      >
        {{ props.mode === 'transfer' ? 'Move student' : left ? 'Re-admit' : 'Change status' }}
      </AppButton>
    </template>
  </AppModal>
</template>
