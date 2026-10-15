<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { ChevronLeft, Phone, Plus, TriangleAlert, UserRound } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import AppTabs from '@/components/ui/AppTabs.vue';
import ImageUpload from '@/components/ui/ImageUpload.vue';
import { useAuthorizedImage } from '@/composables/useAuthorizedImage';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { ApiRequestError, errorMessage } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import { ageOn, formatDate } from '@/utils/format';
import GuardianModal from './GuardianModal.vue';
import PlacementModal, { type PlacementMode } from './PlacementModal.vue';
import PortalAccountsPanel from '@/features/portal/PortalAccountsPanel.vue';
import StudentDocumentsPanel from './StudentDocumentsPanel.vue';
import StudentFormModal from './StudentFormModal.vue';
import {
  ENROLLMENT_REASONS,
  fullName,
  GENDER_LABELS,
  hasLeft,
  RELATIONSHIP_OPTIONS,
  STATUS_LABELS,
  STATUS_VARIANTS,
  studentsApi,
  type Guardian,
  type StudentDetail,
} from './students.service';

const auth = useAuthStore();
const route = useRoute();
const queryClient = useQueryClient();

const canManage = computed(() => auth.can('students:manage'));
// Personal documents need their own permission; teachers do not have it.
const canSeeDocuments = computed(() => auth.can('students:documents'));
const tabs = computed(() => [
  { id: 'details', label: 'Details' },
  { id: 'guardians', label: 'Guardians' },
  { id: 'history', label: 'Enrolment history' },
  ...(canSeeDocuments.value ? [{ id: 'documents', label: 'Documents' }] : []),
  ...(auth.can('users:read') ? [{ id: 'portal', label: 'Portal access' }] : []),
]);
const studentId = computed(() => String(route.params.id));
const queryKey = useSchoolQueryKey('students', 'detail', studentId);

const student = useQuery({
  queryKey,
  queryFn: () => studentsApi.get(studentId.value),
});
const notFound = computed(
  () => student.error.value instanceof ApiRequestError && student.error.value.status === 404,
);

/** Dialogs return the updated student, which replaces the cached one at once. */
function apply(updated: StudentDetail): void {
  queryClient.setQueryData(queryKey.value, updated);
}

// Bumped after each change so the photo is fetched again rather than reused.
const photoVersion = ref(0);
const photo = useAuthorizedImage(() =>
  student.data.value?.hasPhoto
    ? `/students/${studentId.value}/photo?v=${photoVersion.value}`
    : null,
);
const savePhoto = useSaveAction(async (file: File | null) => {
  if (file) await studentsApi.setPhoto(studentId.value, file);
  else await studentsApi.removePhoto(studentId.value);
  photoVersion.value += 1;
});

const tab = ref('details');
const editing = ref(false);
const placementOpen = ref(false);
const placementMode = ref<PlacementMode>('transfer');
function openPlacement(mode: PlacementMode): void {
  placementMode.value = mode;
  placementOpen.value = true;
}

const guardianOpen = ref(false);
const activeGuardian = ref<Guardian | null>(null);
function openGuardian(guardian: Guardian | null): void {
  activeGuardian.value = guardian;
  guardianOpen.value = true;
}

const removing = ref<Guardian | null>(null);
const remove = useSaveAction(async (guardian: Guardian) => {
  apply(await studentsApi.removeGuardian(studentId.value, guardian.guardianId));
});
function askToRemove(guardian: Guardian): void {
  remove.reset();
  removing.value = guardian;
}
async function confirmRemove(): Promise<void> {
  if (removing.value && (await remove.run(removing.value))) removing.value = null;
}

const relationshipLabel = (value: string) =>
  RELATIONSHIP_OPTIONS.find((option) => option.value === value)?.label ?? value;
</script>

<template>
  <div class="space-y-6">
    <RouterLink
      :to="{ name: 'students' }"
      class="text-fg-muted hover:text-fg focus-visible:outline-primary inline-flex items-center gap-1 rounded text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <ChevronLeft class="size-4" aria-hidden="true" />
      Students
    </RouterLink>

    <AppCard v-if="student.isPending.value" aria-busy="true">
      <div class="flex items-center gap-4">
        <AppSkeleton circle width="3.5rem" height="3.5rem" />
        <div class="flex-1 space-y-2">
          <AppSkeleton width="40%" height="1.25rem" />
          <AppSkeleton width="25%" />
        </div>
      </div>
    </AppCard>

    <AppCard v-else-if="student.isError.value">
      <AppEmptyState
        tone="danger"
        :icon="TriangleAlert"
        :title="notFound ? 'Student not found' : 'Unable to load this student'"
        :description="
          notFound
            ? 'This student does not exist, or is not in a class you are assigned to.'
            : errorMessage(student.error.value)
        "
        role="alert"
      >
        <AppButton v-if="!notFound" size="sm" variant="outline" @click="student.refetch()">
          Try again
        </AppButton>
      </AppEmptyState>
    </AppCard>

    <template v-else-if="student.data.value">
      <AppCard>
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="flex min-w-0 items-center gap-4">
            <ImageUpload :src="photo" noun="photo" :placeholder="UserRound" />
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h1 class="text-xl">{{ fullName(student.data.value) }}</h1>
                <AppBadge :variant="STATUS_VARIANTS[student.data.value.status]" dot>
                  {{ STATUS_LABELS[student.data.value.status] }}
                </AppBadge>
              </div>
              <p class="text-fg-muted mt-1 text-sm">
                <code>{{ student.data.value.admissionNumber }}</code>
                <template v-if="student.data.value.class">
                  · {{ hasLeft(student.data.value.status) ? 'Last in' : '' }}
                  {{ student.data.value.class.name }} {{ student.data.value.stream?.name }}
                </template>
              </p>
            </div>
          </div>
          <div v-if="canManage" class="flex flex-wrap items-center gap-2">
            <AppButton variant="outline" size="sm" @click="editing = true">Edit</AppButton>
            <AppButton
              v-if="!hasLeft(student.data.value.status)"
              variant="outline"
              size="sm"
              @click="openPlacement('transfer')"
            >
              Move class
            </AppButton>
            <AppButton variant="outline" size="sm" @click="openPlacement('status')">
              {{ hasLeft(student.data.value.status) ? 'Re-admit' : 'Change status' }}
            </AppButton>
          </div>
        </div>
      </AppCard>

      <AppTabs v-model="tab" :tabs="tabs" label="Student record sections" />

      <section :id="`panel-${tab}`" role="tabpanel" :aria-labelledby="`tab-${tab}`">
        <div v-if="tab === 'details'" class="grid gap-6 lg:grid-cols-2">
          <AppCard title="Personal information">
            <dl class="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              <div>
                <dt class="text-fg-muted">Date of birth</dt>
                <dd class="mt-0.5 font-medium">
                  {{ formatDate(student.data.value.dateOfBirth) }}
                  <span class="text-fg-muted font-normal">
                    ({{ ageOn(student.data.value.dateOfBirth) }} years)
                  </span>
                </dd>
              </div>
              <div>
                <dt class="text-fg-muted">Gender</dt>
                <dd class="mt-0.5 font-medium">{{ GENDER_LABELS[student.data.value.gender] }}</dd>
              </div>
              <div>
                <dt class="text-fg-muted">Nationality</dt>
                <dd class="mt-0.5 font-medium">{{ student.data.value.nationality ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-fg-muted">Admission date</dt>
                <dd class="mt-0.5 font-medium">
                  {{ formatDate(student.data.value.admissionDate) }}
                </dd>
              </div>
              <template v-if="student.data.value.leftOn">
                <div>
                  <dt class="text-fg-muted">Left on</dt>
                  <dd class="mt-0.5 font-medium">{{ formatDate(student.data.value.leftOn) }}</dd>
                </div>
                <div>
                  <dt class="text-fg-muted">Reason</dt>
                  <dd class="mt-0.5 font-medium">{{ student.data.value.leavingReason ?? '—' }}</dd>
                </div>
              </template>
            </dl>
          </AppCard>

          <AppCard v-if="canManage" title="Photograph">
            <AppAlert v-if="savePhoto.error.value" class="mb-4" data-testid="photo-error">
              {{ savePhoto.error.value }}
            </AppAlert>
            <ImageUpload
              :src="photo"
              noun="photo"
              :placeholder="UserRound"
              size-class="size-20"
              can-manage
              :busy="savePhoto.pending.value"
              @select="savePhoto.run($event)"
              @remove="savePhoto.run(null)"
            />
          </AppCard>

          <AppCard title="Emergency contact">
            <p v-if="!student.data.value.emergencyContactName" class="text-fg-muted text-sm">
              No emergency contact recorded.
            </p>
            <dl v-else class="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              <div>
                <dt class="text-fg-muted">Name</dt>
                <dd class="mt-0.5 font-medium">{{ student.data.value.emergencyContactName }}</dd>
              </div>
              <div>
                <dt class="text-fg-muted">Relationship</dt>
                <dd class="mt-0.5 font-medium">
                  {{ student.data.value.emergencyContactRelationship ?? '—' }}
                </dd>
              </div>
              <div>
                <dt class="text-fg-muted">Phone</dt>
                <dd class="mt-0.5 font-medium">
                  {{ student.data.value.emergencyContactPhone ?? '—' }}
                </dd>
              </div>
            </dl>
          </AppCard>
        </div>

        <AppCard v-else-if="tab === 'guardians'" title="Parents and guardians" flush>
          <template v-if="canManage" #actions>
            <AppButton size="sm" @click="openGuardian(null)">
              <template #icon><Plus class="size-3.5" aria-hidden="true" /></template>
              Add guardian
            </AppButton>
          </template>
          <AppEmptyState
            v-if="student.data.value.guardians.length === 0"
            title="No guardians recorded"
            description="Add a parent or guardian so the school knows who to contact."
          />
          <ul v-else class="divide-line divide-y">
            <li
              v-for="guardian in student.data.value.guardians"
              :key="guardian.guardianId"
              class="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
            >
              <div class="min-w-0 text-sm">
                <p class="flex flex-wrap items-center gap-2 font-medium">
                  {{ guardian.firstName }} {{ guardian.lastName }}
                  <AppBadge>{{ relationshipLabel(guardian.relationship) }}</AppBadge>
                  <AppBadge v-if="guardian.isPrimary" variant="primary">Primary contact</AppBadge>
                </p>
                <p class="text-fg-muted mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span class="inline-flex items-center gap-1">
                    <Phone class="size-3.5" aria-hidden="true" />{{ guardian.phone }}
                  </span>
                  <span v-if="guardian.email">{{ guardian.email }}</span>
                  <span v-if="guardian.occupation">{{ guardian.occupation }}</span>
                </p>
                <p v-if="guardian.address" class="text-fg-muted mt-0.5">{{ guardian.address }}</p>
              </div>
              <div v-if="canManage" class="flex gap-2">
                <AppButton
                  variant="outline"
                  size="sm"
                  :aria-label="`Edit ${guardian.firstName} ${guardian.lastName}`"
                  @click="openGuardian(guardian)"
                >
                  Edit
                </AppButton>
                <AppButton
                  variant="ghost"
                  size="sm"
                  :aria-label="`Remove ${guardian.firstName} ${guardian.lastName}`"
                  @click="askToRemove(guardian)"
                >
                  Remove
                </AppButton>
              </div>
            </li>
          </ul>
        </AppCard>

        <PortalAccountsPanel
          v-else-if="tab === 'portal'"
          :student-id="studentId"
          :can-manage="canManage && auth.can('users:manage')"
        />

        <StudentDocumentsPanel
          v-else-if="tab === 'documents'"
          :student-id="studentId"
          :can-manage="canManage"
        />

        <AppCard
          v-else
          title="Enrolment history"
          subtitle="Every class the student has been placed in."
          flush
        >
          <div class="relative overflow-x-auto">
            <table class="w-full min-w-max text-sm">
              <caption class="sr-only">
                Enrolment history
              </caption>
              <thead>
                <tr
                  class="border-line bg-surface-muted text-fg-muted border-b text-left text-xs uppercase"
                >
                  <th scope="col" class="px-5 py-2.5 font-semibold">Academic year</th>
                  <th scope="col" class="px-3 py-2.5 font-semibold">Class</th>
                  <th scope="col" class="px-3 py-2.5 font-semibold">How</th>
                  <th scope="col" class="px-3 py-2.5 font-semibold">From</th>
                  <th scope="col" class="px-5 py-2.5 font-semibold">To</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="enrollment in student.data.value.enrollments"
                  :key="enrollment.id"
                  class="border-line border-b last:border-b-0"
                >
                  <td class="px-5 py-2.5 font-medium">{{ enrollment.academicYear.name }}</td>
                  <td class="px-3 py-2.5">
                    {{ enrollment.class.name }}
                    <span class="text-fg-muted">{{ enrollment.stream?.name }}</span>
                  </td>
                  <td class="text-fg-muted px-3 py-2.5">
                    {{ ENROLLMENT_REASONS[enrollment.reason] ?? enrollment.reason }}
                  </td>
                  <td class="px-3 py-2.5 whitespace-nowrap tabular-nums">
                    {{ formatDate(enrollment.startDate) }}
                  </td>
                  <td class="px-5 py-2.5 whitespace-nowrap tabular-nums">
                    <AppBadge v-if="!enrollment.endDate" variant="success" dot>Current</AppBadge>
                    <template v-else>{{ formatDate(enrollment.endDate) }}</template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </AppCard>
      </section>

      <template v-if="canManage">
        <StudentFormModal v-model:open="editing" :student="student.data.value" @saved="apply" />
        <PlacementModal
          v-model:open="placementOpen"
          :student="student.data.value"
          :mode="placementMode"
          @saved="apply"
        />
        <GuardianModal
          v-model:open="guardianOpen"
          :student="student.data.value"
          :guardian="activeGuardian"
          @saved="apply"
        />
        <AppConfirmDialog
          :open="removing !== null"
          title="Remove guardian?"
          confirm-label="Remove"
          tone="danger"
          :loading="remove.pending.value"
          :error="remove.error.value"
          @confirm="confirmRemove"
          @cancel="removing = null"
        >
          <strong>{{ removing?.firstName }} {{ removing?.lastName }}</strong> will no longer be
          linked to this student. They stay on record for any other children at the school.
        </AppConfirmDialog>
      </template>
    </template>
  </div>
</template>
