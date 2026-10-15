<script setup lang="ts">
import { ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { FileStack, Plus } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import { useCurrency } from '@/composables/useCurrency';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { addDaysIso, todayIso } from '@/utils/format';
import FeeStructureModal from './FeeStructureModal.vue';
import { financeApi, type FeeStructure, type GenerationResult } from './finance.service';

const props = defineProps<{ canManage: boolean }>();
const { money } = useCurrency();

const structures = useQuery({
  queryKey: useSchoolQueryKey('finance', 'fee-structures'),
  queryFn: financeApi.feeStructures,
});

const editorOpen = ref(false);
const editing = ref<FeeStructure | null>(null);
function edit(structure: FeeStructure | null): void {
  editing.value = structure;
  editorOpen.value = true;
}

// ── Raising invoices ─────────────────────────────────────────────────────────
const generating = ref<FeeStructure | null>(null);
const generateOpen = ref(false);
const dueDate = ref('');
const dueError = ref('');
const outcome = ref<GenerationResult | null>(null);

function startGenerating(structure: FeeStructure): void {
  generating.value = structure;
  dueDate.value = addDaysIso(todayIso(), 30);
  dueError.value = '';
  outcome.value = null;
  generate.reset();
  generateOpen.value = true;
}
const generate = useSaveAction(async () => {
  outcome.value = await financeApi.generateInvoices(generating.value?.id ?? '', dueDate.value);
});
async function submitGenerate(): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate.value) || dueDate.value < todayIso()) {
    dueError.value = 'Choose a due date that is today or later.';
    return;
  }
  dueError.value = '';
  await generate.run();
}
</script>

<template>
  <div class="space-y-4">
    <div v-if="props.canManage" class="flex justify-end">
      <AppButton @click="edit(null)">
        <template #icon><Plus class="size-4" aria-hidden="true" /></template>
        New fee structure
      </AppButton>
    </div>

    <AppEmptyState
      v-if="structures.isError.value"
      tone="danger"
      title="Fee structures could not be loaded"
      :description="errorMessage(structures.error.value)"
    />
    <div v-else-if="structures.isPending.value" class="grid gap-4 lg:grid-cols-2" aria-busy="true">
      <AppSkeleton v-for="n in 2" :key="n" height="11rem" />
    </div>
    <AppEmptyState
      v-else-if="structures.data.value?.length === 0"
      :icon="FileStack"
      title="No fee structures yet"
      description="A fee structure sets what a class is charged for a term. Invoices are raised from it."
    />

    <div v-else class="grid gap-4 lg:grid-cols-2">
      <AppCard
        v-for="structure in structures.data.value"
        :key="structure.id"
        :title="structure.name"
        :subtitle="`${structure.term.name}, ${structure.term.academicYear} · ${structure.class?.name ?? 'Every class'}`"
      >
        <template #actions>
          <AppBadge :variant="structure.isActive ? 'success' : 'neutral'">
            {{ structure.isActive ? 'Active' : 'Inactive' }}
          </AppBadge>
        </template>
        <dl class="space-y-1.5 text-sm">
          <div v-for="line in structure.lines" :key="line.feeItemId" class="flex justify-between">
            <dt class="text-fg-muted">{{ line.feeItem }}</dt>
            <dd class="tabular-nums">{{ money(line.amount) }}</dd>
          </div>
          <div class="border-line flex justify-between border-t pt-2 font-semibold">
            <dt>Total per learner</dt>
            <dd class="tabular-nums">{{ money(structure.total) }}</dd>
          </div>
        </dl>
        <div class="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p class="text-fg-muted text-sm">
            {{ structure.invoiceCount }}
            {{ structure.invoiceCount === 1 ? 'invoice' : 'invoices' }} raised
          </p>
          <div v-if="props.canManage" class="flex gap-2">
            <AppButton variant="secondary" size="sm" @click="edit(structure)">Edit</AppButton>
            <AppButton
              size="sm"
              :disabled="!structure.isActive"
              @click="startGenerating(structure)"
            >
              Raise invoices
            </AppButton>
          </div>
        </div>
      </AppCard>
    </div>

    <FeeStructureModal v-model:open="editorOpen" :structure="editing" />

    <AppModal
      v-model:open="generateOpen"
      title="Raise invoices"
      :description="
        generating ? `${generating.name} · ${generating.class?.name ?? 'every class'}` : undefined
      "
    >
      <div v-if="outcome" class="space-y-3" data-testid="generation-outcome">
        <AppAlert tone="success" title="Invoices raised">
          {{ outcome.created }} {{ outcome.created === 1 ? 'invoice' : 'invoices' }} created,
          totalling {{ money(outcome.totalInvoiced) }}.
        </AppAlert>
        <p v-if="outcome.skipped" class="text-fg-muted text-sm">
          {{ outcome.skipped }}
          {{ outcome.skipped === 1 ? 'learner was' : 'learners were' }} skipped because they already
          hold an invoice for this fee structure.
        </p>
      </div>
      <form v-else id="generate-form" class="space-y-4" novalidate @submit.prevent="submitGenerate">
        <AppAlert v-if="generate.error.value">{{ generate.error.value }}</AppAlert>
        <p class="text-sm">
          Every active learner this structure applies to is invoiced
          <strong>{{ generating ? money(generating.total) : '' }}</strong
          >, less any discount or scholarship they hold. Learners already invoiced for it are
          skipped.
        </p>
        <AppInput v-model="dueDate" label="Due date" type="date" :error="dueError" required />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="generateOpen = false">
          {{ outcome ? 'Close' : 'Cancel' }}
        </AppButton>
        <AppButton
          v-if="!outcome"
          type="submit"
          form="generate-form"
          :loading="generate.pending.value"
        >
          Raise invoices
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>
