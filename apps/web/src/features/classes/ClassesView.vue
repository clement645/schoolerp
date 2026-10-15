<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { Pencil, Plus, School, Trash2, TriangleAlert } from '@lucide/vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { gradingApi } from '@/features/school-config/config.service';
import { subjectsApi } from '@/features/subjects/subjects.service';
import { errorMessage } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import ClassFormModal from './ClassFormModal.vue';
import ClassSubjectsModal from './ClassSubjectsModal.vue';
import StreamFormModal from './StreamFormModal.vue';
import { classesApi, type SchoolClass, type Stream } from './classes.service';

const auth = useAuthStore();
const canManage = computed(() => auth.can('classes:manage'));

const classes = useQuery({ queryKey: useSchoolQueryKey('classes'), queryFn: classesApi.list });
const schemes = useQuery({
  queryKey: useSchoolQueryKey('grading-schemes'),
  queryFn: gradingApi.list,
  enabled: canManage,
});
const subjects = useQuery({
  queryKey: useSchoolQueryKey('subjects'),
  queryFn: subjectsApi.list,
  enabled: computed(() => canManage.value && auth.can('subjects:read')),
});

// Which dialog is open, and for which class or stream.
const classFormOpen = ref(false);
const streamFormOpen = ref(false);
const subjectsOpen = ref(false);
const activeClass = ref<SchoolClass | null>(null);
const activeStream = ref<Stream | null>(null);

function openClassForm(schoolClass: SchoolClass | null): void {
  activeClass.value = schoolClass;
  classFormOpen.value = true;
}
function openStreamForm(schoolClass: SchoolClass, stream: Stream | null): void {
  activeClass.value = schoolClass;
  activeStream.value = stream;
  streamFormOpen.value = true;
}
function openSubjects(schoolClass: SchoolClass): void {
  activeClass.value = schoolClass;
  subjectsOpen.value = true;
}

type Removal = { kind: 'class'; item: SchoolClass } | { kind: 'stream'; item: Stream };
const removing = ref<Removal | null>(null);
const remove = useSaveAction((target: Removal) =>
  target.kind === 'class'
    ? classesApi.delete(target.item.id)
    : classesApi.deleteStream(target.item.id),
);

function askToRemove(target: Removal): void {
  remove.reset();
  removing.value = target;
}
async function confirmRemove(): Promise<void> {
  if (removing.value && (await remove.run(removing.value))) removing.value = null;
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1>Classes</h1>
        <p class="text-fg-muted mt-1 text-sm">
          Classes, their streams, and the subjects taught in each.
        </p>
      </div>
      <AppButton v-if="canManage" @click="openClassForm(null)">
        <template #icon><Plus class="size-4" aria-hidden="true" /></template>
        Add class
      </AppButton>
    </header>

    <div v-if="classes.isPending.value" class="grid gap-4 lg:grid-cols-2" aria-busy="true">
      <AppCard v-for="n in 4" :key="n">
        <div class="space-y-3">
          <AppSkeleton width="40%" height="1.25rem" />
          <AppSkeleton width="70%" />
          <AppSkeleton width="55%" />
        </div>
      </AppCard>
    </div>

    <AppCard v-else-if="classes.isError.value">
      <AppEmptyState
        tone="danger"
        :icon="TriangleAlert"
        title="Unable to load classes"
        :description="errorMessage(classes.error.value)"
        role="alert"
      >
        <AppButton size="sm" variant="outline" @click="classes.refetch()">Try again</AppButton>
      </AppEmptyState>
    </AppCard>

    <AppCard v-else-if="classes.data.value?.length === 0">
      <AppEmptyState
        :icon="School"
        title="No classes yet"
        :description="
          canManage ? 'Add your first class, then give it streams and subjects.' : undefined
        "
      >
        <AppButton v-if="canManage" size="sm" @click="openClassForm(null)">Add class</AppButton>
      </AppEmptyState>
    </AppCard>

    <div v-else class="grid gap-4 lg:grid-cols-2">
      <AppCard
        v-for="schoolClass in classes.data.value"
        :key="schoolClass.id"
        :data-testid="`class-${schoolClass.name}`"
      >
        <template #header>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-base leading-tight">{{ schoolClass.name }}</h2>
              <AppBadge v-if="!schoolClass.isActive">Inactive</AppBadge>
            </div>
            <p class="text-fg-muted mt-0.5 text-sm">
              Level {{ schoolClass.level }} ·
              {{ schoolClass.gradingScheme?.name ?? 'School default grading' }}
            </p>
          </div>
        </template>
        <template v-if="canManage" #actions>
          <AppButton
            variant="outline"
            size="sm"
            :aria-label="`Edit ${schoolClass.name}`"
            @click="openClassForm(schoolClass)"
          >
            Edit
          </AppButton>
          <AppButton
            variant="ghost"
            size="sm"
            :aria-label="`Delete ${schoolClass.name}`"
            @click="askToRemove({ kind: 'class', item: schoolClass })"
          >
            Delete
          </AppButton>
        </template>

        <section>
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-fg-muted text-xs font-semibold tracking-wide uppercase">Streams</h3>
            <AppButton
              v-if="canManage"
              variant="ghost"
              size="sm"
              :aria-label="`Add stream to ${schoolClass.name}`"
              @click="openStreamForm(schoolClass, null)"
            >
              <template #icon><Plus class="size-3.5" aria-hidden="true" /></template>
              Add stream
            </AppButton>
          </div>
          <p v-if="schoolClass.streams.length === 0" class="text-fg-muted mt-1 text-sm">
            No streams. Add one if the class is split into groups.
          </p>
          <ul v-else class="mt-2 flex flex-wrap gap-2">
            <li
              v-for="stream in schoolClass.streams"
              :key="stream.id"
              class="border-line bg-surface-muted flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-3 text-sm"
            >
              <span class="font-medium">{{ stream.name }}</span>
              <span v-if="stream.capacity" class="text-fg-muted text-xs">
                · {{ stream.capacity }} places
              </span>
              <template v-if="canManage">
                <button
                  type="button"
                  class="text-fg-muted hover:bg-fg/10 hover:text-fg focus-visible:outline-primary rounded-full p-1 focus-visible:outline-2"
                  :aria-label="`Edit stream ${stream.name} of ${schoolClass.name}`"
                  @click="openStreamForm(schoolClass, stream)"
                >
                  <Pencil class="size-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="text-fg-muted hover:bg-danger/10 hover:text-danger focus-visible:outline-danger rounded-full p-1 focus-visible:outline-2"
                  :aria-label="`Delete stream ${stream.name} of ${schoolClass.name}`"
                  @click="askToRemove({ kind: 'stream', item: stream })"
                >
                  <Trash2 class="size-3.5" aria-hidden="true" />
                </button>
              </template>
              <span v-else class="w-2" />
            </li>
          </ul>
        </section>

        <section class="border-line mt-4 border-t pt-4">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-fg-muted text-xs font-semibold tracking-wide uppercase">
              Subjects ({{ schoolClass.subjects.length }})
            </h3>
            <AppButton
              v-if="canManage && auth.can('subjects:read')"
              variant="ghost"
              size="sm"
              :aria-label="`Manage subjects of ${schoolClass.name}`"
              @click="openSubjects(schoolClass)"
            >
              Manage subjects
            </AppButton>
          </div>
          <p v-if="schoolClass.subjects.length === 0" class="text-fg-muted mt-1 text-sm">
            No subjects assigned yet.
          </p>
          <ul v-else class="mt-2 flex flex-wrap gap-1.5">
            <li v-for="subject in schoolClass.subjects" :key="subject.subjectId">
              <AppBadge
                :variant="subject.isCompulsory ? 'primary' : 'neutral'"
                :title="subject.isCompulsory ? 'Compulsory' : 'Elective'"
              >
                {{ subject.name }}<template v-if="!subject.isCompulsory"> · elective</template>
              </AppBadge>
            </li>
          </ul>
        </section>
      </AppCard>
    </div>

    <template v-if="canManage">
      <ClassFormModal
        v-model:open="classFormOpen"
        :school-class="activeClass"
        :schemes="schemes.data.value ?? []"
      />
      <StreamFormModal
        v-model:open="streamFormOpen"
        :school-class="activeClass"
        :stream="activeStream"
      />
      <ClassSubjectsModal
        v-model:open="subjectsOpen"
        :school-class="activeClass"
        :subjects="subjects.data.value ?? []"
      />
      <AppConfirmDialog
        :open="removing !== null"
        :title="removing?.kind === 'class' ? 'Delete class?' : 'Delete stream?'"
        confirm-label="Delete"
        tone="danger"
        :loading="remove.pending.value"
        :error="remove.error.value"
        @confirm="confirmRemove"
        @cancel="removing = null"
      >
        <strong>{{ removing?.item.name }}</strong> will be removed.
        <template v-if="removing?.kind === 'class'">
          A class that has streams or records cannot be deleted — mark it inactive instead.
        </template>
      </AppConfirmDialog>
    </template>
  </div>
</template>
