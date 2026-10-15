<script setup lang="ts">
import { ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { Award, Plus, TriangleAlert } from '@lucide/vue';
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
import GradingSchemeModal from './GradingSchemeModal.vue';
import { describeRange, gradingApi, type GradingScheme } from './config.service';

const props = defineProps<{ canManage: boolean }>();

const schemes = useQuery({
  queryKey: useSchoolQueryKey('grading-schemes'),
  queryFn: gradingApi.list,
});

const formOpen = ref(false);
const editing = ref<GradingScheme | null>(null);
function openForm(scheme: GradingScheme | null): void {
  editing.value = scheme;
  formOpen.value = true;
}

const makeDefault = useSaveAction((scheme: GradingScheme) => gradingApi.setDefault(scheme.id));

const deleting = ref<GradingScheme | null>(null);
const remove = useSaveAction((scheme: GradingScheme) => gradingApi.delete(scheme.id));
function askToDelete(scheme: GradingScheme): void {
  remove.reset();
  deleting.value = scheme;
}
async function confirmDelete(): Promise<void> {
  if (deleting.value && (await remove.run(deleting.value))) deleting.value = null;
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-fg-muted max-w-2xl text-sm">
        How marks become grades. The default scheme applies to every class that has not been given
        its own on the Classes page.
      </p>
      <AppButton v-if="props.canManage" @click="openForm(null)">
        <template #icon><Plus class="size-4" aria-hidden="true" /></template>
        Add grading scheme
      </AppButton>
    </div>

    <AppAlert v-if="makeDefault.error.value">{{ makeDefault.error.value }}</AppAlert>

    <AppCard v-if="schemes.isPending.value" aria-busy="true">
      <div class="space-y-3">
        <AppSkeleton width="30%" height="1.25rem" />
        <AppSkeleton v-for="n in 4" :key="n" />
      </div>
    </AppCard>

    <AppCard v-else-if="schemes.isError.value">
      <AppEmptyState
        tone="danger"
        :icon="TriangleAlert"
        title="Unable to load grading schemes"
        :description="errorMessage(schemes.error.value)"
        role="alert"
      >
        <AppButton size="sm" variant="outline" @click="schemes.refetch()">Try again</AppButton>
      </AppEmptyState>
    </AppCard>

    <AppCard v-else-if="schemes.data.value?.length === 0">
      <AppEmptyState
        :icon="Award"
        title="No grading schemes yet"
        :description="
          props.canManage
            ? 'Add a scheme so that marks can be turned into grades.'
            : 'An administrator has not set up grading yet.'
        "
      />
    </AppCard>

    <div v-else class="grid gap-4 xl:grid-cols-2">
      <AppCard
        v-for="scheme in schemes.data.value"
        :key="scheme.id"
        flush
        :data-testid="`scheme-${scheme.name}`"
      >
        <template #header>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-base leading-tight">{{ scheme.name }}</h2>
              <AppBadge v-if="scheme.isDefault" variant="success" dot>Default</AppBadge>
              <AppBadge :variant="scheme.type === 'COMPETENCY' ? 'info' : 'neutral'">
                {{ scheme.type === 'COMPETENCY' ? 'Competency-based' : 'Percentage' }}
              </AppBadge>
            </div>
            <p class="text-fg-muted mt-0.5 text-sm">
              {{ scheme.description ?? '' }}
              <template v-if="scheme.classCount > 0">
                Assigned to {{ scheme.classCount }}
                {{ scheme.classCount === 1 ? 'class' : 'classes' }}.
              </template>
            </p>
          </div>
        </template>
        <template v-if="props.canManage" #actions>
          <AppButton
            v-if="!scheme.isDefault"
            variant="outline"
            size="sm"
            :disabled="makeDefault.pending.value"
            :aria-label="`Make ${scheme.name} the default`"
            @click="makeDefault.run(scheme)"
          >
            Make default
          </AppButton>
          <AppButton
            variant="outline"
            size="sm"
            :aria-label="`Edit ${scheme.name}`"
            @click="openForm(scheme)"
          >
            Edit
          </AppButton>
          <AppButton
            variant="ghost"
            size="sm"
            :aria-label="`Delete ${scheme.name}`"
            @click="askToDelete(scheme)"
          >
            Delete
          </AppButton>
        </template>

        <div class="relative overflow-x-auto">
          <table class="w-full text-sm">
            <caption class="sr-only">
              Grades of
              {{
                scheme.name
              }}
            </caption>
            <thead>
              <tr class="border-line bg-surface-muted text-fg-muted border-b text-left text-xs">
                <th scope="col" class="px-5 py-2 font-semibold uppercase">Grade</th>
                <th scope="col" class="px-3 py-2 font-semibold uppercase">Descriptor</th>
                <th scope="col" class="px-3 py-2 font-semibold uppercase">Score</th>
                <th scope="col" class="px-5 py-2 text-right font-semibold uppercase">Points</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="boundary in scheme.boundaries"
                :key="boundary.id"
                class="border-line border-b last:border-b-0"
              >
                <td class="px-5 py-2 font-semibold">{{ boundary.label }}</td>
                <td class="text-fg-muted px-3 py-2">{{ boundary.descriptor ?? '—' }}</td>
                <td class="px-3 py-2 whitespace-nowrap tabular-nums">
                  {{ describeRange(boundary) }}
                </td>
                <td class="px-5 py-2 text-right tabular-nums">{{ boundary.points ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </AppCard>
    </div>

    <template v-if="props.canManage">
      <GradingSchemeModal v-model:open="formOpen" :scheme="editing" />
      <AppConfirmDialog
        :open="deleting !== null"
        title="Delete grading scheme?"
        confirm-label="Delete"
        tone="danger"
        :loading="remove.pending.value"
        :error="remove.error.value"
        @confirm="confirmDelete"
        @cancel="deleting = null"
      >
        <strong>{{ deleting?.name }}</strong> will be removed. A scheme assigned to a class cannot
        be deleted.
      </AppConfirmDialog>
    </template>
  </div>
</template>
