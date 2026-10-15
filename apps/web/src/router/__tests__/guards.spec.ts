import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '@/features/auth/auth.service';

// The router and HTTP client are module singletons; each visit loads a fresh
// copy of both so sessions cannot leak between cases.
async function visit(user: Partial<UserProfile> | null, path: string) {
  vi.resetModules();
  setActivePinia(createPinia());
  const api = await import('@/services/__tests__/fake-api');
  api.fakeApi({
    'POST /auth/refresh': () =>
      user ? api.ok(api.session('token', user)) : api.fail(401, 'INVALID_SESSION'),
  });
  const { router } = await import('../index');
  await router.push(path);
  return router.currentRoute.value;
}

describe('route guards', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('sends signed-out visitors to sign-in, remembering where they were going', async () => {
    const route = await visit(null, '/users?page=2');

    expect(route.name).toBe('login');
    expect(route.query.redirect).toBe('/users?page=2');
  });

  it('does not add a redirect for the home page', async () => {
    const route = await visit(null, '/');

    expect(route.name).toBe('login');
    expect(route.query.redirect).toBeUndefined();
  });

  it('lets signed-out visitors open the sign-in page', async () => {
    expect((await visit(null, '/login')).name).toBe('login');
  });

  it('opens pages the user holds the permission for', async () => {
    expect((await visit({}, '/users')).name).toBe('users');
    expect((await visit({}, '/audit-logs')).name).toBe('audit-logs');
  });

  it('shows "access denied" for pages beyond the user’s permissions', async () => {
    const teacher = { permissions: ['students:read'] };

    expect((await visit(teacher, '/users')).name).toBe('forbidden');
    expect((await visit(teacher, '/audit-logs')).name).toBe('forbidden');
    expect((await visit({}, '/platform/tenants')).name).toBe('forbidden');
  });

  it('lands school users on the dashboard and platform staff on tenants', async () => {
    const platform = { permissions: ['platform:tenants:manage'], tenant: null, schools: [] };

    expect((await visit(platform, '/')).name).toBe('tenants');
    // Platform staff belong to no school, so the dashboard is not theirs.
    expect((await visit(platform, '/dashboard')).name).toBe('tenants');
    expect((await visit({ permissions: ['students:read'] }, '/')).name).toBe('dashboard');
    expect((await visit({ permissions: [] }, '/')).name).toBe('dashboard');
  });

  it('sends parents and students to their portal, and keeps staff out of it', async () => {
    const parent = { permissions: ['portal:parent', 'calendar:read'] };
    const student = { permissions: ['portal:student'] };

    expect((await visit(parent, '/')).name).toBe('portal');
    expect((await visit(student, '/')).name).toBe('portal');
    expect((await visit(parent, '/dashboard')).name).toBe('portal');
    expect((await visit(parent, '/portal/children/abc')).name).toBe('portal-child');
    expect((await visit(parent, '/students')).name).toBe('forbidden');
    expect((await visit({ permissions: ['students:read'] }, '/portal')).name).toBe('forbidden');
  });

  it('confines a user with a temporary password to choosing a new one', async () => {
    const pending = { mustChangePassword: true };

    expect((await visit(pending, '/users')).name).toBe('set-password');
    expect((await visit(pending, '/')).name).toBe('set-password');
    expect((await visit(pending, '/set-password')).name).toBe('set-password');
  });

  it('keeps users without a pending change away from the set-password page', async () => {
    expect((await visit({}, '/set-password')).name).toBe('dashboard');
  });

  it('moves signed-in users off the sign-in page, honouring only same-site redirects', async () => {
    expect((await visit({}, '/login')).name).toBe('dashboard');
    expect((await visit({}, '/login?redirect=/audit-logs')).name).toBe('audit-logs');
    expect((await visit({}, '/login?redirect=https://evil.example')).name).toBe('dashboard');
    expect((await visit({}, '/login?redirect=//evil.example')).name).toBe('dashboard');
  });

  it('shows "not found" for unknown paths', async () => {
    expect((await visit({}, '/no-such-page')).name).toBe('not-found');
  });

  it('sets the document title from the route', async () => {
    await visit({}, '/users');

    expect(document.title).toBe('Users & Roles · EduMaster Pro');
  });
});
