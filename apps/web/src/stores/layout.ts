import { useLocalStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
import { ref } from 'vue';

/** `auto` follows the viewport: expanded on desktop, icon rail on tablets. */
export type SidebarPreference = 'auto' | 'expanded' | 'collapsed';

export const useLayoutStore = defineStore('layout', () => {
  const sidebarPreference = useLocalStorage<SidebarPreference>('edumaster.sidebar', 'auto');
  const collapsedGroups = useLocalStorage<string[]>('edumaster.sidebar.collapsed-groups', []);
  const mobileNavOpen = ref(false);

  function isSidebarCollapsed(isDesktop: boolean): boolean {
    if (sidebarPreference.value === 'auto') return !isDesktop;
    return sidebarPreference.value === 'collapsed';
  }

  function toggleSidebar(isDesktop: boolean): void {
    sidebarPreference.value = isSidebarCollapsed(isDesktop) ? 'expanded' : 'collapsed';
  }

  function isGroupCollapsed(groupId: string): boolean {
    return collapsedGroups.value.includes(groupId);
  }

  function toggleGroup(groupId: string): void {
    collapsedGroups.value = isGroupCollapsed(groupId)
      ? collapsedGroups.value.filter((id) => id !== groupId)
      : [...collapsedGroups.value, groupId];
  }

  return {
    sidebarPreference,
    collapsedGroups,
    mobileNavOpen,
    isSidebarCollapsed,
    toggleSidebar,
    isGroupCollapsed,
    toggleGroup,
  };
});
