<script setup lang="ts">
import { computed, useId } from 'vue';
import { ChevronDown } from '@lucide/vue';

defineOptions({ inheritAttrs: false });

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const props = defineProps<{
  options: readonly SelectOption[];
  label?: string;
  /** Shown as an unselectable first entry while nothing is chosen. */
  placeholder?: string;
  hint?: string;
  /** Validation message; its presence marks the field invalid. */
  error?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
}>();

/** The selected option's value, or an empty string when nothing is chosen. */
const model = defineModel<string>({ default: '' });

const generatedId = useId();
const selectId = computed(() => props.id ?? generatedId);
const messageId = computed(() => `${selectId.value}-message`);
const hasMessage = computed(() => Boolean(props.error || props.hint));
</script>

<template>
  <div>
    <label v-if="props.label" :for="selectId" class="mb-1.5 block text-sm font-medium">
      {{ props.label }}
      <span v-if="props.required" class="text-danger" aria-hidden="true">*</span>
    </label>

    <div class="relative">
      <select
        v-bind="$attrs"
        :id="selectId"
        v-model="model"
        :required="props.required"
        :disabled="props.disabled"
        :aria-invalid="props.error ? 'true' : undefined"
        :aria-describedby="hasMessage ? messageId : undefined"
        class="form-control appearance-none pr-9"
        :class="{ 'text-fg-muted': model === '' }"
      >
        <option v-if="props.placeholder" value="" disabled>{{ props.placeholder }}</option>
        <option
          v-for="option in props.options"
          :key="option.value"
          :value="option.value"
          :disabled="option.disabled"
        >
          {{ option.label }}
        </option>
      </select>
      <ChevronDown
        class="text-fg-muted pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
        aria-hidden="true"
      />
    </div>

    <p
      v-if="hasMessage"
      :id="messageId"
      class="mt-1.5 text-xs"
      :class="props.error ? 'text-danger' : 'text-fg-muted'"
      :role="props.error ? 'alert' : undefined"
    >
      {{ props.error || props.hint }}
    </p>
  </div>
</template>
