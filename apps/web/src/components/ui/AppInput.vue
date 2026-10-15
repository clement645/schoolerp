<script setup lang="ts">
import { computed, useId } from 'vue';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    label?: string;
    type?: 'text' | 'email' | 'password' | 'number' | 'search' | 'tel' | 'date' | 'url';
    placeholder?: string;
    hint?: string;
    /** Validation message; its presence marks the field invalid. */
    error?: string;
    required?: boolean;
    disabled?: boolean;
    id?: string;
  }>(),
  { type: 'text' },
);

const model = defineModel<string>({ default: '' });

const generatedId = useId();
const inputId = computed(() => props.id ?? generatedId);
const messageId = computed(() => `${inputId.value}-message`);
const hasMessage = computed(() => Boolean(props.error || props.hint));
</script>

<template>
  <div>
    <label v-if="props.label" :for="inputId" class="mb-1.5 block text-sm font-medium">
      {{ props.label }}
      <span v-if="props.required" class="text-danger" aria-hidden="true">*</span>
    </label>

    <div class="relative">
      <span
        v-if="$slots.leading"
        class="text-fg-muted pointer-events-none absolute inset-y-0 left-3 flex items-center"
      >
        <slot name="leading" />
      </span>
      <input
        v-bind="$attrs"
        :id="inputId"
        v-model="model"
        :type="props.type"
        :placeholder="props.placeholder"
        :required="props.required"
        :disabled="props.disabled"
        :aria-invalid="props.error ? 'true' : undefined"
        :aria-describedby="hasMessage ? messageId : undefined"
        class="form-control"
        :class="{ 'pl-9': $slots.leading }"
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
