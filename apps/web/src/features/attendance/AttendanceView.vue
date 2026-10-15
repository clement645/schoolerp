<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppTabs from '@/components/ui/AppTabs.vue';
import MonthlyPanel from './MonthlyPanel.vue';
import RegisterPanel from './RegisterPanel.vue';

// Charts are heavy; they load only when the summary is opened.
const SummaryPanel = defineAsyncComponent(() => import('./SummaryPanel.vue'));

/** The reports page opens on the summary; the attendance page on the register. */
const props = withDefaults(defineProps<{ defaultTab?: 'register' | 'summary' }>(), {
  defaultTab: 'register',
});

const TABS = [
  { id: 'register', label: 'Daily Register' },
  { id: 'summary', label: 'Summary & Trends' },
  { id: 'monthly', label: 'Monthly Register' },
];

const route = useRoute();
const router = useRouter();
const tab = computed({
  get: () => {
    const requested = route.query.tab;
    return TABS.some((entry) => entry.id === requested) ? (requested as string) : props.defaultTab;
  },
  set: (id) => {
    void router.replace({ query: { tab: id === props.defaultTab ? undefined : id } });
  },
});
</script>

<template>
  <div class="space-y-6">
    <header>
      <h1>{{ props.defaultTab === 'summary' ? 'Attendance Reports' : 'Attendance' }}</h1>
      <p class="text-fg-muted mt-1 text-sm">
        Take the daily register, follow attendance over time and review each month.
      </p>
    </header>

    <AppTabs v-model="tab" :tabs="TABS" label="Attendance sections" />

    <section :id="`panel-${tab}`" role="tabpanel" :aria-labelledby="`tab-${tab}`">
      <RegisterPanel v-if="tab === 'register'" />
      <SummaryPanel v-else-if="tab === 'summary'" />
      <MonthlyPanel v-else />
    </section>
  </div>
</template>
