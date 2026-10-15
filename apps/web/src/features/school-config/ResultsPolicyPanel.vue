<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { policiesApi, type SchoolPolicies } from './config.service';

const props = defineProps<{ canManage: boolean }>();

const RANKING = [
  { value: 'COMPETITION', label: 'Skip positions after a tie (1, 2, 2, 4)' },
  { value: 'DENSE', label: 'Do not skip positions after a tie (1, 2, 2, 3)' },
];

const policies = useQuery({ queryKey: useSchoolQueryKey('policies'), queryFn: policiesApi.get });

const form = reactive({
  passMark: '50',
  rankingPolicy: 'COMPETITION',
  showClassPosition: true,
  showStreamPosition: true,
  currency: 'KES',
});
const passMarkError = ref('');
const currencyError = ref('');
const saved = ref(false);

function load(value: SchoolPolicies): void {
  form.passMark = String(value.passMark);
  form.rankingPolicy = value.rankingPolicy;
  form.showClassPosition = value.showClassPosition;
  form.showStreamPosition = value.showStreamPosition;
  form.currency = value.currency;
}
watch(
  () => policies.data.value,
  (value) => value && load(value),
  { immediate: true },
);

const save = useSaveAction(policiesApi.update);

async function submit(): Promise<void> {
  saved.value = false;
  // A number input hands back a number once edited, so normalise to text first.
  const entered = String(form.passMark).trim();
  const passMark = Number(entered);
  if (entered === '' || !Number.isFinite(passMark) || passMark < 0 || passMark > 100) {
    passMarkError.value = 'Enter a pass mark between 0 and 100.';
    return;
  }
  passMarkError.value = '';
  if (!/^[A-Za-z]{3}$/.test(form.currency.trim())) {
    currencyError.value = 'Enter a three-letter currency code.';
    return;
  }
  currencyError.value = '';
  saved.value = await save.run({
    passMark: Math.round(passMark * 100) / 100,
    rankingPolicy: form.rankingPolicy as SchoolPolicies['rankingPolicy'],
    showClassPosition: form.showClassPosition,
    showStreamPosition: form.showStreamPosition,
    currency: form.currency.trim().toUpperCase(),
  });
}
</script>

<template>
  <AppCard
    title="Results, report cards and currency"
    subtitle="Applied whenever an examination is compiled. Results already compiled keep the rules they were compiled under."
  >
    <AppAlert v-if="policies.isError.value">{{ errorMessage(policies.error.value) }}</AppAlert>
    <div v-else-if="policies.isPending.value" class="space-y-3" aria-busy="true">
      <AppSkeleton height="2.5rem" />
      <AppSkeleton height="2.5rem" />
    </div>
    <form v-else class="max-w-xl space-y-5" novalidate @submit.prevent="submit">
      <AppAlert v-if="save.error.value">{{ save.error.value }}</AppAlert>
      <AppAlert v-else-if="saved" tone="success">Policies saved.</AppAlert>

      <AppInput
        v-model="form.passMark"
        label="Pass mark (%)"
        type="number"
        inputmode="decimal"
        hint="A learner passes with an average at or above this. For competency levels, the upper half of levels count as a pass."
        :error="passMarkError"
        :disabled="!props.canManage"
        required
      />
      <AppSelect
        v-model="form.rankingPolicy"
        label="Positions when learners tie"
        :options="RANKING"
        :disabled="!props.canManage"
      />
      <fieldset class="space-y-2">
        <legend class="text-sm font-medium">Positions shown on report cards</legend>
        <label class="flex items-center gap-2 text-sm">
          <input
            v-model="form.showClassPosition"
            type="checkbox"
            class="accent-primary size-4"
            :disabled="!props.canManage"
          />
          Position in class
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input
            v-model="form.showStreamPosition"
            type="checkbox"
            class="accent-primary size-4"
            :disabled="!props.canManage"
          />
          Position in stream
        </label>
      </fieldset>

      <AppInput
        v-model="form.currency"
        label="Currency"
        hint="Three-letter code used for fees and payments, e.g. KES, UGX, USD."
        :error="currencyError"
        :disabled="!props.canManage"
        maxlength="3"
        required
      />

      <AppButton v-if="props.canManage" type="submit" :loading="save.pending.value">
        Save policies
      </AppButton>
    </form>
  </AppCard>
</template>
