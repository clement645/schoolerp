<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { ChevronLeft, Plus, TriangleAlert, UserRound } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { GENDER_LABELS } from '@/features/students/students.service';
import { ApiRequestError, errorMessage } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import { formatDate } from '@/utils/format';
import AssignmentModal from './AssignmentModal.vue';
import TeacherFormModal from './TeacherFormModal.vue';
import {
  placementLabel,
  teachersApi,
  type Assignment,
  type TeacherDetail,
} from './teachers.service';

const auth = useAuthStore();
const route = useRoute();
const queryClient = useQueryClient();

const canManage = computed(() => auth.can('teachers:manage'));
const teacherId = computed(() => String(route.params.id));
const queryKey = useSchoolQueryKey('teachers', 'detail', teacherId);

const teacher = useQuery({ queryKey, queryFn: () => teachersApi.get(teacherId.value) });
const notFound = computed(
  () => teacher.error.value instanceof ApiRequestError && teacher.error.value.status === 404,
);
function apply(updated: TeacherDetail): void {
  queryClient.setQueryData(queryKey.value, updated);
}

/** Assignments grouped by academic year, current year first. */
const byYear = computed(() => {
  const groups = new Map<string, { name: string; isCurrent: boolean; items: Assignment[] }>();
  for (const assignment of teacher.data.value?.assignments ?? []) {
    const { id, name, isCurrent } = assignment.academicYear;
    const group = groups.get(id) ?? { name, isCurrent, items: [] };
    group.items.push(assignment);
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
});

const editing = ref(false);
const assigning = ref(false);

const removing = ref<Assignment | null>(null);
const remove = useSaveAction(async (assignment: Assignment) => {
  apply(await teachersApi.removeAssignment(teacherId.value, assignment.id));
});
function askToRemove(assignment: Assignment): void {
  remove.reset();
  removing.value = assignment;
}
async function confirmRemove(): Promise<void> {
  if (removing.value && (await remove.run(removing.value))) removing.value = null;
}

const describe = (assignment: Assignment): string =>
  assignment.kind === 'CLASS_TEACHER'
    ? `Class teacher of ${placementLabel(assignment)}`
    : `${assignment.subject?.name ?? 'Subject'} — ${placementLabel(assignment)}`;
</script>

<template>
  <div class="space-y-6">
    <RouterLink
      :to="{ name: 'teachers' }"
      class="text-fg-muted hover:text-fg focus-visible:outline-primary inline-flex items-center gap-1 rounded text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <ChevronLeft class="size-4" aria-hidden="true" />
      Teachers
    </RouterLink>

    <AppCard v-if="teacher.isPending.value" aria-busy="true">
      <div class="flex items-center gap-4">
        <AppSkeleton circle width="3.5rem" height="3.5rem" />
        <div class="flex-1 space-y-2">
          <AppSkeleton width="40%" height="1.25rem" />
          <AppSkeleton width="25%" />
        </div>
      </div>
    </AppCard>

    <AppCard v-else-if="teacher.isError.value">
      <AppEmptyState
        tone="danger"
        :icon="TriangleAlert"
        :title="notFound ? 'Teacher not found' : 'Unable to load this teacher'"
        :description="notFound ? undefined : errorMessage(teacher.error.value)"
        role="alert"
      >
        <AppButton v-if="!notFound" size="sm" variant="outline" @click="teacher.refetch()">
          Try again
        </AppButton>
      </AppEmptyState>
    </AppCard>

    <template v-else-if="teacher.data.value">
      <AppCard>
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="flex min-w-0 items-center gap-4">
            <span
              class="bg-primary-light text-primary flex size-14 shrink-0 items-center justify-center rounded-full"
            >
              <UserRound class="size-7" aria-hidden="true" />
            </span>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h1 class="text-xl">
                  {{ teacher.data.value.firstName }} {{ teacher.data.value.lastName }}
                </h1>
                <AppBadge
                  :variant="teacher.data.value.status === 'ACTIVE' ? 'success' : 'neutral'"
                  dot
                >
                  {{ teacher.data.value.status === 'ACTIVE' ? 'Active' : 'Inactive' }}
                </AppBadge>
              </div>
              <p class="text-fg-muted mt-1 text-sm">
                <code>{{ teacher.data.value.staffNumber }}</code>
              </p>
            </div>
          </div>
          <AppButton v-if="canManage" variant="outline" size="sm" @click="editing = true">
            Edit
          </AppButton>
        </div>
      </AppCard>

      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <AppCard title="Staff details">
          <dl class="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <div>
              <dt class="text-fg-muted">Phone</dt>
              <dd class="mt-0.5 font-medium">{{ teacher.data.value.phone ?? '—' }}</dd>
            </div>
            <div>
              <dt class="text-fg-muted">Email</dt>
              <dd class="mt-0.5 font-medium break-all">{{ teacher.data.value.email ?? '—' }}</dd>
            </div>
            <div>
              <dt class="text-fg-muted">Gender</dt>
              <dd class="mt-0.5 font-medium">
                {{ teacher.data.value.gender ? GENDER_LABELS[teacher.data.value.gender] : '—' }}
              </dd>
            </div>
            <div>
              <dt class="text-fg-muted">Registration number</dt>
              <dd class="mt-0.5 font-medium">{{ teacher.data.value.registrationNumber ?? '—' }}</dd>
            </div>
            <div>
              <dt class="text-fg-muted">Employed since</dt>
              <dd class="mt-0.5 font-medium">
                {{ formatDate(teacher.data.value.employmentDate) }}
              </dd>
            </div>
            <div>
              <dt class="text-fg-muted">Login account</dt>
              <dd class="mt-0.5 font-medium break-all">
                {{ teacher.data.value.user?.email ?? 'Not linked' }}
              </dd>
            </div>
          </dl>
          <AppAlert v-if="!teacher.data.value.user" tone="info" class="mt-5">
            Without a linked login account this teacher cannot sign in to see their classes.
          </AppAlert>
        </AppCard>

        <AppCard title="Assignments" subtitle="What this teacher teaches, and where." flush>
          <template v-if="canManage && teacher.data.value.status === 'ACTIVE'" #actions>
            <AppButton size="sm" @click="assigning = true">
              <template #icon><Plus class="size-3.5" aria-hidden="true" /></template>
              Add assignment
            </AppButton>
          </template>

          <AppEmptyState
            v-if="byYear.length === 0"
            title="No assignments yet"
            description="Assign a subject and class so this teacher can see their students."
          />
          <template v-else>
            <div v-for="group in byYear" :key="group.name">
              <h3
                class="bg-surface-muted border-line text-fg-muted flex items-center gap-2 border-b px-5 py-2 text-xs font-semibold tracking-wide uppercase"
              >
                {{ group.name }}
                <AppBadge v-if="group.isCurrent" variant="success">Current</AppBadge>
              </h3>
              <ul class="divide-line divide-y">
                <li
                  v-for="assignment in group.items"
                  :key="assignment.id"
                  class="flex items-center justify-between gap-3 px-5 py-3 text-sm"
                >
                  <span class="flex min-w-0 flex-wrap items-center gap-2">
                    <AppBadge
                      :variant="assignment.kind === 'CLASS_TEACHER' ? 'primary' : 'neutral'"
                    >
                      {{ assignment.kind === 'CLASS_TEACHER' ? 'Class teacher' : 'Subject' }}
                    </AppBadge>
                    <span class="font-medium">
                      {{
                        assignment.kind === 'CLASS_TEACHER'
                          ? placementLabel(assignment)
                          : assignment.subject?.name
                      }}
                    </span>
                    <span v-if="assignment.kind === 'SUBJECT_TEACHER'" class="text-fg-muted">
                      {{ placementLabel(assignment) }}
                    </span>
                  </span>
                  <AppButton
                    v-if="canManage"
                    variant="ghost"
                    size="sm"
                    :aria-label="`Remove: ${describe(assignment)}`"
                    @click="askToRemove(assignment)"
                  >
                    Remove
                  </AppButton>
                </li>
              </ul>
            </div>
          </template>
        </AppCard>
      </div>

      <template v-if="canManage">
        <TeacherFormModal v-model:open="editing" :teacher="teacher.data.value" @saved="apply" />
        <AssignmentModal v-model:open="assigning" :teacher="teacher.data.value" @saved="apply" />
        <AppConfirmDialog
          :open="removing !== null"
          title="Remove assignment?"
          confirm-label="Remove"
          tone="danger"
          :loading="remove.pending.value"
          :error="remove.error.value"
          @confirm="confirmRemove"
          @cancel="removing = null"
        >
          <strong>{{ removing ? describe(removing) : '' }}</strong> will be removed. The teacher
          loses access to that class unless another assignment covers it.
        </AppConfirmDialog>
      </template>
    </template>
  </div>
</template>
