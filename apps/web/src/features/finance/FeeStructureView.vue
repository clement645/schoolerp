<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppTabs from '@/components/ui/AppTabs.vue';
import { useAuthStore } from '@/stores/auth';
import DiscountsPanel from './DiscountsPanel.vue';
import FeeItemsPanel from './FeeItemsPanel.vue';
import FeeStructuresPanel from './FeeStructuresPanel.vue';

const TABS = [
  { id: 'structures', label: 'Fee structures' },
  { id: 'items', label: 'Fee items' },
  { id: 'discounts', label: 'Discounts & scholarships' },
];

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const canManage = computed(() => auth.can('finance:manage'));

const tab = computed({
  get: () => {
    const requested = route.query.tab;
    return TABS.some((entry) => entry.id === requested) ? (requested as string) : 'structures';
  },
  set: (id) => {
    void router.replace({ query: { tab: id === 'structures' ? undefined : id } });
  },
});
</script>

<template>
  <div class="space-y-6">
    <header>
      <h1>Fee Structure</h1>
      <p class="text-fg-muted mt-1 text-sm">
        Set what each class is charged per term, and the discounts individual learners receive.
      </p>
    </header>

    <AppTabs v-model="tab" :tabs="TABS" label="Fee structure sections" />

    <section :id="`panel-${tab}`" role="tabpanel" :aria-labelledby="`tab-${tab}`">
      <FeeStructuresPanel v-if="tab === 'structures'" :can-manage="canManage" />
      <FeeItemsPanel v-else-if="tab === 'items'" :can-manage="canManage" />
      <DiscountsPanel v-else :can-manage="canManage" />
    </section>
  </div>
</template>
