<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useForm } from 'vee-validate';
import { z } from 'zod';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import { useClassOptions } from '@/composables/useClassOptions';
import { useSaveAction } from '@/composables/useSaveAction';
import { todayIso } from '@/utils/format';
import { zodForm } from '@/utils/zod-form';
import {
  GENDER_LABELS,
  RELATIONSHIP_OPTIONS,
  studentsApi,
  type StudentDetail,
} from './students.service';

const props = defineProps<{
  /** The student being edited, or `null` to admit a new one. */
  student: StudentDetail | null;
}>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ saved: [student: StudentDetail] }>();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE = /^(\+?[0-9 ()-]{7,20})?$/;
const GENDER_OPTIONS = Object.entries(GENDER_LABELS).map(([value, label]) => ({ value, label }));

const editing = computed(() => props.student !== null);

const schema = z
  .object({
    admissionNumber: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9/._-]{0,29}$/, 'Use letters, digits and / . _ - only.'),
    firstName: z.string().trim().min(1, 'Enter the first name.').max(100),
    middleName: z.string().trim().max(100),
    lastName: z.string().trim().min(1, 'Enter the last name.').max(100),
    dateOfBirth: z.string().regex(DATE, 'Choose the date of birth.'),
    gender: z.string().min(1, 'Choose a gender.'),
    nationality: z.string().trim().max(100),
    admissionDate: z.string().regex(DATE, 'Choose the admission date.'),
    classId: z.string(),
    streamId: z.string(),
    emergencyContactName: z.string().trim().max(200),
    emergencyContactPhone: z.string().trim().regex(PHONE, 'Enter a valid phone number.'),
    emergencyContactRelationship: z.string().trim().max(100),
    guardianFirstName: z.string().trim().max(100),
    guardianLastName: z.string().trim().max(100),
    guardianPhone: z.string().trim().regex(PHONE, 'Enter a valid phone number.'),
    guardianRelationship: z.string(),
  })
  .superRefine((values, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: 'custom', path: [path], message });

    if (DATE.test(values.dateOfBirth) && DATE.test(values.admissionDate)) {
      if (values.dateOfBirth >= values.admissionDate) {
        issue('dateOfBirth', 'The date of birth must be before the admission date.');
      }
      if (values.admissionDate > todayIso()) {
        issue('admissionDate', 'The admission date cannot be in the future.');
      }
    }
    if (editing.value) return;

    if (!values.classId) issue('classId', 'Choose a class.');
    if (streamOptions.value.length > 0 && !values.streamId) issue('streamId', 'Choose a stream.');

    const guardian = [values.guardianFirstName, values.guardianLastName, values.guardianPhone];
    if (guardian.some(Boolean) && !guardian.every(Boolean)) {
      issue(
        'guardianPhone',
        'Enter the guardian’s first name, last name and phone, or leave all blank.',
      );
    }
  });

const blank = () => ({
  admissionNumber: '',
  firstName: '',
  middleName: '',
  lastName: '',
  dateOfBirth: '',
  gender: '',
  nationality: '',
  admissionDate: todayIso(),
  classId: '',
  streamId: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  emergencyContactRelationship: '',
  guardianFirstName: '',
  guardianLastName: '',
  guardianPhone: '',
  guardianRelationship: 'MOTHER',
});

const { defineField, handleSubmit, errors, resetForm, setFieldValue } = useForm({
  validationSchema: zodForm(schema),
  initialValues: blank(),
});
const onBlurOnly = { validateOnModelUpdate: false };
const [admissionNumber, admissionNumberAttrs] = defineField('admissionNumber', onBlurOnly);
const [firstName, firstNameAttrs] = defineField('firstName', onBlurOnly);
const [middleName, middleNameAttrs] = defineField('middleName', onBlurOnly);
const [lastName, lastNameAttrs] = defineField('lastName', onBlurOnly);
const [dateOfBirth, dateOfBirthAttrs] = defineField('dateOfBirth', onBlurOnly);
const [gender] = defineField('gender', onBlurOnly);
const [nationality, nationalityAttrs] = defineField('nationality', onBlurOnly);
const [admissionDate, admissionDateAttrs] = defineField('admissionDate', onBlurOnly);
const [classId] = defineField('classId', onBlurOnly);
const [streamId] = defineField('streamId', onBlurOnly);
const [emergencyContactName, emergencyNameAttrs] = defineField('emergencyContactName', onBlurOnly);
const [emergencyContactPhone, emergencyPhoneAttrs] = defineField(
  'emergencyContactPhone',
  onBlurOnly,
);
const [emergencyContactRelationship, emergencyRelationAttrs] = defineField(
  'emergencyContactRelationship',
  onBlurOnly,
);
const [guardianFirstName, guardianFirstAttrs] = defineField('guardianFirstName', onBlurOnly);
const [guardianLastName, guardianLastAttrs] = defineField('guardianLastName', onBlurOnly);
const [guardianPhone, guardianPhoneAttrs] = defineField('guardianPhone', onBlurOnly);
const [guardianRelationship] = defineField('guardianRelationship');

const selectedClassId = computed(() => classId.value ?? '');
const { classOptions, streamOptions } = useClassOptions(selectedClassId);

// A stream belongs to one class, so changing class clears it.
watch(classId, (next, previous) => {
  if (previous !== undefined && next !== previous) setFieldValue('streamId', '');
});

const saved = ref<StudentDetail | null>(null);
const save = useSaveAction(async (values: z.output<typeof schema>) => {
  const personal = {
    admissionNumber: values.admissionNumber,
    firstName: values.firstName,
    middleName: values.middleName || null,
    lastName: values.lastName,
    dateOfBirth: values.dateOfBirth,
    gender: values.gender as StudentDetail['gender'],
    nationality: values.nationality || null,
    admissionDate: values.admissionDate,
    emergencyContactName: values.emergencyContactName || null,
    emergencyContactPhone: values.emergencyContactPhone || null,
    emergencyContactRelationship: values.emergencyContactRelationship || null,
  };
  saved.value = props.student
    ? await studentsApi.update(props.student.id, personal)
    : await studentsApi.create({
        ...personal,
        classId: values.classId,
        streamId: values.streamId || null,
        guardians: values.guardianPhone
          ? [
              {
                firstName: values.guardianFirstName,
                lastName: values.guardianLastName,
                phone: values.guardianPhone,
                relationship: values.guardianRelationship,
              },
            ]
          : [],
      });
});

watch(open, (isOpen) => {
  if (!isOpen) return;
  save.reset();
  const student = props.student;
  resetForm({
    values: student
      ? {
          ...blank(),
          admissionNumber: student.admissionNumber,
          firstName: student.firstName,
          middleName: student.middleName ?? '',
          lastName: student.lastName,
          dateOfBirth: student.dateOfBirth,
          gender: student.gender,
          nationality: student.nationality ?? '',
          admissionDate: student.admissionDate,
          emergencyContactName: student.emergencyContactName ?? '',
          emergencyContactPhone: student.emergencyContactPhone ?? '',
          emergencyContactRelationship: student.emergencyContactRelationship ?? '',
        }
      : blank(),
  });
});

const submit = handleSubmit(async (values) => {
  if ((await save.run(values)) && saved.value) {
    emit('saved', saved.value);
    open.value = false;
  }
});
</script>

<template>
  <AppModal
    v-model:open="open"
    :title="editing ? 'Edit student' : 'Admit student'"
    :description="editing ? undefined : 'The student joins the current academic year.'"
    size="xl"
  >
    <form id="student-form" class="space-y-6" novalidate @submit="submit">
      <AppAlert v-if="save.error.value" data-testid="student-form-error">
        {{ save.error.value }}
      </AppAlert>

      <fieldset class="space-y-4">
        <legend class="text-sm font-semibold">Student</legend>
        <div class="grid gap-4 sm:grid-cols-3">
          <AppInput
            v-model="firstName"
            v-bind="firstNameAttrs"
            label="First name"
            autocomplete="off"
            data-autofocus
            required
            :error="errors.firstName"
          />
          <AppInput
            v-model="middleName"
            v-bind="middleNameAttrs"
            label="Middle name"
            autocomplete="off"
            :error="errors.middleName"
          />
          <AppInput
            v-model="lastName"
            v-bind="lastNameAttrs"
            label="Last name"
            autocomplete="off"
            required
            :error="errors.lastName"
          />
        </div>
        <div class="grid gap-4 sm:grid-cols-3">
          <AppInput
            v-model="dateOfBirth"
            v-bind="dateOfBirthAttrs"
            type="date"
            label="Date of birth"
            required
            :error="errors.dateOfBirth"
          />
          <AppSelect
            v-model="gender"
            :options="GENDER_OPTIONS"
            label="Gender"
            placeholder="Select gender"
            required
            :error="errors.gender"
          />
          <AppInput
            v-model="nationality"
            v-bind="nationalityAttrs"
            label="Nationality"
            autocomplete="off"
            :error="errors.nationality"
          />
        </div>
      </fieldset>

      <fieldset class="border-line space-y-4 border-t pt-5">
        <legend class="text-sm font-semibold">Admission</legend>
        <div class="grid gap-4 sm:grid-cols-2" :class="{ 'lg:grid-cols-4': !editing }">
          <AppInput
            v-model="admissionNumber"
            v-bind="admissionNumberAttrs"
            label="Admission number"
            placeholder="e.g. ADM-0001"
            autocomplete="off"
            required
            :error="errors.admissionNumber"
          />
          <AppInput
            v-model="admissionDate"
            v-bind="admissionDateAttrs"
            type="date"
            label="Admission date"
            required
            :error="errors.admissionDate"
          />
          <template v-if="!editing">
            <AppSelect
              v-model="classId"
              :options="classOptions"
              label="Class"
              placeholder="Select class"
              required
              :error="errors.classId"
            />
            <AppSelect
              v-model="streamId"
              :options="streamOptions"
              label="Stream"
              :placeholder="streamOptions.length ? 'Select stream' : 'No streams'"
              :disabled="streamOptions.length === 0"
              :required="streamOptions.length > 0"
              :error="errors.streamId"
            />
          </template>
        </div>
        <p v-if="editing" class="text-fg-muted text-xs">
          To change the class or stream, use “Move class” on the student’s profile.
        </p>
      </fieldset>

      <fieldset v-if="!editing" class="border-line space-y-4 border-t pt-5">
        <legend class="text-sm font-semibold">Parent or guardian</legend>
        <p class="text-fg-muted -mt-2 text-xs">
          Optional now. More guardians, or a sibling’s existing guardian, can be added on the
          profile.
        </p>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AppInput
            v-model="guardianFirstName"
            v-bind="guardianFirstAttrs"
            label="First name"
            aria-label="Guardian first name"
            autocomplete="off"
            :error="errors.guardianFirstName"
          />
          <AppInput
            v-model="guardianLastName"
            v-bind="guardianLastAttrs"
            label="Last name"
            aria-label="Guardian last name"
            autocomplete="off"
            :error="errors.guardianLastName"
          />
          <AppInput
            v-model="guardianPhone"
            v-bind="guardianPhoneAttrs"
            type="tel"
            label="Phone"
            aria-label="Guardian phone"
            placeholder="+254 700 000 000"
            autocomplete="off"
            :error="errors.guardianPhone"
          />
          <AppSelect
            v-model="guardianRelationship"
            :options="RELATIONSHIP_OPTIONS"
            label="Relationship"
            aria-label="Guardian relationship"
          />
        </div>
      </fieldset>

      <fieldset class="border-line space-y-4 border-t pt-5">
        <legend class="text-sm font-semibold">Emergency contact</legend>
        <div class="grid gap-4 sm:grid-cols-3">
          <AppInput
            v-model="emergencyContactName"
            v-bind="emergencyNameAttrs"
            label="Name"
            aria-label="Emergency contact name"
            autocomplete="off"
            :error="errors.emergencyContactName"
          />
          <AppInput
            v-model="emergencyContactPhone"
            v-bind="emergencyPhoneAttrs"
            type="tel"
            label="Phone"
            aria-label="Emergency contact phone"
            autocomplete="off"
            :error="errors.emergencyContactPhone"
          />
          <AppInput
            v-model="emergencyContactRelationship"
            v-bind="emergencyRelationAttrs"
            label="Relationship"
            aria-label="Emergency contact relationship"
            placeholder="e.g. Aunt"
            autocomplete="off"
            :error="errors.emergencyContactRelationship"
          />
        </div>
      </fieldset>
    </form>

    <template #footer>
      <AppButton variant="outline" :disabled="save.pending.value" @click="open = false">
        Cancel
      </AppButton>
      <AppButton type="submit" form="student-form" :loading="save.pending.value">
        {{ editing ? 'Save changes' : 'Admit student' }}
      </AppButton>
    </template>
  </AppModal>
</template>
