import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { authApi, type Session, type UserProfile } from '@/features/auth/auth.service';
import { ApiRequestError } from '@/services/http';

const REFRESH_LOCK = 'edumaster.auth.refresh';

/**
 * The signed-in session. The access token lives in memory only — never in
 * localStorage, where any injected script could read it — and is re-obtained
 * after a reload through the HttpOnly refresh cookie.
 */
export const useAuthStore = defineStore('auth', () => {
  const accessToken = shallowRef<string | null>(null);
  const user = ref<UserProfile | null>(null);
  /** True once the initial attempt to resume a session has finished. */
  const ready = ref(false);

  const isAuthenticated = computed(() => accessToken.value !== null && user.value !== null);
  const permissions = computed(() => new Set(user.value?.permissions ?? []));
  const displayName = computed(() =>
    user.value ? `${user.value.firstName} ${user.value.lastName}`.trim() : '',
  );
  /** The user's roles as one label, e.g. "Teacher, Class Teacher". */
  const roleLabel = computed(() => user.value?.roles.map((role) => role.name).join(', ') ?? '');

  function can(permission: string): boolean {
    return permissions.value.has(permission);
  }

  function setSession(session: Session): void {
    accessToken.value = session.accessToken;
    user.value = session.user;
  }

  function clear(): void {
    accessToken.value = null;
    user.value = null;
  }

  async function login(email: string, password: string): Promise<void> {
    setSession(await authApi.login(email, password));
  }

  async function logout(): Promise<void> {
    try {
      await authApi.logout();
    } finally {
      // Even if the server could not be reached, this device is signed out.
      clear();
    }
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    setSession(await authApi.changePassword(currentPassword, newPassword));
  }

  let refreshing: Promise<boolean> | null = null;

  async function exchangeRefreshCookie(): Promise<boolean> {
    try {
      setSession(await authApi.refresh());
      return true;
    } catch (error) {
      // Only a definite rejection ends the session; a network blip does not.
      if (error instanceof ApiRequestError && error.status !== null) clear();
      return false;
    }
  }

  /**
   * Renews the session using the refresh cookie. Concurrent callers share one
   * request, and a Web Lock serialises refreshes across browser tabs: refresh
   * tokens are single-use, so two tabs racing with the same cookie would
   * otherwise look like token theft and sign the user out.
   */
  function refresh(): Promise<boolean> {
    refreshing ??= (
      typeof navigator !== 'undefined' && 'locks' in navigator
        ? navigator.locks.request(REFRESH_LOCK, exchangeRefreshCookie)
        : exchangeRefreshCookie()
    ).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  let bootstrapping: Promise<void> | null = null;

  /** Resumes a previous session, if any, exactly once per page load. */
  function bootstrap(): Promise<void> {
    bootstrapping ??= refresh().then(() => {
      ready.value = true;
    });
    return bootstrapping;
  }

  return {
    accessToken,
    user,
    ready,
    isAuthenticated,
    permissions,
    displayName,
    roleLabel,
    can,
    login,
    logout,
    changePassword,
    refresh,
    bootstrap,
    clear,
  };
});
