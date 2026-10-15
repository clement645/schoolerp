<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Plus, Trash2 } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import { useSaveAction } from '@/composables/useSaveAction';
import {
  gradingApi,
  SCHEME_TEMPLATES,
  type GradingScheme,
  type GradingSchemeInput,
  type SchemeType,
} from './config.service';

const props = defineProps<{
  /** The scheme being edited, or `null` to create one. */
  scheme: GradingScheme | null;
}>();
const open = defineModel<boolean>('open', { required: true });

/** Editable row; numbers are kept as text while the user types. */
interface Row {
  key: number;
  label: string;
  descriptor: string;
  minScore: string;
  points: string;
}

const TYPE_OPTIONS = [
  { value: 'PERCENTAGE', label: 'Percentage — grades from a score' },
  { value: 'COMPETENCY', label: 'Competency-based — performance levels' },
];
const TEMPLATE_OPTIONS = [
  { value: 'blank', label: 'Start from scratch' },
  ...SCHEME_TEMPLATES.map((template) => ({ value: template.id, label: template.label })),
];

let nextKey = 0;
const toRow = (boundary?: GradingSchemeInput['boundaries'][number]): Row => ({
  key: (nextKey += 1),
  label: boundary?.label ?? '',
  descriptor: boundary?.descriptor ?? '',
  minScore: boundary?.minScore?.toString() ?? '',
  points: boundary?.points?.toString() ?? '',
});

const name = ref('');
const type = ref<SchemeType>('PERCENTAGE');
const description = ref('');
const template = ref('blank');
const rows = ref<Row[]>([]);
const problem = ref<string | null>(null);

const editing = computed(() => props.scheme !== null);
const isCompetency = computed(() => type.value === 'COMPETENCY');

function load(scheme: GradingSchemeInput | null): void {
  name.value = scheme?.name ?? '';
  type.value = scheme?.type ?? 'PERCENTAGE';
  description.value = scheme?.description ?? '';
  rows.value = scheme ? scheme.boundaries.map(toRow) : [toRow(), toRow()];
}

watch(open, (isOpen) => {
  if (!isOpen) return;
  save.reset();
  problem.value = null;
  template.value = 'blank';
  load(props.scheme);
});

watch(template, (id) => {
  if (editing.value) return;
  load(SCHEME_TEMPLATES.find((entry) => entry.id === id)?.scheme ?? null);
});

const NUMBER = /^\d{1,3}(\.\d{1,2})?$/;
const toNumber = (text: string): number | null => (text.trim() === '' ? null : Number(text));

/** Checks what the browser can; the server validates the scheme as a whole. */
function check(): string | null {
  if (name.value.trim().length < 2) return 'Enter a name for the grading scheme.';
  if (rows.value.length < 2) return 'A grading scheme needs at least 2 grades.';
  if (rows.value.some((row) => row.label.trim() === '')) return 'Every grade needs a label.';
  const numbers = rows.value.flatMap((row) => [row.minScore, row.points]);
  if (numbers.some((text) => text.trim() !== '' && !NUMBER.test(text.trim()))) {
    return 'Scores and points must be numbers with at most two decimal places.';
  }
  return null;
}

const save = useSaveAction(() => {
  const input: GradingSchemeInput = {
    name: name.value.trim(),
    type: type.value,
    description: description.value.trim() || null,
    boundaries: rows.value.map((row) => ({
      label: row.label.trim(),
      descriptor: row.descriptor.trim() || null,
      minScore: toNumber(row.minScore),
      points: toNumber(row.points),
    })),
  };
  return props.scheme ? gradingApi.replace(props.scheme.id, input) : gradingApi.create(input);
});

async function submit(): Promise<void> {
  problem.value = check();
  if (problem.value) return;
  if (await save.run()) open.value = false;
}
</script>

<template>
  <AppModal
    v-model:open="open"
    :title="editing ? 'Edit grading scheme' : 'Add grading scheme'"
    size="xl"
  >
    <form id="grading-scheme-form" class="space-y-5" novalidate @submit.prevent="submit">
      <AppAlert v-if="problem || save.error.value" data-testid="grading-form-error">
        {{ problem ?? save.error.value }}
      </AppAlert>

      <AppSelect
        v-if="!editing"
        v-model="template"
        :options="TEMPLATE_OPTIONS"
        label="Start from"
        hint="Templates are examples to adapt, not official standards."
      />

      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput
          v-model="name"
          label="Name"
          placeholder="e.g. Upper primary scale"
          autocomplete="off"
          data-autofocus
          required
        />
        <AppSelect v-model="type" :options="TYPE_OPTIONS" label="Type" required />
      </div>
      <AppInput v-model="description" label="Description" autocomplete="off" />

      <fieldset>
        <legend class="text-sm font-medium">{{ isCompetency ? 'Levels' : 'Grades' }}</legend>
        <p class="text-fg-muted mt-1 text-xs">
          <template v-if="isCompetency">
            Levels are awarded directly by the teacher. Minimum scores are optional: fill them in
            for every level, or leave them all blank.
          </template>
          <template v-else>
            Enter the lowest score that earns each grade. The next grade up sets its upper limit, so
            there can be no gaps. The lowest grade must start at 0.
          </template>
        </p>

        <div class="relative mt-3 overflow-x-auto">
          <table class="w-full min-w-[36rem] text-sm">
            <thead>
              <tr class="text-fg-muted text-left text-xs">
                <th scope="col" class="w-24 pr-2 pb-1.5 font-medium">Label</th>
                <th scope="col" class="pr-2 pb-1.5 font-medium">Descriptor</th>
                <th scope="col" class="w-28 pr-2 pb-1.5 font-medium">
                  Min. score{{ isCompetency ? ' (optional)' : '' }}
                </th>
                <th scope="col" class="w-24 pr-2 pb-1.5 font-medium">Points</th>
                <th scope="col" class="w-10 pb-1.5"><span class="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in rows" :key="row.key" data-testid="grade-row">
                <td class="py-1 pr-2">
                  <input
                    v-model="row.label"
                    class="form-control"
                    maxlength="10"
                    :aria-label="`Label of grade ${index + 1}`"
                  />
                </td>
                <td class="py-1 pr-2">
                  <input
                    v-model="row.descriptor"
                    class="form-control"
                    maxlength="100"
                    :aria-label="`Descriptor of grade ${index + 1}`"
                  />
                </td>
                <td class="py-1 pr-2">
                  <input
                    v-model="row.minScore"
                    class="form-control"
                    inputmode="decimal"
                    :aria-label="`Minimum score of grade ${index + 1}`"
                  />
                </td>
                <td class="py-1 pr-2">
                  <input
                    v-model="row.points"
                    class="form-control"
                    inputmode="decimal"
                    :aria-label="`Points of grade ${index + 1}`"
                  />
                </td>
                <td class="py-1">
                  <button
                    type="button"
                    class="text-fg-muted hover:bg-danger/10 hover:text-danger focus-visible:outline-danger rounded-control flex size-10 items-center justify-center focus-visible:outline-2 disabled:opacity-40"
                    :disabled="rows.length <= 2"
                    :aria-label="`Remove grade ${index + 1}`"
                    @click="rows.splice(index, 1)"
                  >
                    <Trash2 class="size-4" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <AppButton
          class="mt-2"
          variant="ghost"
          size="sm"
          :disabled="rows.length >= 30"
          @click="rows.push(toRow())"
        >
          <template #icon><Plus class="size-3.5" aria-hidden="true" /></template>
          Add {{ isCompetency ? 'level' : 'grade' }}
        </AppButton>
      </fieldset>
    </form>

    <template #footer>
      <AppButton variant="outline" :disabled="save.pending.value" @click="open = false">
        Cancel
      </AppButton>
      <AppButton type="submit" form="grading-scheme-form" :loading="save.pending.value">
        {{ editing ? 'Save changes' : 'Add grading scheme' }}
      </AppButton>
    </template>
  </AppModal>
</template>
