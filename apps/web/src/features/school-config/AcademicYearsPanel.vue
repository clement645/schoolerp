<script setup lang="ts">
import { ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { CalendarRange, Plus, TriangleAlert } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import PeriodFormModal, { type PeriodTarget } from './PeriodFormModal.vue';
import { academicsApi, type AcademicYear, type Term } from './config.service';

const props = defineProps<{ canManage: boolean }>();

const years = useQuery({
  queryKey: useSchoolQueryKey('academic-years'),
  queryFn: academicsApi.listYears,
});

const formOpen = ref(false);
const formTarget = ref<PeriodTarget | null>(null);
function openForm(target: PeriodTarget): void {
  formTarget.value = target;
  formOpen.value = true;
}

const makeCurrent = useSaveAction((target: { year: AcademicYear } | { term: Term }) =>
  'term' in target
    ? academicsApi.setCurrentTerm(target.term.id)
    : academicsApi.setCurrentYear(target.year.id),
);

type Removal = { kind: 'year'; item: AcademicYear } | { kind: 'term'; item: Term };
const removing = ref<Removal | null>(null);
const remove = useSaveAction((target: Removal) =>
  target.kind === 'year'
    ? academicsApi.deleteYear(target.item.id)
    : academicsApi.deleteTerm(target.item.id),
);
function askToRemove(target: Removal): void {
  remove.reset();
  removing.value = target;
}
async function confirmRemove(): Promise<void> {
  if (removing.value && (await remove.run(removing.value))) removing.value = null;
}

const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
const formatDate = (value: string) => date.format(new Date(`${value}T00:00:00Z`));
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-fg-muted max-w-2xl text-sm">
        Academic years and their terms. Examinations, attendance and fees are recorded against a
        term; the current term is the one selected by default across the application.
      </p>
      <AppButton v-if="props.canManage" @click="openForm({ kind: 'year', year: null })">
        <template #icon><Plus class="size-4" aria-hidden="true" /></template>
        Add academic year
      </AppButton>
    </div>

    <AppAlert v-if="makeCurrent.error.value" data-testid="set-current-error">
      {{ makeCurrent.error.value }}
    </AppAlert>

    <AppCard v-if="years.isPending.value" aria-busy="true">
      <div class="space-y-3">
        <AppSkeleton width="30%" height="1.25rem" />
        <AppSkeleton v-for="n in 3" :key="n" />
      </div>
    </AppCard>

    <AppCard v-else-if="years.isError.value">
      <AppEmptyState
        tone="danger"
        :icon="TriangleAlert"
        title="Unable to load academic years"
        :description="errorMessage(years.error.value)"
        role="alert"
      >
        <AppButton size="sm" variant="outline" @click="years.refetch()">Try again</AppButton>
      </AppEmptyState>
    </AppCard>

    <AppCard v-else-if="years.data.value?.length === 0">
      <AppEmptyState
        :icon="CalendarRange"
        title="No academic years yet"
        :description="
          props.canManage ? 'Add the academic year your school is currently in.' : undefined
        "
      />
    </AppCard>

    <template v-else>
      <AppCard
        v-for="year in years.data.value"
        :key="year.id"
        flush
        :data-testid="`year-${year.name}`"
      >
        <template #header>
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-base leading-tight">{{ year.name }}</h2>
              <AppBadge v-if="year.isCurrent" variant="success" dot>Current year</AppBadge>
            </div>
            <p class="text-fg-muted mt-0.5 text-sm">
              {{ formatDate(year.startDate) }} – {{ formatDate(year.endDate) }}
            </p>
          </div>
        </template>
        <template v-if="props.canManage" #actions>
          <AppButton
            v-if="!year.isCurrent"
            variant="outline"
            size="sm"
            :disabled="makeCurrent.pending.value"
            :aria-label="`Make ${year.name} the current year`"
            @click="makeCurrent.run({ year })"
          >
            Make current
          </AppButton>
          <AppButton
            variant="outline"
            size="sm"
            :aria-label="`Edit ${year.name}`"
            @click="openForm({ kind: 'year', year })"
          >
            Edit
          </AppButton>
          <AppButton
            variant="ghost"
            size="sm"
            :aria-label="`Delete ${year.name}`"
            @click="askToRemove({ kind: 'year', item: year })"
          >
            Delete
          </AppButton>
        </template>

        <p v-if="year.terms.length === 0" class="text-fg-muted px-5 py-4 text-sm">No terms yet.</p>
        <ul v-else class="divide-line divide-y">
          <li
            v-for="term in year.terms"
            :key="term.id"
            class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3"
          >
            <div class="min-w-0">
              <p class="flex flex-wrap items-center gap-2 text-sm font-medium">
                {{ term.name }}
                <AppBadge v-if="term.isCurrent" variant="success" dot>Current term</AppBadge>
              </p>
              <p class="text-fg-muted text-xs">
                {{ formatDate(term.startDate) }} – {{ formatDate(term.endDate) }}
              </p>
            </div>
            <div v-if="props.canManage" class="flex items-center gap-2">
              <AppButton
                v-if="!term.isCurrent"
                variant="outline"
                size="sm"
                :disabled="makeCurrent.pending.value"
                :aria-label="`Make ${term.name} of ${year.name} the current term`"
                @click="makeCurrent.run({ term })"
              >
                Make current
              </AppButton>
              <AppButton
                variant="outline"
                size="sm"
                :aria-label="`Edit ${term.name} of ${year.name}`"
                @click="openForm({ kind: 'term', year, term })"
              >
                Edit
              </AppButton>
              <AppButton
                variant="ghost"
                size="sm"
                :aria-label="`Delete ${term.name} of ${year.name}`"
                @click="askToRemove({ kind: 'term', item: term })"
              >
                Delete
              </AppButton>
            </div>
          </li>
        </ul>

        <template v-if="props.canManage" #footer>
          <AppButton
            variant="ghost"
            size="sm"
            :aria-label="`Add term to ${year.name}`"
            @click="openForm({ kind: 'term', year, term: null })"
          >
            <template #icon><Plus class="size-3.5" aria-hidden="true" /></template>
            Add term
          </AppButton>
        </template>
      </AppCard>
    </template>

    <template v-if="props.canManage">
      <PeriodFormModal v-model:open="formOpen" :target="formTarget" />
      <AppConfirmDialog
        :open="removing !== null"
        :title="removing?.kind === 'year' ? 'Delete academic year?' : 'Delete term?'"
        confirm-label="Delete"
        tone="danger"
        :loading="remove.pending.value"
        :error="remove.error.value"
        @confirm="confirmRemove"
        @cancel="removing = null"
      >
        <strong>{{ removing?.item.name }}</strong> will be removed.
        {{
          removing?.kind === 'year'
            ? 'A year that still has terms cannot be deleted.'
            : 'A term with records attached to it cannot be deleted.'
        }}
      </AppConfirmDialog>
    </template>
  </div>
</template>
