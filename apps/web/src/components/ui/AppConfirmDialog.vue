<script setup lang="ts">
import AppAlert from './AppAlert.vue';
import AppButton from './AppButton.vue';
import AppModal from './AppModal.vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    confirmLabel: string;
    /** `danger` for actions that remove or disable something. */
    tone?: 'primary' | 'danger';
    loading?: boolean;
    /** Shown when the confirmed action failed. */
    error?: string | null;
  }>(),
  { tone: 'primary', loading: false, error: null },
);

const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <AppModal
    :open="props.open"
    :title="props.title"
    size="sm"
    :dismissible="!props.loading"
    @update:open="emit('cancel')"
  >
    <AppAlert v-if="props.error" class="mb-4" data-testid="confirm-error">{{
      props.error
    }}</AppAlert>
    <div class="text-sm">
      <slot />
    </div>
    <template #footer>
      <AppButton variant="outline" :disabled="props.loading" @click="emit('cancel')">
        Cancel
      </AppButton>
      <AppButton
        :variant="props.tone === 'danger' ? 'danger' : 'primary'"
        :loading="props.loading"
        data-testid="confirm-action"
        @click="emit('confirm')"
      >
        {{ props.confirmLabel }}
      </AppButton>
    </template>
  </AppModal>
</template>
