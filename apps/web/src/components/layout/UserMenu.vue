<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronDown, CircleUserRound, LogOut, UserRound } from '@lucide/vue';
import AppDropdown from '@/components/ui/AppDropdown.vue';

export interface ShellUser {
  name: string;
  /** Human-readable role, e.g. "School Administrator". */
  role: string;
  avatarUrl?: string | null;
}

const props = defineProps<{
  /** The signed-in user, or `null` when there is no session. */
  user: ShellUser | null;
}>();

const emit = defineEmits<{
  profile: [];
  'sign-out': [];
}>();

const open = ref(false);

const initials = computed(() =>
  (props.user?.name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join(''),
);

const ITEM =
  'hover:bg-surface-muted focus-visible:bg-surface-muted flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm focus-visible:outline-none';
</script>

<template>
  <!-- No session: there is no profile to open and nothing to sign out of. -->
  <div
    v-if="!props.user"
    class="text-fg-muted flex items-center gap-2 text-sm"
    data-testid="user-signed-out"
  >
    <CircleUserRound class="size-8" aria-hidden="true" />
    <span class="hidden sm:inline">Not signed in</span>
  </div>

  <AppDropdown v-else v-model:open="open" :label="`Account menu for ${props.user.name}`">
    <template #trigger>
      <span class="flex items-center gap-2.5 py-1 pr-1 pl-1 text-left">
        <img
          v-if="props.user.avatarUrl"
          :src="props.user.avatarUrl"
          alt=""
          class="size-9 rounded-full object-cover"
        />
        <span
          v-else
          class="bg-primary-light text-primary flex size-9 items-center justify-center rounded-full text-sm font-semibold"
          aria-hidden="true"
        >
          {{ initials }}
        </span>
        <span class="hidden min-w-0 md:block">
          <span class="block max-w-40 truncate text-sm leading-tight font-medium">
            {{ props.user.name }}
          </span>
          <span class="text-fg-muted block max-w-40 truncate text-xs">{{ props.user.role }}</span>
        </span>
        <ChevronDown class="text-fg-muted hidden size-4 md:block" aria-hidden="true" />
      </span>
    </template>

    <template #default="{ close }">
      <div class="border-line border-b px-4 py-3 md:hidden">
        <p class="truncate text-sm font-medium">{{ props.user.name }}</p>
        <p class="text-fg-muted truncate text-xs">{{ props.user.role }}</p>
      </div>
      <ul class="py-1">
        <li>
          <button
            type="button"
            :class="ITEM"
            @click="
              close();
              emit('profile');
            "
          >
            <UserRound class="text-fg-muted size-4" aria-hidden="true" />
            My profile
          </button>
        </li>
        <li class="border-line border-t">
          <button
            type="button"
            :class="[ITEM, 'text-danger']"
            @click="
              close();
              emit('sign-out');
            "
          >
            <LogOut class="size-4" aria-hidden="true" />
            Sign out
          </button>
        </li>
      </ul>
    </template>
  </AppDropdown>
</template>
