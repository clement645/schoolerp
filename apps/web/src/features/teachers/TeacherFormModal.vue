<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { useForm } from 'vee-validate';
import { z } from 'zod';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { GENDER_LABELS } from '@/features/students/students.service';
import { zodForm } from '@/utils/zod-form';
import { teachersApi, type TeacherDetail } from './teachers.service';

/** Select value meaning "no login account". */
const NONE = 'none';
const UNSPECIFIED = 'unspecified';

const props = defineProps<{
  /** The teacher being edited, or `null` to register one. */
  teacher: TeacherDetail | null;
}>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ saved: [teacher: TeacherDetail] }>();

const schema = z.object({
  staffNumber: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9/._-]{0,29}$/, 'Use letters, digits and / . _ - only.'),
  firstName: z.string().trim().min(1, 'Enter the first name.').max(100),
  lastName: z.string().trim().min(1, 'Enter the last name.').max(100),
  gender: z.string(),
  phone: z
    .string()
    .trim()
    .regex(/^(\+?[0-9 ()-]{7,20})?$/, 'Enter a valid phone number.'),
  email: z.union([z.literal(''), z.email('Enter a valid email address.')]),
  registrationNumber: z.string().trim().max(50),
  employmentDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Choose a valid date.'),
  userId: z.string(),
  active: z.boolean(),
});

const blank = () => ({
  staffNumber: '',
  firstName: '',
  lastName: '',
  gender: UNSPECIFIED,
  phone: '',
  email: '',
  registrationNumber: '',
  employmentDate: '',
  userId: NONE,
  active: true,
});

const { defineField, handleSubmit, errors, resetForm } = useForm({
  validationSchema: zodForm(schema),
  initialValues: blank(),
});
const onBlurOnly = { validateOnModelUpdate: false };
const [staffNumber, staffNumberAttrs] = defineField('staffNumber', onBlurOnly);
const [firstName, firstNameAttrs] = defineField('firstName', onBlurOnly);
const [lastName, lastNameAttrs] = defineField('lastName', onBlurOnly);
const [gender] = defineField('gender');
const [phone, phoneAttrs] = defineField('phone', onBlurOnly);
const [email, emailAttrs] = defineField('email', onBlurOnly);
const [registrationNumber, registrationAttrs] = defineField('registrationNumber', onBlurOnly);
const [employmentDate, employmentDateAttrs] = defineField('employmentDate', onBlurOnly);
const [userId] = defineField('userId');
const [active] = defineField('active');

const editing = computed(() => props.teacher !== null);

const GENDER_OPTIONS = [
  { value: UNSPECIFIED, label: 'Not specified' },
  ...Object.entries(GENDER_LABELS).map(([value, label]) => ({ value, label })),
];

const linkable = useQuery({
  queryKey: useSchoolQueryKey('teachers', 'linkable-users'),
  queryFn: teachersApi.linkableUsers,
  enabled: open,
  staleTime: 0,
});
const accountOptions = computed(() => {
  const current = props.teacher?.user;
  return [
    { value: NONE, label: 'No login account' },
    // The account already linked to this teacher is not in the "unlinked" list.
    ...(current ? [{ value: current.id, label: current.email }] : []),
    ...(linkable.data.value ?? []).map((user) => ({
      value: user.id,
      label: `${user.name} (${user.email})`,
    })),
  ];
});

const saved = ref<TeacherDetail | null>(null);
const save = useSaveAction(async (values: z.output<typeof schema>) => {
  const input = {
    staffNumber: values.staffNumber,
    firstName: values.firstName,
    lastName: values.lastName,
    gender: values.gender === UNSPECIFIED ? null : values.gender,
    phone: values.phone || null,
    email: values.email || null,
    registrationNumber: values.registrationNumber || null,
    employmentDate: values.employmentDate || null,
    userId: values.userId === NONE ? null : values.userId,
  };
  saved.value = props.teacher
    ? await teachersApi.update(props.teacher.id, {
        ...input,
        status: values.active ? 'ACTIVE' : 'INACTIVE',
      })
    : await teachersApi.create(input);
});

watch(open, (isOpen) => {
  if (!isOpen) return;
  save.reset();
  const teacher = props.teacher;
  resetForm({
    values: teacher
      ? {
          staffNumber: teacher.staffNumber,
          firstName: teacher.firstName,
          lastName: teacher.lastName,
          gender: teacher.gender ?? UNSPECIFIED,
          phone: teacher.phone ?? '',
          email: teacher.email ?? '',
          registrationNumber: teacher.registrationNumber ?? '',
          employmentDate: teacher.employmentDate ?? '',
          userId: teacher.user?.id ?? NONE,
          active: teacher.status === 'ACTIVE',
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
  <AppModal v-model:open="open" :title="editing ? 'Edit teacher' : 'Add teacher'" size="lg">
    <form id="teacher-form" class="space-y-4" novalidate @submit="submit">
      <AppAlert v-if="save.error.value" data-testid="teacher-form-error">
        {{ save.error.value }}
      </AppAlert>

      <div class="grid gap-4 sm:grid-cols-2">
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
          v-model="lastName"
          v-bind="lastNameAttrs"
          label="Last name"
          autocomplete="off"
          required
          :error="errors.lastName"
        />
        <AppInput
          v-model="staffNumber"
          v-bind="staffNumberAttrs"
          label="Staff number"
          placeholder="e.g. T-014"
          autocomplete="off"
          required
          :error="errors.staffNumber"
        />
        <AppSelect v-model="gender" :options="GENDER_OPTIONS" label="Gender" />
        <AppInput
          v-model="phone"
          v-bind="phoneAttrs"
          type="tel"
          label="Phone"
          autocomplete="off"
          :error="errors.phone"
        />
        <AppInput
          v-model="email"
          v-bind="emailAttrs"
          type="email"
          label="Email"
          autocomplete="off"
          :error="errors.email"
        />
        <AppInput
          v-model="registrationNumber"
          v-bind="registrationAttrs"
          label="Registration number"
          hint="For example, a TSC number."
          autocomplete="off"
          :error="errors.registrationNumber"
        />
        <AppInput
          v-model="employmentDate"
          v-bind="employmentDateAttrs"
          type="date"
          label="Employment date"
          :error="errors.employmentDate"
        />
      </div>

      <AppSelect
        v-model="userId"
        :options="accountOptions"
        label="Login account"
        hint="Linking an account lets this teacher sign in and see the classes they are assigned to. Create the account under Users & Roles with the Teacher role."
      />

      <label v-if="editing" class="flex items-start gap-3 text-sm">
        <input v-model="active" type="checkbox" class="accent-primary mt-0.5 size-4" />
        <span>
          <span class="block font-medium">Active</span>
          <span class="text-fg-muted block text-xs">
            An inactive teacher keeps their history but loses access to their classes.
          </span>
        </span>
      </label>
    </form>

    <template #footer>
      <AppButton variant="outline" :disabled="save.pending.value" @click="open = false">
        Cancel
      </AppButton>
      <AppButton type="submit" form="teacher-form" :loading="save.pending.value">
        {{ editing ? 'Save changes' : 'Add teacher' }}
      </AppButton>
    </template>
  </AppModal>
</template>
