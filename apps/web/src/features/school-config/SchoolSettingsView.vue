<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppTabs from '@/components/ui/AppTabs.vue';
import { useAuthStore } from '@/stores/auth';
import AcademicYearsPanel from './AcademicYearsPanel.vue';
import GradingSchemesPanel from './GradingSchemesPanel.vue';
import ResultsPolicyPanel from './ResultsPolicyPanel.vue';
import SchoolProfilePanel from './SchoolProfilePanel.vue';

const TABS = [
  { id: 'profile', label: 'School profile' },
  { id: 'academic-years', label: 'Academic years & terms' },
  { id: 'grading', label: 'Grading' },
  { id: 'results', label: 'Results & currency' },
];

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const canManage = computed(() => auth.can('settings:manage'));

// The selected tab lives in the URL so it survives reloads and can be linked.
const tab = computed({
  get: () => {
    const requested = route.query.tab;
    return TABS.some((entry) => entry.id === requested) ? (requested as string) : 'profile';
  },
  set: (id) => {
    void router.replace({ query: { ...route.query, tab: id === 'profile' ? undefined : id } });
  },
});
</script>

<template>
  <div class="space-y-6">
    <header>
      <h1>School settings</h1>
      <p class="text-fg-muted mt-1 text-sm">
        Your school's profile, its academic calendar structure and how learners are graded.
      </p>
    </header>

    <AppTabs v-model="tab" :tabs="TABS" label="School settings sections" />

    <section :id="`panel-${tab}`" role="tabpanel" :aria-labelledby="`tab-${tab}`">
      <SchoolProfilePanel v-if="tab === 'profile'" :can-manage="canManage" />
      <AcademicYearsPanel v-else-if="tab === 'academic-years'" :can-manage="canManage" />
      <GradingSchemesPanel v-else-if="tab === 'grading'" :can-manage="canManage" />
      <ResultsPolicyPanel v-else :can-manage="canManage" />
    </section>
  </div>
</template>
