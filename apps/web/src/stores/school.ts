import { useLocalStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
import { computed } from 'vue';
import { useAuthStore } from './auth';

/**
 * Which of the account's schools the user is working in. Most accounts have
 * one; for a group of schools the choice is remembered per browser.
 */
export const useSchoolStore = defineStore('school', () => {
  const auth = useAuthStore();
  const preferredSchoolId = useLocalStorage<string | null>('edumaster.school', null);

  const schools = computed(() => auth.user?.schools ?? []);

  const activeSchool = computed(
    () =>
      schools.value.find((school) => school.id === preferredSchoolId.value) ??
      schools.value[0] ??
      null,
  );
  const activeSchoolId = computed(() => activeSchool.value?.id ?? null);

  function select(schoolId: string): void {
    if (schools.value.some((school) => school.id === schoolId)) {
      preferredSchoolId.value = schoolId;
    }
  }

  return { schools, activeSchool, activeSchoolId, select };
});
