<script setup lang="ts">
import type { Role } from './users.service';

const props = defineProps<{
  roles: readonly Role[];
  disabled?: boolean;
  /** Validation message. */
  error?: string;
}>();

/** Keys of the selected roles. */
const selected = defineModel<string[]>({ required: true });

function toggle(key: string, checked: boolean): void {
  selected.value = checked
    ? [...selected.value, key]
    : selected.value.filter((value) => value !== key);
}
</script>

<template>
  <fieldset :disabled="props.disabled">
    <legend class="mb-1.5 text-sm font-medium">Roles</legend>
    <div
      class="border-line divide-line rounded-control relative max-h-64 divide-y overflow-y-auto border"
    >
      <label
        v-for="role in props.roles"
        :key="role.key"
        class="flex items-start gap-3 px-3 py-2.5 text-sm"
        :class="
          role.grantable ? 'hover:bg-surface-muted cursor-pointer' : 'cursor-not-allowed opacity-60'
        "
      >
        <input
          type="checkbox"
          class="accent-primary mt-0.5 size-4 shrink-0"
          :checked="selected.includes(role.key)"
          :disabled="!role.grantable"
          @change="toggle(role.key, ($event.target as HTMLInputElement).checked)"
        />
        <span class="min-w-0">
          <span class="block font-medium">{{ role.name }}</span>
          <span class="text-fg-muted block text-xs">
            {{
              role.grantable ? role.description : 'Exceeds your own access — you cannot assign it.'
            }}
          </span>
        </span>
      </label>
    </div>
    <p v-if="props.error" class="text-danger mt-1.5 text-xs" role="alert">{{ props.error }}</p>
  </fieldset>
</template>
