<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import { errorMessage } from '@/services/http';
import { formatDateTime } from '@/utils/format';
import RolePicker from './RolePicker.vue';
import { usersApi, type Role, type User } from './users.service';

const props = defineProps<{
  /** The user being managed; the dialog is open while this is set. */
  user: User | null;
  availableRoles: readonly Role[];
  /** The signed-in user's own id: their own access is not editable here. */
  currentUserId: string | null;
}>();

const emit = defineEmits<{ close: [] }>();

const queryClient = useQueryClient();
const open = computed({
  get: () => props.user !== null,
  set: (value) => {
    if (!value) emit('close');
  },
});

const isSelf = computed(() => props.user?.id === props.currentUserId);
// Roles outside the caller's own access cannot be taken away either.
const locked = computed(() => {
  const grantable = new Set(props.availableRoles.filter((r) => r.grantable).map((r) => r.key));
  return props.user?.roles.some((role) => !grantable.has(role.key)) ?? false;
});
const readOnly = computed(() => isSelf.value || locked.value);

const selectedRoles = ref<string[]>([]);
const temporaryPassword = ref('');
const failure = ref<string | null>(null);
const notice = ref<string | null>(null);
// Keeps showing the latest state of the user after each change.
const current = ref<User | null>(null);

watch(
  () => props.user,
  (user) => {
    current.value = user;
    selectedRoles.value = user?.roles.map((role) => role.key) ?? [];
    temporaryPassword.value = '';
    failure.value = null;
    notice.value = null;
  },
  { immediate: true },
);

const rolesChanged = computed(() => {
  const before = [...(current.value?.roles.map((role) => role.key) ?? [])].sort();
  return JSON.stringify(before) !== JSON.stringify([...selectedRoles.value].sort());
});

function useAction<TArgs>(run: (user: User, args: TArgs) => Promise<User | void>, done: string) {
  return useMutation({
    mutationFn: async (args: TArgs) => {
      if (!current.value) return;
      failure.value = null;
      notice.value = null;
      const updated = await run(current.value, args);
      if (updated) current.value = updated;
    },
    onSuccess: async () => {
      notice.value = done;
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => {
      failure.value = errorMessage(error);
    },
  });
}

const saveRoles = useAction<void>(
  (user) => usersApi.setRoles(user.id, selectedRoles.value),
  'Roles updated.',
);
const setStatus = useAction<User['status']>(
  (user, status) => usersApi.update(user.id, { status }),
  'Account status updated.',
);
const resetPassword = useAction<void>(async (user) => {
  await usersApi.resetPassword(user.id, temporaryPassword.value);
  temporaryPassword.value = '';
  return { ...user, mustChangePassword: true };
}, 'Temporary password set. The user has been signed out everywhere.');

const busy = computed(
  () => saveRoles.isPending.value || setStatus.isPending.value || resetPassword.isPending.value,
);
</script>

<template>
  <AppModal
    v-model:open="open"
    :title="current ? `${current.firstName} ${current.lastName}` : 'User'"
    :description="current?.email"
    size="lg"
  >
    <div v-if="current" class="space-y-6">
      <AppAlert v-if="failure" data-testid="manage-user-error">{{ failure }}</AppAlert>
      <AppAlert v-else-if="notice" tone="success" data-testid="manage-user-notice">
        {{ notice }}
      </AppAlert>
      <AppAlert v-if="isSelf" tone="info">
        This is your own account. Another administrator must change your roles or status.
      </AppAlert>
      <AppAlert v-else-if="locked" tone="info">
        This user holds a role beyond your own access, so you cannot change their account.
      </AppAlert>

      <dl class="grid gap-4 text-sm sm:grid-cols-3">
        <div>
          <dt class="text-fg-muted">Status</dt>
          <dd class="mt-1">
            <AppBadge :variant="current.status === 'ACTIVE' ? 'success' : 'neutral'" dot>
              {{ current.status === 'ACTIVE' ? 'Active' : 'Disabled' }}
            </AppBadge>
          </dd>
        </div>
        <div>
          <dt class="text-fg-muted">Last sign-in</dt>
          <dd class="mt-1 font-medium">{{ formatDateTime(current.lastLoginAt) }}</dd>
        </div>
        <div>
          <dt class="text-fg-muted">Password</dt>
          <dd class="mt-1 font-medium">
            {{ current.mustChangePassword ? 'Temporary — change pending' : 'Set by user' }}
          </dd>
        </div>
      </dl>

      <section>
        <RolePicker v-model="selectedRoles" :roles="props.availableRoles" :disabled="readOnly" />
        <div class="mt-3 flex justify-end">
          <AppButton
            size="sm"
            :disabled="readOnly || !rolesChanged || selectedRoles.length === 0 || busy"
            :loading="saveRoles.isPending.value"
            @click="saveRoles.mutate()"
          >
            Save roles
          </AppButton>
        </div>
      </section>

      <section class="border-line border-t pt-5">
        <h3 class="text-sm">Reset password</h3>
        <p class="text-fg-muted mt-1 text-sm">
          Sets a temporary password, signs the user out everywhere and makes them choose a new one.
        </p>
        <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
          <div class="flex-1">
            <AppInput
              v-model="temporaryPassword"
              placeholder="New temporary password (12+ characters)"
              aria-label="New temporary password"
              autocomplete="off"
              :disabled="readOnly"
            />
          </div>
          <AppButton
            variant="outline"
            :disabled="readOnly || temporaryPassword.length < 12 || busy"
            :loading="resetPassword.isPending.value"
            @click="resetPassword.mutate()"
          >
            Reset password
          </AppButton>
        </div>
      </section>

      <section class="border-line border-t pt-5">
        <h3 class="text-sm">
          {{ current.status === 'ACTIVE' ? 'Disable account' : 'Enable account' }}
        </h3>
        <p class="text-fg-muted mt-1 text-sm">
          <template v-if="current.status === 'ACTIVE'">
            The user is signed out immediately and cannot sign in until re-enabled. Their records
            are kept.
          </template>
          <template v-else>The user will be able to sign in again.</template>
        </p>
        <AppButton
          class="mt-3"
          :variant="current.status === 'ACTIVE' ? 'danger' : 'primary'"
          size="sm"
          :disabled="readOnly || busy"
          :loading="setStatus.isPending.value"
          @click="setStatus.mutate(current.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE')"
        >
          {{ current.status === 'ACTIVE' ? 'Disable account' : 'Enable account' }}
        </AppButton>
      </section>
    </div>

    <template #footer>
      <AppButton variant="outline" @click="emit('close')">Close</AppButton>
    </template>
  </AppModal>
</template>
