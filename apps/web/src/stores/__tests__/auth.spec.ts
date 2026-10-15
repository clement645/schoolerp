import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apiRequest, configureHttpAuth } from '@/services/http';
import { fail, fakeApi, noContent, ok, restoreApi, session } from '@/services/__tests__/fake-api';
import { useAuthStore } from '../auth';

const thing = z.object({ id: z.number() });

function connect(auth: ReturnType<typeof useAuthStore>) {
  const events: string[] = [];
  configureHttpAuth({
    getAccessToken: () => auth.accessToken,
    getSchoolId: () => null,
    refresh: () => auth.refresh(),
    onSessionLost: () => events.push('session-lost'),
    onPasswordChangeRequired: () => events.push('password-change-required'),
  });
  return events;
}

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    restoreApi();
    configureHttpAuth(null);
  });

  it('starts signed out', () => {
    const auth = useAuthStore();

    expect(auth.isAuthenticated).toBe(false);
    expect(auth.can('users:read')).toBe(false);
  });

  it('signs in and exposes the profile and permissions', async () => {
    const api = fakeApi({ 'POST /auth/login': () => ok(session()) });
    const auth = useAuthStore();

    await auth.login('amina@school.example', 'a-long-passphrase');

    expect(api.calls[0]?.data).toEqual({
      email: 'amina@school.example',
      password: 'a-long-passphrase',
    });
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.displayName).toBe('Amina Otieno');
    expect(auth.roleLabel).toBe('School Administrator');
    expect(auth.can('users:manage')).toBe(true);
    expect(auth.can('platform:tenants:manage')).toBe(false);
  });

  it('keeps the user signed out when sign-in is rejected', async () => {
    fakeApi({
      'POST /auth/login': () => fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password.'),
    });
    const auth = useAuthStore();

    await expect(auth.login('amina@school.example', 'wrong')).rejects.toThrow(
      'Invalid email or password.',
    );
    expect(auth.isAuthenticated).toBe(false);
  });

  it('never persists the access token in browser storage', async () => {
    fakeApi({ 'POST /auth/login': () => ok(session('secret-access-token')) });

    await useAuthStore().login('amina@school.example', 'a-long-passphrase');

    expect(JSON.stringify({ ...localStorage })).not.toContain('secret-access-token');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('secret-access-token');
  });

  it('clears the session on sign-out even if the server is unreachable', async () => {
    fakeApi({
      'POST /auth/login': () => ok(session()),
      'POST /auth/logout': () => 'network-error',
    });
    const auth = useAuthStore();
    await auth.login('amina@school.example', 'a-long-passphrase');

    await expect(auth.logout()).rejects.toThrow();

    expect(auth.isAuthenticated).toBe(false);
  });

  describe('resuming a session', () => {
    it('restores the session from the refresh cookie once per page load', async () => {
      const api = fakeApi({ 'POST /auth/refresh': () => ok(session()) });
      const auth = useAuthStore();

      await Promise.all([auth.bootstrap(), auth.bootstrap()]);

      expect(api.calls).toHaveLength(1);
      expect(auth.ready).toBe(true);
      expect(auth.isAuthenticated).toBe(true);
    });

    it('is simply signed out when there is no valid cookie', async () => {
      fakeApi({ 'POST /auth/refresh': () => fail(401, 'INVALID_SESSION') });
      const auth = useAuthStore();

      await auth.bootstrap();

      expect(auth.ready).toBe(true);
      expect(auth.isAuthenticated).toBe(false);
    });

    it('shares one request between concurrent refreshes', async () => {
      const api = fakeApi({ 'POST /auth/refresh': () => ok(session('token-2')) });
      const auth = useAuthStore();

      const results = await Promise.all([auth.refresh(), auth.refresh(), auth.refresh()]);

      expect(results).toEqual([true, true, true]);
      expect(api.calls).toHaveLength(1);
    });

    it('keeps the session through a network failure but drops it on rejection', async () => {
      const auth = useAuthStore();
      fakeApi({ 'POST /auth/login': () => ok(session()) });
      await auth.login('amina@school.example', 'a-long-passphrase');

      fakeApi({ 'POST /auth/refresh': () => 'network-error' });
      expect(await auth.refresh()).toBe(false);
      expect(auth.isAuthenticated).toBe(true);

      fakeApi({ 'POST /auth/refresh': () => fail(401, 'INVALID_SESSION') });
      expect(await auth.refresh()).toBe(false);
      expect(auth.isAuthenticated).toBe(false);
    });
  });

  describe('authenticated requests', () => {
    it('sends the access token, but never to the session endpoints', async () => {
      const api = fakeApi({
        'POST /auth/login': () => ok(session('token-1')),
        'GET /things': () => ok({ id: 1 }),
        'POST /auth/logout': () => noContent(),
      });
      const auth = useAuthStore();
      connect(auth);

      await auth.login('amina@school.example', 'a-long-passphrase');
      await apiRequest({ method: 'GET', url: '/things' }, thing);
      await auth.logout();

      expect(api.calls.map((call) => call.authorization)).toEqual([null, 'Bearer token-1', null]);
    });

    it('renews an expired access token and replays the request once', async () => {
      const api = fakeApi({
        'POST /auth/login': () => ok(session('expired')),
        'POST /auth/refresh': () => ok(session('fresh')),
        'GET /things': (call) =>
          call.authorization === 'Bearer fresh' ? ok({ id: 7 }) : fail(401, 'UNAUTHENTICATED'),
      });
      const auth = useAuthStore();
      const events = connect(auth);
      await auth.login('amina@school.example', 'a-long-passphrase');

      const result = await apiRequest({ method: 'GET', url: '/things' }, thing);

      expect(result).toEqual({ id: 7 });
      expect(api.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        'POST /auth/login',
        'GET /things',
        'POST /auth/refresh',
        'GET /things',
      ]);
      expect(events).toEqual([]);
    });

    it('reports a lost session when the refresh is rejected, without looping', async () => {
      const api = fakeApi({
        'POST /auth/login': () => ok(session()),
        'POST /auth/refresh': () => fail(401, 'INVALID_SESSION'),
        'GET /things': () => fail(401, 'UNAUTHENTICATED', 'Authentication is required.'),
      });
      const auth = useAuthStore();
      const events = connect(auth);
      await auth.login('amina@school.example', 'a-long-passphrase');

      await expect(apiRequest({ method: 'GET', url: '/things' }, thing)).rejects.toThrow(
        'Authentication is required.',
      );

      expect(events).toEqual(['session-lost']);
      expect(auth.isAuthenticated).toBe(false);
      expect(api.calls.filter((call) => call.url === '/things')).toHaveLength(1);
    });

    it('gives up after one replay if the request is still unauthorised', async () => {
      const api = fakeApi({
        'POST /auth/login': () => ok(session()),
        'POST /auth/refresh': () => ok(session('token-2')),
        'GET /things': () => fail(401, 'UNAUTHENTICATED'),
      });
      const auth = useAuthStore();
      connect(auth);
      await auth.login('amina@school.example', 'a-long-passphrase');

      await expect(apiRequest({ method: 'GET', url: '/things' }, thing)).rejects.toThrow();

      expect(api.calls.filter((call) => call.url === '/things')).toHaveLength(2);
      expect(api.calls.filter((call) => call.url === '/auth/refresh')).toHaveLength(1);
    });

    it('signals when the API demands a password change', async () => {
      fakeApi({
        'POST /auth/login': () => ok(session()),
        'GET /things': () => fail(403, 'PASSWORD_CHANGE_REQUIRED'),
      });
      const auth = useAuthStore();
      const events = connect(auth);
      await auth.login('amina@school.example', 'a-long-passphrase');

      await expect(apiRequest({ method: 'GET', url: '/things' }, thing)).rejects.toThrow();

      expect(events).toEqual(['password-change-required']);
    });
  });
});
