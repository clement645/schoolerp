<script setup lang="ts">
import { computed, watch } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { useMediaQuery } from '@vueuse/core';
import { useAuthorizedImage } from '@/composables/useAuthorizedImage';
import { useNotifications } from '@/composables/useNotifications';
import { useSchoolQueryKey } from '@/composables/useSchoolQueryKey';
import { schoolApi } from '@/features/school-config/config.service';
import { NAVIGATION, resolveNavigation } from '@/navigation/navigation';
import { useAuthStore } from '@/stores/auth';
import { useLayoutStore } from '@/stores/layout';
import AppSidebar, { type SidebarSchool } from './AppSidebar.vue';
import AppTopbar from './AppTopbar.vue';
import type { ShellUser } from './UserMenu.vue';

const route = useRoute();
const router = useRouter();
const layout = useLayoutStore();
const auth = useAuthStore();
const queryClient = useQueryClient();

// Desktop: full sidebar. Tablet: collapsible icon rail. Phone: drawer.
const isDesktop = useMediaQuery('(min-width: 1024px)');
const isMobile = useMediaQuery('(max-width: 767px)');

const sidebarCollapsed = computed(() => layout.isSidebarCollapsed(isDesktop.value));

// Only sections the signed-in user holds the permission for are listed. This
// shapes the menu; the API authorises every request independently.
const navigation = computed(() =>
  resolveNavigation(NAVIGATION, {
    can: (permission) => auth.can(permission),
    hasRoute: (name) => router.hasRoute(name),
  }),
);

const notifications = useNotifications();
const shellNotifications = computed(
  () =>
    notifications.latest.value?.map((item) => ({
      id: item.id,
      title: item.title,
      body: item.body ?? '',
      time: item.time,
      read: item.isRead,
    })) ?? null,
);

const shellUser = computed<ShellUser | null>(() =>
  auth.user ? { name: auth.displayName, role: auth.roleLabel } : null,
);

const PLAN_LABELS: Record<string, string> = {
  STANDARD: 'Standard Plan',
  PROFESSIONAL: 'Professional Plan',
  ENTERPRISE: 'Enterprise Plan',
};

// Shares its cache entry with the School settings page, so a new logo or name
// shows here as soon as it is saved.
const schoolProfile = useQuery({
  queryKey: useSchoolQueryKey('profile'),
  queryFn: schoolApi.get,
  enabled: computed(() => Boolean(auth.user?.tenant)),
});
const logo = useAuthorizedImage(() =>
  schoolProfile.data.value?.hasLogo ? `/school/logo?v=${schoolProfile.dataUpdatedAt.value}` : null,
);

const school = computed<SidebarSchool | null>(() => {
  const tenant = auth.user?.tenant;
  if (!tenant) return null;
  return {
    name: schoolProfile.data.value?.name ?? auth.user?.schools[0]?.name ?? tenant.name,
    plan: PLAN_LABELS[tenant.plan] ?? tenant.plan,
    logoSrc: logo.value,
  };
});

async function signOut(): Promise<void> {
  await auth.logout();
  // Drop every cached server response belonging to the previous user.
  queryClient.clear();
  await router.replace({ name: 'login' });
}

function toggleNavigation(): void {
  if (isMobile.value) {
    layout.mobileNavOpen = !layout.mobileNavOpen;
  } else {
    layout.toggleSidebar(isDesktop.value);
  }
}

// The drawer never outlives a navigation or a resize past the phone layout.
watch(
  () => route.fullPath,
  () => {
    layout.mobileNavOpen = false;
  },
);
watch(isMobile, (mobile) => {
  if (!mobile) layout.mobileNavOpen = false;
});
</script>

<template>
  <!--
    Every scrolling region in the shell is `relative`. Visually hidden text
    (`sr-only`) is absolutely positioned, and an absolutely positioned element
    is only clipped by a scroll container that is also its containing block;
    otherwise it stretches the document and the whole page becomes scrollable.
  -->
  <div class="bg-background relative flex h-dvh overflow-hidden">
    <a
      href="#main-content"
      class="bg-primary rounded-control sr-only z-50 px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:absolute focus:top-3 focus:left-3"
    >
      Skip to main content
    </a>

    <AppSidebar
      v-if="!isMobile"
      :groups="navigation"
      :collapsed="sidebarCollapsed"
      :school="school"
      class="shrink-0"
      data-testid="sidebar-desktop"
    />

    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isMobile && layout.mobileNavOpen"
        class="fixed inset-0 z-40 flex bg-black/40"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        data-testid="sidebar-drawer"
        @click.self="layout.mobileNavOpen = false"
        @keydown.esc="layout.mobileNavOpen = false"
      >
        <AppSidebar
          :groups="navigation"
          :school="school"
          @navigate="layout.mobileNavOpen = false"
        />
      </div>
    </Transition>

    <div class="flex min-w-0 flex-1 flex-col">
      <AppTopbar
        :groups="navigation"
        :user="shellUser"
        :notifications="shellNotifications"
        :unread-notifications="notifications.unread.value"
        :mobile="isMobile"
        :sidebar-collapsed="sidebarCollapsed"
        @select-notification="notifications.open"
        @view-notifications="router.push({ name: 'notifications' })"
        @toggle-navigation="toggleNavigation"
        @profile="router.push({ name: 'account' })"
        @sign-out="signOut"
      />

      <main id="main-content" class="relative flex-1 overflow-y-auto" tabindex="-1">
        <div class="mx-auto max-w-7xl p-4 sm:p-6">
          <RouterView />
        </div>
      </main>
    </div>
  </div>
</template>
