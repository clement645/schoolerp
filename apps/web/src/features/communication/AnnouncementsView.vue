<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { Megaphone, Pin, Plus } from '@lucide/vue';
import AppAlert from '@/components/ui/AppAlert.vue';
import AppBadge from '@/components/ui/AppBadge.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCard from '@/components/ui/AppCard.vue';
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import AppTextarea from '@/components/ui/AppTextarea.vue';
import { useSaveAction } from '@/composables/useSaveAction';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import { formatDate, formatDateTime, todayIso } from '@/utils/format';
import {
  announcementsApi,
  audienceLabel,
  AUDIENCES,
  type Announcement,
  type Audience,
} from './communication.service';

const auth = useAuthStore();
const canManage = computed(() => auth.can('announcements:manage'));

const announcements = useQuery({
  queryKey: useSchoolQueryKey('announcements'),
  queryFn: announcementsApi.list,
});

const open = ref(false);
const editing = ref<Announcement | null>(null);
const form = reactive({
  title: '',
  body: '',
  audience: 'EVERYONE',
  isPinned: false,
  expiresOn: '',
});
const problem = ref('');

function start(announcement: Announcement | null): void {
  editing.value = announcement;
  Object.assign(form, {
    title: announcement?.title ?? '',
    body: announcement?.body ?? '',
    audience: announcement?.audience ?? 'EVERYONE',
    isPinned: announcement?.isPinned ?? false,
    expiresOn: announcement?.expiresOn ?? '',
  });
  problem.value = '';
  save.reset();
  open.value = true;
}
const save = useSaveAction(() => {
  const data = {
    title: form.title.trim(),
    body: form.body.trim(),
    audience: form.audience as Audience,
    isPinned: form.isPinned,
    expiresOn: form.expiresOn || null,
  };
  return editing.value
    ? announcementsApi.update(editing.value.id, data)
    : announcementsApi.create(data);
});
async function submit(): Promise<void> {
  if (form.title.trim().length < 3) problem.value = 'Enter a title of at least 3 characters.';
  else if (form.body.trim().length < 3) problem.value = 'Write the announcement.';
  else if (form.expiresOn && form.expiresOn < todayIso())
    problem.value = 'The last day shown cannot be in the past.';
  else problem.value = '';
  if (problem.value) return;
  if (await save.run()) open.value = false;
}

const removing = ref<Announcement | null>(null);
const remove = useSaveAction(() => announcementsApi.remove(removing.value?.id ?? ''));
async function confirmRemove(): Promise<void> {
  if (await remove.run()) removing.value = null;
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1>Announcements</h1>
        <p class="text-fg-muted mt-1 text-sm">
          {{ canManage ? 'Notices to staff, parents and students.' : 'Notices from the school.' }}
        </p>
      </div>
      <AppButton v-if="canManage" @click="start(null)">
        <template #icon><Plus class="size-4" aria-hidden="true" /></template>
        New announcement
      </AppButton>
    </header>

    <AppEmptyState
      v-if="announcements.isError.value"
      tone="danger"
      title="Announcements could not be loaded"
      :description="errorMessage(announcements.error.value)"
    />
    <div v-else-if="!announcements.data.value" class="space-y-4" aria-busy="true">
      <AppSkeleton v-for="n in 2" :key="n" height="7rem" />
    </div>
    <AppEmptyState
      v-else-if="announcements.data.value.length === 0"
      :icon="Megaphone"
      title="No announcements"
      :description="
        canManage
          ? 'Publish one to notify the people it is for.'
          : 'There is nothing to read at the moment.'
      "
    />
    <ul v-else class="space-y-4">
      <li v-for="announcement in announcements.data.value" :key="announcement.id">
        <AppCard>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <h2 class="flex flex-wrap items-center gap-2 text-base font-semibold">
                <Pin v-if="announcement.isPinned" class="text-primary size-4" aria-label="Pinned" />
                {{ announcement.title }}
              </h2>
              <p class="text-fg-muted mt-0.5 text-xs">
                {{ formatDateTime(announcement.createdAt) }}
                <template v-if="announcement.author"> · {{ announcement.author }}</template>
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <AppBadge v-if="canManage">{{ audienceLabel(announcement.audience) }}</AppBadge>
              <AppBadge v-if="announcement.isExpired" variant="warning">Expired</AppBadge>
              <template v-if="canManage">
                <AppButton
                  variant="ghost"
                  size="sm"
                  :aria-label="`Edit ${announcement.title}`"
                  @click="start(announcement)"
                >
                  Edit
                </AppButton>
                <AppButton
                  variant="ghost"
                  size="sm"
                  :aria-label="`Delete ${announcement.title}`"
                  @click="
                    remove.reset();
                    removing = announcement;
                  "
                >
                  Delete
                </AppButton>
              </template>
            </div>
          </div>
          <p class="mt-3 text-sm whitespace-pre-line">{{ announcement.body }}</p>
          <p
            v-if="announcement.expiresOn && !announcement.isExpired"
            class="text-fg-muted mt-3 text-xs"
          >
            Shown until {{ formatDate(announcement.expiresOn) }}
          </p>
        </AppCard>
      </li>
    </ul>

    <AppModal
      v-model:open="open"
      size="lg"
      :title="editing ? 'Edit announcement' : 'New announcement'"
      :description="
        editing
          ? undefined
          : 'Everyone it is for is notified in the app as soon as it is published.'
      "
    >
      <form id="announcement-form" class="space-y-4" novalidate @submit.prevent="submit">
        <AppAlert v-if="problem || save.error.value">{{ problem || save.error.value }}</AppAlert>
        <AppInput v-model="form.title" label="Title" required data-autofocus />
        <AppTextarea
          v-model="form.body"
          label="Announcement"
          :rows="6"
          :max-length="5000"
          required
        />
        <div class="grid gap-4 sm:grid-cols-2">
          <AppSelect v-model="form.audience" label="For" :options="AUDIENCES" />
          <AppInput
            v-model="form.expiresOn"
            label="Last day shown"
            type="date"
            hint="Leave empty to keep it showing."
          />
        </div>
        <label class="flex items-center gap-2 text-sm">
          <input v-model="form.isPinned" type="checkbox" class="accent-primary size-4" />
          Pin above other announcements
        </label>
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="open = false">Cancel</AppButton>
        <AppButton type="submit" form="announcement-form" :loading="save.pending.value">
          {{ editing ? 'Save changes' : 'Publish' }}
        </AppButton>
      </template>
    </AppModal>

    <AppConfirmDialog
      :open="removing !== null"
      title="Delete this announcement?"
      confirm-label="Delete"
      tone="danger"
      :loading="remove.pending.value"
      :error="remove.error.value"
      @confirm="confirmRemove"
      @cancel="removing = null"
    >
      “{{ removing?.title }}” will no longer be shown to anyone.
    </AppConfirmDialog>
  </div>
</template>
