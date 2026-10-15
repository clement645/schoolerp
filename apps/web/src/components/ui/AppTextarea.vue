<script setup lang="ts">
import { computed, useId } from 'vue';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    label?: string;
    placeholder?: string;
    hint?: string;
    /** Validation message; its presence marks the field invalid. */
    error?: string;
    required?: boolean;
    disabled?: boolean;
    rows?: number;
    /** Longest text accepted; a running count is shown beside the hint. */
    maxLength?: number;
    id?: string;
  }>(),
  { rows: 3 },
);

const model = defineModel<string>({ default: '' });

const generatedId = useId();
const inputId = computed(() => props.id ?? generatedId);
const messageId = computed(() => `${inputId.value}-message`);
const hasMessage = computed(() => Boolean(props.error || props.hint || props.maxLength));
</script>

<template>
  <div>
    <label v-if="props.label" :for="inputId" class="mb-1.5 block text-sm font-medium">
      {{ props.label }}
      <span v-if="props.required" class="text-danger" aria-hidden="true">*</span>
    </label>
    <textarea
      v-bind="$attrs"
      :id="inputId"
      v-model="model"
      :rows="props.rows"
      :placeholder="props.placeholder"
      :required="props.required"
      :disabled="props.disabled"
      :maxlength="props.maxLength"
      :aria-invalid="props.error ? 'true' : undefined"
      :aria-describedby="hasMessage ? messageId : undefined"
      class="form-control h-auto resize-y py-2"
    />
    <p
      v-if="hasMessage"
      :id="messageId"
      class="mt-1.5 flex justify-between gap-3 text-xs"
      :class="props.error ? 'text-danger' : 'text-fg-muted'"
    >
      <span :role="props.error ? 'alert' : undefined">{{ props.error || props.hint }}</span>
      <span v-if="props.maxLength" class="shrink-0 tabular-nums">
        {{ model.length }}/{{ props.maxLength }}
      </span>
    </p>
  </div>
</template>
