import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import {
  AUTHENTICATED_ONLY_KEY,
  IS_PUBLIC_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from '../src/common/auth/auth.decorators.js';
import type { Paginated } from '../src/common/http/pagination.js';
import type { TenantView } from '../src/modules/platform/tenants.service.js';
import type { RoleView } from '../src/modules/rbac/roles.controller.js';
import type { UserView } from '../src/modules/users/users.service.js';
import {
  createTestApp,
  dataOf,
  errorOf,
  seedTenant,
  seedUser,
  signIn,
  unique,
  type SeededTenant,
  type SeededUser,
  type SignedIn,
  type TestContext,
} from './support/app.js';

const TEMP_PASSWORD = 'a-temporary-passphrase';

describe('Authorization (e2e)', () => {
  let ctx: TestContext;
  let tenant: SeededTenant;
  let admin: SignedIn;
  let principalUser: SignedIn;
  let teacher: SignedIn;
  let teacherAccount: SeededUser;
  let superAdmin: SignedIn;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await seedTenant(ctx);
    teacherAccount = await seedUser(ctx, { tenantId: tenant.id, roles: ['TEACHER'] });
    const principalAccount = await seedUser(ctx, { tenantId: tenant.id, roles: ['PRINCIPAL'] });
    const superAdminAccount = await seedUser(ctx, { tenantId: null, roles: ['SUPER_ADMIN'] });
    [admin, teacher, principalUser, superAdmin] = await Promise.all([
      signIn(ctx, tenant.admin),
      signIn(ctx, teacherAccount),
      signIn(ctx, principalAccount),
      signIn(ctx, superAdminAccount),
    ]);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const newUser = (overrides: Record<string, unknown> = {}) => ({
    email: `${unique('new')}@test.example`,
    firstName: 'New',
    lastName: 'Member',
    temporaryPassword: TEMP_PASSWORD,
    roles: ['TEACHER'],
    ...overrides,
  });

  describe('every route', () => {
    it('declares an access rule', () => {
      const modules = ctx.app.get(ModulesContainer);
      const scanner = new MetadataScanner();
      const reflector = ctx.app.get(Reflector);
      const controllers = [...modules.values()].flatMap((module) => [
        ...module.controllers.values(),
      ]);
      const undeclared: string[] = [];
      let routes = 0;

      for (const wrapper of controllers) {
        const controller = wrapper.metatype as (new (...args: never[]) => object) | null;
        if (!controller) continue;
        const prototype = controller.prototype as Record<string, () => unknown>;

        for (const name of scanner.getAllMethodNames(prototype)) {
          const handler = prototype[name];
          if (!handler || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
          routes += 1;

          const targets = [handler, controller];
          const declared =
            reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ||
            reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY_KEY, targets) ||
            (reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, targets)?.length ??
              0) > 0;
          if (!declared) {
            const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
            undeclared.push(`${method} ${controller.name}.${name}`);
          }
        }
      }

      expect(routes).toBeGreaterThan(10);
      expect(undeclared).toEqual([]);
    });

    it('requires authentication unless explicitly public', async () => {
      const protectedRoutes: ['get' | 'post', string][] = [
        ['get', '/auth/me'],
        ['post', '/auth/change-password'],
        ['get', '/users'],
        ['post', '/users'],
        ['get', '/roles'],
        ['get', '/audit-logs'],
        ['get', '/platform/tenants'],
        ['post', '/platform/tenants'],
      ];

      for (const [method, path] of protectedRoutes) {
        const response = await ctx.http()[method](`/api/v1${path}`);
        expect(response.status, `${method} ${path}`).toBe(401);
      }
      await ctx.http().get('/api/v1/health/live').expect(200);
    });
  });

  describe('role-based access', () => {
    it('lets an administrator manage users and denies a teacher', async () => {
      await ctx.http().get('/api/v1/users').set('Authorization', admin.bearer).expect(200);

      const list = await ctx.http().get('/api/v1/users').set('Authorization', teacher.bearer);
      const create = await ctx
        .http()
        .post('/api/v1/users')
        .set('Authorization', teacher.bearer)
        .send(newUser());
      const audit = await ctx.http().get('/api/v1/audit-logs').set('Authorization', teacher.bearer);

      for (const response of [list, create, audit]) {
        expect(response.status).toBe(403);
        expect(errorOf(response).code).toBe('FORBIDDEN');
      }
    });

    it('lets a principal view users but not change them', async () => {
      await ctx.http().get('/api/v1/users').set('Authorization', principalUser.bearer).expect(200);
      await ctx
        .http()
        .post('/api/v1/users')
        .set('Authorization', principalUser.bearer)
        .send(newUser())
        .expect(403);
      await ctx
        .http()
        .patch(`/api/v1/users/${teacherAccount.id}`)
        .set('Authorization', principalUser.bearer)
        .send({ status: 'DISABLED' })
        .expect(403);
    });

    it('keeps tenant users out of platform administration', async () => {
      for (const actor of [admin, principalUser, teacher]) {
        await ctx
          .http()
          .get('/api/v1/platform/tenants')
          .set('Authorization', actor.bearer)
          .expect(403);
      }
    });

    it('keeps platform staff out of tenant-scoped endpoints', async () => {
      const response = await ctx
        .http()
        .post('/api/v1/users')
        .set('Authorization', superAdmin.bearer)
        .send(newUser());

      expect(response.status).toBe(403);
    });

    it('marks which roles the caller may grant', async () => {
      const asAdmin = dataOf<RoleView[]>(
        await ctx.http().get('/api/v1/roles').set('Authorization', admin.bearer).expect(200),
      );
      const grantable = (roles: RoleView[]) =>
        roles.filter((role) => role.grantable).map((role) => role.key);

      expect(asAdmin).toHaveLength(10);
      expect(grantable(asAdmin)).not.toContain('SUPER_ADMIN');
      expect(grantable(asAdmin)).toEqual(expect.arrayContaining(['SCHOOL_ADMIN', 'TEACHER']));
      expect(asAdmin.find((role) => role.key === 'TEACHER')?.permissions).toContainEqual({
        key: 'marks:enter',
        description: expect.any(String) as string,
      });
    });
  });

  describe('user provisioning', () => {
    it('creates a user who must change their temporary password', async () => {
      const payload = newUser({ roles: ['TEACHER', 'CLASS_TEACHER'] });

      const response = await ctx
        .http()
        .post('/api/v1/users')
        .set('Authorization', admin.bearer)
        .send(payload)
        .expect(201);
      const created = dataOf<UserView>(response);

      expect(created).toMatchObject({
        email: payload.email,
        status: 'ACTIVE',
        mustChangePassword: true,
      });
      expect(created.roles.map((role) => role.key).sort()).toEqual(['CLASS_TEACHER', 'TEACHER']);
      expect(JSON.stringify(response.body)).not.toContain(TEMP_PASSWORD);
      expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|argon2/i);

      const stored = await ctx.prisma.user.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored.tenantId).toBe(tenant.id);
      const session = await signIn(ctx, { email: payload.email, password: TEMP_PASSWORD });
      expect(session.session.user.mustChangePassword).toBe(true);

      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'user.created', resourceId: created.id },
      });
      expect(audit).toMatchObject({ tenantId: tenant.id, actorId: tenant.admin.id });
      expect(JSON.stringify(audit.metadata)).not.toContain(TEMP_PASSWORD);
    });

    it('rejects duplicate emails, weak passwords and invalid roles', async () => {
      const post = (body: Record<string, unknown>) =>
        ctx.http().post('/api/v1/users').set('Authorization', admin.bearer).send(body);

      const duplicate = await post(newUser({ email: teacherAccount.email }));
      const short = await post(newUser({ temporaryPassword: 'short' }));
      const unknownRole = await post(newUser({ roles: ['JANITOR'] }));
      const noRoles = await post(newUser({ roles: [] }));

      expect(duplicate.status).toBe(409);
      expect(errorOf(duplicate).code).toBe('EMAIL_IN_USE');
      expect(short.status).toBe(400);
      expect(unknownRole.status).toBe(400);
      expect(noRoles.status).toBe(400);
    });
  });

  describe('privilege escalation', () => {
    it('never lets a tenant administrator grant the platform role', async () => {
      const create = await ctx
        .http()
        .post('/api/v1/users')
        .set('Authorization', admin.bearer)
        .send(newUser({ roles: ['SUPER_ADMIN'] }));
      const promote = await ctx
        .http()
        .put(`/api/v1/users/${teacherAccount.id}/roles`)
        .set('Authorization', admin.bearer)
        .send({ roles: ['TEACHER', 'SUPER_ADMIN'] });

      for (const response of [create, promote]) {
        expect(response.status).toBe(403);
        expect(errorOf(response).code).toBe('ROLE_NOT_GRANTABLE');
      }
      const roles = await ctx.prisma.userRole.findMany({
        where: { userId: teacherAccount.id },
        select: { role: { select: { key: true } } },
      });
      expect(roles.map(({ role }) => role.key)).toEqual(['TEACHER']);
    });

    it('stops users from changing their own roles or disabling themselves', async () => {
      const ownRoles = await ctx
        .http()
        .put(`/api/v1/users/${tenant.admin.id}/roles`)
        .set('Authorization', admin.bearer)
        .send({ roles: ['TEACHER'] });
      const disableSelf = await ctx
        .http()
        .patch(`/api/v1/users/${tenant.admin.id}`)
        .set('Authorization', admin.bearer)
        .send({ status: 'DISABLED' });

      expect(errorOf(ownRoles).code).toBe('CANNOT_CHANGE_OWN_ROLES');
      expect(errorOf(disableSelf).code).toBe('CANNOT_DISABLE_SELF');
    });

    it('applies and audits a legitimate role change', async () => {
      const target = await seedUser(ctx, { tenantId: tenant.id, roles: ['TEACHER'] });

      const response = await ctx
        .http()
        .put(`/api/v1/users/${target.id}/roles`)
        .set('Authorization', admin.bearer)
        .send({ roles: ['EXAM_OFFICER'] })
        .expect(200);

      expect(dataOf<UserView>(response).roles.map((role) => role.key)).toEqual(['EXAM_OFFICER']);
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'user.roles.changed', resourceId: target.id },
      });
      expect(audit.metadata).toEqual({ before: ['TEACHER'], after: ['EXAM_OFFICER'] });
    });
  });

  describe('account administration', () => {
    it('disabling a user ends their sessions and blocks sign-in', async () => {
      const target = await seedUser(ctx, { tenantId: tenant.id, roles: ['TEACHER'] });
      const session = await signIn(ctx, target);

      await ctx
        .http()
        .patch(`/api/v1/users/${target.id}`)
        .set('Authorization', admin.bearer)
        .send({ status: 'DISABLED' })
        .expect(200);

      await ctx.http().get('/api/v1/auth/me').set('Authorization', session.bearer).expect(401);
      await ctx.http().post('/api/v1/auth/refresh').set('Cookie', session.cookie).expect(401);
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: target.email, password: target.password })
        .expect(401);
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'user.updated', resourceId: target.id },
      });
      expect(audit.metadata).toMatchObject({
        before: { status: 'ACTIVE' },
        after: { status: 'DISABLED' },
      });
    });

    it('resetting a password signs the user out and forces a change', async () => {
      const target = await seedUser(ctx, { tenantId: tenant.id, roles: ['TEACHER'] });
      const session = await signIn(ctx, target);

      await ctx
        .http()
        .post(`/api/v1/users/${target.id}/reset-password`)
        .set('Authorization', admin.bearer)
        .send({ temporaryPassword: TEMP_PASSWORD })
        .expect(204);

      await ctx.http().post('/api/v1/auth/refresh').set('Cookie', session.cookie).expect(401);
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: target.email, password: target.password })
        .expect(401);
      const fresh = await signIn(ctx, { email: target.email, password: TEMP_PASSWORD });
      expect(fresh.session.user.mustChangePassword).toBe(true);
    });
  });

  describe('platform administration', () => {
    const newTenant = () => ({
      name: unique('Academy'),
      schoolName: 'Main Campus',
      plan: 'PROFESSIONAL',
      admin: {
        email: `${unique('owner')}@test.example`,
        firstName: 'Olive',
        lastName: 'Owner',
        temporaryPassword: TEMP_PASSWORD,
      },
    });

    it('provisions a tenant with its first school and administrator', async () => {
      const payload = newTenant();

      const response = await ctx
        .http()
        .post('/api/v1/platform/tenants')
        .set('Authorization', superAdmin.bearer)
        .send(payload)
        .expect(201);
      const created = dataOf<TenantView>(response);

      expect(created).toMatchObject({
        name: payload.name,
        plan: 'PROFESSIONAL',
        status: 'ACTIVE',
        schoolCount: 1,
        userCount: 1,
      });
      const owner = await signIn(ctx, {
        email: payload.admin.email,
        password: TEMP_PASSWORD,
      });
      expect(owner.session.user).toMatchObject({
        mustChangePassword: true,
        roles: [{ key: 'SCHOOL_ADMIN' }],
        tenant: { id: created.id, plan: 'PROFESSIONAL' },
        schools: [{ name: 'Main Campus' }],
      });

      const listed = dataOf<Paginated<TenantView>>(
        await ctx
          .http()
          .get('/api/v1/platform/tenants?pageSize=100')
          .set('Authorization', superAdmin.bearer)
          .expect(200),
      );
      expect(listed.items.map((item) => item.id)).toContain(created.id);
    });

    it('rolls the whole tenant back when the administrator cannot be created', async () => {
      const payload = newTenant();
      payload.admin.email = tenant.admin.email;

      const response = await ctx
        .http()
        .post('/api/v1/platform/tenants')
        .set('Authorization', superAdmin.bearer)
        .send(payload);

      expect(response.status).toBe(409);
      expect(await ctx.prisma.tenant.count({ where: { name: payload.name } })).toBe(0);
    });

    it('suspending a tenant locks its users out until it is reactivated', async () => {
      const suspended = await seedTenant(ctx);
      const session = await signIn(ctx, suspended.admin);
      const setStatus = (status: string) =>
        ctx
          .http()
          .patch(`/api/v1/platform/tenants/${suspended.id}/status`)
          .set('Authorization', superAdmin.bearer)
          .send({ status });

      await setStatus('SUSPENDED').expect(200);

      await ctx.http().get('/api/v1/auth/me').set('Authorization', session.bearer).expect(401);
      await ctx.http().post('/api/v1/auth/refresh').set('Cookie', session.cookie).expect(401);
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: suspended.admin.email, password: suspended.admin.password })
        .expect(401);

      await setStatus('ACTIVE').expect(200);
      await signIn(ctx, suspended.admin);
    });
  });
});
