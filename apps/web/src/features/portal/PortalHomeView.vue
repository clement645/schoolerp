<script setup lang="ts">
import { computed, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import { ChevronRight, UserRound } from '@lucide/vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppSkeleton from '@/components/ui/AppSkeleton.vue';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { errorMessage } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import { portalApi } from './portal.service';

const auth = useAuthStore();
const router = useRouter();
const isParent = computed(() => auth.can('portal:parent'));

const children = useQuery({
  queryKey: useSchoolQueryKey('portal', 'children'),
  queryFn: portalApi.children,
});

// With a single learner there is nothing to choose between.
watch(
  () => children.data.value,
  (list) => {
    const only = list?.length === 1 ? list[0] : undefined;
    if (only) void router.replace({ name: 'portal-child', params: { id: only.id } });
  },
  { immediate: true },
);
</script>

<template>
  <div class="space-y-6">
    <header>
      <h1>{{ isParent ? 'My Children' : 'My Records' }}</h1>
      <p class="text-fg-muted mt-1 text-sm">
        Published results, report cards, attendance and fees.
      </p>
    </header>

    <AppEmptyState
      v-if="children.isError.value"
      tone="danger"
      title="Your records could not be loaded"
      :description="errorMessage(children.error.value)"
    />
    <div v-else-if="!children.data.value" class="grid gap-4 sm:grid-cols-2" aria-busy="true">
      <AppSkeleton v-for="n in 2" :key="n" height="5rem" />
    </div>
    <AppEmptyState
      v-else-if="children.data.value.length === 0"
      :icon="UserRound"
      :title="
        isParent
          ? 'No children are linked to your account'
          : 'Your account is not linked to a student record'
      "
      description="Ask the school office to link your account. Nothing can be shown until they do."
    />
    <ul v-else class="grid gap-4 sm:grid-cols-2">
      <li v-for="child in children.data.value" :key="child.id">
        <RouterLink
          :to="{ name: 'portal-child', params: { id: child.id } }"
          class="bg-surface border-line rounded-card shadow-card hover:border-primary focus-visible:outline-primary flex items-center gap-4 border p-4 transition-colors focus-visible:outline-2"
        >
          <span
            class="bg-primary-light text-primary flex size-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold"
            aria-hidden="true"
          >
            {{ child.name.charAt(0) }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-semibold">{{ child.name }}</span>
            <span class="text-fg-muted block text-sm">
              {{ child.admissionNumber }} · {{ child.class ?? 'Not placed'
              }}<template v-if="child.stream"> {{ child.stream }}</template>
            </span>
          </span>
          <ChevronRight class="text-fg-muted size-5" aria-hidden="true" />
        </RouterLink>
      </li>
    </ul>
  </div>
</template>
