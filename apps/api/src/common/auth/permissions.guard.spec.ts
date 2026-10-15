import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AllowPendingPasswordChange,
  AuthenticatedOnly,
  Public,
  RequirePermissions,
} from './auth.decorators.js';
import { PermissionsGuard } from './permissions.guard.js';
import type { Principal } from './principal.js';

class Routes {
  @Public()
  open(): void {}

  @AuthenticatedOnly()
  anyUser(): void {}

  @AuthenticatedOnly()
  @AllowPendingPasswordChange()
  changePassword(): void {}

  @RequirePermissions('users:read', 'users:manage')
  manageUsers(): void {}

  undeclared(): void {}
}

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: 'user-1',
    tenantId: 'tenant-1',
    sessionId: 'session-1',
    email: 'user@test.example',
    roles: [],
    permissions: new Set(),
    mustChangePassword: false,
    ...overrides,
  };
}

function contextFor(handler: keyof Routes, user?: Principal): ExecutionContext {
  return {
    // Only the method's metadata is read; it is never invoked.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => ({ principal: user }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  const guard = new PermissionsGuard(new Reflector());
  const allows = (handler: keyof Routes, user?: Principal) =>
    guard.canActivate(contextFor(handler, user));

  it('lets anyone reach public routes', () => {
    expect(allows('open')).toBe(true);
  });

  it('denies routes that declare no access rule, even to privileged users', () => {
    const everything = principal({ permissions: new Set(['users:read', 'users:manage']) });

    expect(() => allows('undeclared', everything)).toThrow(/permission/);
  });

  it('denies protected routes when no principal was established', () => {
    expect(() => allows('anyUser')).toThrow(/permission/);
  });

  it('lets any signed-in user reach authenticated-only routes', () => {
    expect(allows('anyUser', principal())).toBe(true);
  });

  it('requires every listed permission', () => {
    const partial = principal({ permissions: new Set(['users:read']) });
    const full = principal({ permissions: new Set(['users:read', 'users:manage']) });

    expect(() => allows('manageUsers', principal())).toThrow(/permission/);
    expect(() => allows('manageUsers', partial)).toThrow(/permission/);
    expect(allows('manageUsers', full)).toBe(true);
  });

  it('confines users with a temporary password to routes that allow it', () => {
    const pending = principal({
      mustChangePassword: true,
      permissions: new Set(['users:read', 'users:manage']),
    });

    expect(() => allows('anyUser', pending)).toThrow(/temporary password/);
    expect(() => allows('manageUsers', pending)).toThrow(/temporary password/);
    expect(allows('changePassword', pending)).toBe(true);
    expect(allows('open', pending)).toBe(true);
  });
});
