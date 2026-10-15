<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router';
import { Building2, ChevronDown, GraduationCap } from '@lucide/vue';
import type { ResolvedNavigationGroup } from '@/navigation/navigation';
import { useLayoutStore } from '@/stores/layout';

export interface SidebarSchool {
  name: string;
  /** Subscription plan label, e.g. "Professional Plan". */
  plan: string;
  /** Object URL of the school's logo, if it has one. */
  logoSrc?: string | null;
}

const props = withDefaults(
  defineProps<{
    groups: readonly ResolvedNavigationGroup[];
    /** Icon-only rail. */
    collapsed?: boolean;
    /** Current school and plan; the footer is hidden until one is known. */
    school?: SidebarSchool | null;
  }>(),
  { collapsed: false, school: null },
);

const emit = defineEmits<{
  /** A destination was chosen (used to close the mobile drawer). */
  navigate: [];
}>();

const layout = useLayoutStore();
const route = useRoute();

/** A section stays highlighted on its detail pages, e.g. /students/123. */
const isWithin = (href: string): boolean =>
  route.path === href || route.path.startsWith(`${href}/`);

const ITEM_BASE =
  'flex items-center gap-3 rounded-control px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
</script>

<template>
  <aside
    class="bg-primary-dark flex h-full flex-col text-white transition-[width] duration-200"
    :class="props.collapsed ? 'w-[4.5rem]' : 'w-64'"
    aria-label="Primary"
  >
    <div
      class="flex h-16 shrink-0 items-center gap-3 border-b border-white/10"
      :class="props.collapsed ? 'justify-center px-2' : 'px-5'"
    >
      <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
        <GraduationCap class="size-5" aria-hidden="true" />
      </span>
      <div v-if="!props.collapsed" class="min-w-0">
        <p class="truncate text-sm leading-tight font-semibold tracking-wide">EDUMASTER PRO</p>
        <p class="truncate text-xs text-white/60">School Management</p>
      </div>
    </div>

    <nav class="relative flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
      <section
        v-for="(group, groupIndex) in props.groups"
        :key="group.id"
        class="mb-4 last:mb-0"
        :data-testid="`nav-group-${group.id}`"
      >
        <!-- The icon rail has no room for headings; a divider separates groups. -->
        <div
          v-if="props.collapsed"
          v-show="groupIndex > 0"
          class="mx-2 mb-2 border-t border-white/10"
          aria-hidden="true"
        />
        <button
          v-else
          type="button"
          class="flex w-full items-center justify-between rounded px-3 py-1.5 text-[0.6875rem] font-semibold tracking-wider text-white/50 uppercase hover:text-white/80 focus-visible:outline-2 focus-visible:outline-white"
          :aria-expanded="!layout.isGroupCollapsed(group.id)"
          :aria-controls="`nav-group-items-${group.id}`"
          @click="layout.toggleGroup(group.id)"
        >
          {{ group.label }}
          <ChevronDown
            class="size-3.5 transition-transform"
            :class="{ '-rotate-90': layout.isGroupCollapsed(group.id) }"
            aria-hidden="true"
          />
        </button>

        <ul
          v-show="props.collapsed || !layout.isGroupCollapsed(group.id)"
          :id="`nav-group-items-${group.id}`"
          class="mt-1 space-y-0.5"
        >
          <li v-for="item in group.items" :key="item.label">
            <RouterLink
              v-if="item.available"
              v-slot="{ href, navigate }"
              :to="{ name: item.routeName }"
              custom
            >
              <a
                :href="href"
                :class="[
                  ITEM_BASE,
                  isWithin(href)
                    ? 'bg-white/15 font-medium text-white'
                    : 'text-white/75 hover:bg-white/10 hover:text-white',
                  { 'justify-center': props.collapsed },
                ]"
                :aria-current="isWithin(href) ? 'page' : undefined"
                :title="props.collapsed ? item.label : undefined"
                @click="
                  navigate($event);
                  emit('navigate');
                "
              >
                <component :is="item.icon" class="size-[1.125rem] shrink-0" aria-hidden="true" />
                <span :class="props.collapsed ? 'sr-only' : 'truncate'">{{ item.label }}</span>
              </a>
            </RouterLink>

            <!-- Module not built yet: visible for orientation, but not a link. -->
            <span
              v-else
              :class="[
                ITEM_BASE,
                'cursor-not-allowed text-white/35',
                { 'justify-center': props.collapsed },
              ]"
              aria-disabled="true"
              :title="`${item.label} — not available yet`"
            >
              <component :is="item.icon" class="size-[1.125rem] shrink-0" aria-hidden="true" />
              <span :class="props.collapsed ? 'sr-only' : 'truncate'">{{ item.label }}</span>
              <span
                v-if="!props.collapsed"
                class="ml-auto rounded-full bg-white/10 px-1.5 py-0.5 text-[0.625rem] font-medium tracking-wide text-white/50 uppercase"
              >
                Soon
              </span>
              <span class="sr-only">(not available yet)</span>
            </span>
          </li>
        </ul>
      </section>
    </nav>

    <div
      v-if="props.school"
      class="shrink-0 border-t border-white/10 p-3"
      data-testid="sidebar-school"
    >
      <div
        class="flex items-center gap-3 rounded-lg bg-white/5 p-2.5"
        :class="{ 'justify-center': props.collapsed }"
        :title="props.collapsed ? `${props.school.name} — ${props.school.plan}` : undefined"
      >
        <span
          class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/10"
        >
          <img
            v-if="props.school.logoSrc"
            :src="props.school.logoSrc"
            alt=""
            class="size-full bg-white object-contain"
          />
          <Building2 v-else class="size-4" aria-hidden="true" />
        </span>
        <div v-if="!props.collapsed" class="min-w-0">
          <p class="truncate text-sm font-medium">{{ props.school.plan }}</p>
          <p class="truncate text-xs text-white/60">{{ props.school.name }}</p>
        </div>
      </div>
    </div>
  </aside>
</template>
