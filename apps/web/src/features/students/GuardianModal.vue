<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { refDebounced } from '@vueuse/core';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppTabs from '@/components/ui/AppTabs.vue';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import {
  RELATIONSHIP_OPTIONS,
  studentsApi,
  type Guardian,
  type GuardianMatch,
  type StudentDetail,
} from './students.service';

const props = defineProps<{
  student: StudentDetail;
  /** The guardian being edited, or `null` to add one. */
  guardian: Guardian | null;
}>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ saved: [student: StudentDetail] }>();

const TABS = [
  { id: 'new', label: 'New guardian' },
  { id: 'existing', label: 'Already on record' },
];
const PHONE = /^\+?[0-9 ()-]{7,20}$/;

const tab = ref('new');
const firstName = ref('');
const lastName = ref('');
const phone = ref('');
const email = ref('');
const occupation = ref('');
const address = ref('');
const relationship = ref('MOTHER');
const isPrimary = ref(false);
const problem = ref<string | null>(null);

const search = ref('');
const debouncedSearch = refDebounced(search, 300);
const chosen = ref<GuardianMatch | null>(null);

const editing = computed(() => props.guardian !== null);
const linking = computed(() => !editing.value && tab.value === 'existing');

const matches = useQuery({
  queryKey: useSchoolQueryKey('guardians', debouncedSearch),
  queryFn: () => studentsApi.searchGuardians(debouncedSearch.value),
  enabled: computed(() => open.value && linking.value && debouncedSearch.value.trim().length >= 2),
});
// People already linked to this student are not offered again.
const candidates = computed(() => {
  const linked = new Set(props.student.guardians.map((entry) => entry.guardianId));
  return (matches.data.value ?? []).filter((match) => !linked.has(match.id));
});

const saved = ref<StudentDetail | null>(null);
const save = useSaveAction(async () => {
  const details = {
    firstName: firstName.value.trim(),
    lastName: lastName.value.trim(),
    phone: phone.value.trim(),
    email: email.value.trim() || null,
    occupation: occupation.value.trim() || null,
    address: address.value.trim() || null,
  };
  const link = { relationship: relationship.value, isPrimary: isPrimary.value };

  if (props.guardian) {
    saved.value = await studentsApi.updateGuardian(props.student.id, props.guardian.guardianId, {
      details,
      ...link,
    });
  } else if (linking.value && chosen.value) {
    saved.value = await studentsApi.addGuardian(props.student.id, {
      guardianId: chosen.value.id,
      ...link,
    });
  } else {
    saved.value = await studentsApi.addGuardian(props.student.id, { details, ...link });
  }
});

watch(open, (isOpen) => {
  if (!isOpen) return;
  save.reset();
  problem.value = null;
  tab.value = 'new';
  search.value = '';
  chosen.value = null;
  const guardian = props.guardian;
  firstName.value = guardian?.firstName ?? '';
  lastName.value = guardian?.lastName ?? '';
  phone.value = guardian?.phone ?? '';
  email.value = guardian?.email ?? '';
  occupation.value = guardian?.occupation ?? '';
  address.value = guardian?.address ?? '';
  relationship.value = guardian?.relationship ?? 'MOTHER';
  // A student's first guardian is the primary contact.
  isPrimary.value = guardian?.isPrimary ?? props.student.guardians.length === 0;
});

async function submit(): Promise<void> {
  problem.value = null;
  if (linking.value) {
    if (!chosen.value) problem.value = 'Search for and choose a guardian.';
  } else if (!firstName.value.trim() || !lastName.value.trim()) {
    problem.value = 'Enter the guardian’s first and last name.';
  } else if (!PHONE.test(phone.value.trim())) {
    problem.value = 'Enter a valid phone number.';
  } else if (email.value.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim())) {
    problem.value = 'Enter a valid email address.';
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
    :title="editing ? 'Edit guardian' : 'Add guardian'"
    :description="`${props.student.firstName} ${props.student.lastName}`"
    size="lg"
  >
    <form id="guardian-form" class="space-y-4" novalidate @submit.prevent="submit">
      <AppAlert v-if="problem || save.error.value" data-testid="guardian-form-error">
        {{ problem ?? save.error.value }}
      </AppAlert>

      <AppTabs v-if="!editing" v-model="tab" :tabs="TABS" label="How to add the guardian" />

      <template v-if="linking">
        <AppInput
          v-model="search"
          type="search"
          label="Find a guardian"
          placeholder="Name or phone number"
          hint="Use this for a sibling’s parent, so their details stay in one place."
          autocomplete="off"
        />
        <ul
          v-if="candidates.length > 0"
          class="border-line divide-line rounded-control relative max-h-56 divide-y overflow-y-auto border"
        >
          <li v-for="match in candidates" :key="match.id">
            <label
              class="hover:bg-surface-muted flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm"
            >
              <input
                type="radio"
                name="guardian-match"
                class="accent-primary mt-1 size-4 shrink-0"
                :checked="chosen?.id === match.id"
                @change="chosen = match"
              />
              <span class="min-w-0">
                <span class="block font-medium">{{ match.firstName }} {{ match.lastName }}</span>
                <span class="text-fg-muted block text-xs">
                  {{ match.phone }}
                  <template v-if="match.students.length">
                    · {{ match.students.join(', ') }}</template
                  >
                </span>
              </span>
            </label>
          </li>
        </ul>
        <p
          v-else-if="debouncedSearch.trim().length >= 2 && matches.isSuccess.value"
          class="text-fg-muted text-sm"
        >
          No one on record matches. Add them as a new guardian instead.
        </p>
      </template>

      <template v-else>
        <AppAlert v-if="editing" tone="info">
          Contact details belong to the guardian, so changes here also apply to their other children
          at the school.
        </AppAlert>
        <div class="grid gap-4 sm:grid-cols-2">
          <AppInput
            v-model="firstName"
            label="First name"
            autocomplete="off"
            data-autofocus
            required
          />
          <AppInput v-model="lastName" label="Last name" autocomplete="off" required />
          <AppInput
            v-model="phone"
            type="tel"
            label="Phone"
            placeholder="+254 700 000 000"
            autocomplete="off"
            required
          />
          <AppInput v-model="email" type="email" label="Email" autocomplete="off" />
          <AppInput v-model="occupation" label="Occupation" autocomplete="off" />
          <AppInput v-model="address" label="Address" autocomplete="off" />
        </div>
      </template>

      <div class="grid items-end gap-4 sm:grid-cols-2">
        <AppSelect
          v-model="relationship"
          :options="RELATIONSHIP_OPTIONS"
          label="Relationship to student"
        />
        <label class="flex items-start gap-3 pb-2 text-sm">
          <input v-model="isPrimary" type="checkbox" class="accent-primary mt-0.5 size-4" />
          <span>
            <span class="block font-medium">Primary contact</span>
            <span class="text-fg-muted block text-xs">The first person the school calls.</span>
          </span>
        </label>
      </div>
    </form>

    <template #footer>
      <AppButton variant="outline" :disabled="save.pending.value" @click="open = false">
        Cancel
      </AppButton>
      <AppButton type="submit" form="guardian-form" :loading="save.pending.value">
        {{ editing ? 'Save changes' : 'Add guardian' }}
      </AppButton>
    </template>
  </AppModal>
</template>
