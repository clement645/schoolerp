<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { portalAccountsApi, type PortalAccounts } from './portal.service';

const props = defineProps<{ studentId: string; canManage: boolean }>();
const queryClient = useQueryClient();

const studentId = computed(() => props.studentId);
const key = useSchoolQueryKey('portal', 'accounts', studentId);
const accounts = useQuery({ queryKey: key, queryFn: () => portalAccountsApi.get(studentId.value) });

interface Target {
  /** Null links the learner's own account. */
  guardianId: string | null;
  name: string;
  role: string;
  email: string | null;
}
const rows = computed<Target[]>(() => {
  const data = accounts.data.value;
  if (!data) return [];
  return [
    { guardianId: null, name: 'The learner', role: 'Student portal', email: data.student.email },
    ...data.guardians.map((guardian) => ({
      guardianId: guardian.guardianId,
      name: guardian.name,
      role: 'Parent portal',
      email: guardian.email,
    })),
  ];
});

const open = ref(false);
const target = ref<Target | null>(null);
const email = ref('');
const pending = ref(false);
const problem = ref('');

function start(row: Target): void {
  target.value = row;
  email.value = '';
  problem.value = '';
  open.value = true;
}
async function apply(row: Target, value: string | null): Promise<boolean> {
  pending.value = true;
  problem.value = '';
  try {
    const updated: PortalAccounts = row.guardianId
      ? await portalAccountsApi.linkGuardian(studentId.value, row.guardianId, value)
      : await portalAccountsApi.linkStudent(studentId.value, value);
    queryClient.setQueryData(key.value, updated);
    return true;
  } catch (caught) {
    problem.value = errorMessage(caught);
    return false;
  } finally {
    pending.value = false;
  }
}
async function submit(): Promise<void> {
  if (!target.value) return;
  if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) {
    problem.value = 'Enter the email address of the user account.';
    return;
  }
  if (await apply(target.value, email.value.trim())) open.value = false;
}
</script>

<template>
  <AppCard
    title="Portal access"
    subtitle="Which user accounts can see this learner's results, attendance and fees"
    flush
  >
    <div v-if="problem && !open" class="px-5 pt-4">
      <AppAlert>{{ problem }}</AppAlert>
    </div>
    <p v-if="accounts.isError.value" class="text-danger p-5 text-sm" role="alert">
      {{ errorMessage(accounts.error.value) }}
    </p>
    <div v-else-if="!accounts.data.value" class="space-y-2 p-5" aria-busy="true">
      <AppSkeleton v-for="n in 2" :key="n" height="2.5rem" />
    </div>
    <ul v-else class="divide-line divide-y">
      <li
        v-for="row in rows"
        :key="row.guardianId ?? 'student'"
        class="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm"
      >
        <div>
          <p class="font-medium">
            {{ row.name }} <AppBadge>{{ row.role }}</AppBadge>
          </p>
          <p class="text-fg-muted mt-0.5">
            {{ row.email ? `Signs in as ${row.email}` : 'No account linked' }}
          </p>
        </div>
        <div v-if="props.canManage">
          <AppButton
            v-if="row.email"
            variant="ghost"
            size="sm"
            :disabled="pending"
            :aria-label="`Remove portal access for ${row.name}`"
            @click="apply(row, null)"
          >
            Remove access
          </AppButton>
          <AppButton
            v-else
            variant="secondary"
            size="sm"
            :aria-label="`Link an account for ${row.name}`"
            @click="start(row)"
          >
            Link account
          </AppButton>
        </div>
      </li>
    </ul>

    <AppModal
      v-model:open="open"
      title="Link a portal account"
      :description="target ? `${target.name} · ${target.role}` : undefined"
    >
      <form id="link-account-form" class="space-y-4" novalidate @submit.prevent="submit">
        <AppAlert v-if="problem">{{ problem }}</AppAlert>
        <p class="text-sm">
          Create the user under Users &amp; Roles first, with the
          {{ target?.guardianId ? 'Parent / Guardian' : 'Student' }} role, then enter its email
          address here.
        </p>
        <AppInput v-model="email" label="Account email" type="email" required data-autofocus />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="open = false">Cancel</AppButton>
        <AppButton type="submit" form="link-account-form" :loading="pending"
          >Link account</AppButton
        >
      </template>
    </AppModal>
  </AppCard>
</template>
