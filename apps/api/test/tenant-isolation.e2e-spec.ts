import type { Paginated } from '../src/common/http/pagination.js';
import type { AuditLogView } from '../src/modules/audit/audit.service.js';
import type { UserView } from '../src/modules/users/users.service.js';
import {
  createTestApp,
  dataOf,
  errorOf,
  seedTenant,
  seedUser,
  signIn,
  type SeededTenant,
  type SeededUser,
  type SignedIn,
  type TestContext,
} from './support/app.js';

/** Runs an operation that must fail and returns the database's reason. */
async function rejectionOf(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation();
  } catch (error) {
    // Prisma reports driver errors in `meta`, not always in the message.
    return `${error instanceof Error ? error.message : String(error)} ${JSON.stringify(
      (error as { meta?: unknown }).meta ?? '',
    )}`;
  }
  throw new Error('Expected the operation to be rejected, but it succeeded.');
}

describe('Tenant isolation (e2e)', () => {
  let ctx: TestContext;
  let alpha: SeededTenant;
  let beta: SeededTenant;
  let betaTeacher: SeededUser;
  let alphaAdmin: SignedIn;

  beforeAll(async () => {
    ctx = await createTestApp();
    [alpha, beta] = await Promise.all([seedTenant(ctx), seedTenant(ctx)]);
    betaTeacher = await seedUser(ctx, { tenantId: beta.id, roles: ['TEACHER'] });
    alphaAdmin = await signIn(ctx, alpha.admin);
    // Give tenant beta some audit history of its own.
    await signIn(ctx, beta.admin);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('through the API', () => {
    const asAlpha = (method: 'get' | 'post' | 'patch' | 'put', path: string) =>
      ctx.http()[method](`/api/v1${path}`).set('Authorization', alphaAdmin.bearer);

    it("lists only the caller's own tenant's users", async () => {
      const response = await asAlpha('get', '/users?pageSize=100').expect(200);
      const page = dataOf<Paginated<UserView>>(response);
      const emails = page.items.map((user) => user.email);

      expect(emails).toEqual([alpha.admin.email]);
      expect(page.total).toBe(1);
      expect(emails).not.toContain(beta.admin.email);
    });

    it('cannot find another tenant’s users by searching', async () => {
      const response = await asAlpha('get', `/users?search=${betaTeacher.email}`).expect(200);

      expect(dataOf<Paginated<UserView>>(response).total).toBe(0);
    });

    it('answers "not found" for every operation on another tenant’s user id', async () => {
      const target = `/users/${betaTeacher.id}`;
      const attempts = [
        asAlpha('get', target),
        asAlpha('patch', target).send({ status: 'DISABLED' }),
        asAlpha('patch', target).send({ firstName: 'Hijacked' }),
        asAlpha('put', `${target}/roles`).send({ roles: ['SCHOOL_ADMIN'] }),
        asAlpha('post', `${target}/reset-password`).send({
          temporaryPassword: 'attacker-chosen-password',
        }),
      ];

      for (const response of await Promise.all(attempts)) {
        expect(response.status).toBe(404);
        expect(errorOf(response).code).toBe('USER_NOT_FOUND');
      }

      // Nothing about the target changed, and they can still sign in.
      const untouched = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: betaTeacher.id },
        include: { roles: { include: { role: true } } },
      });
      expect(untouched).toMatchObject({ firstName: 'Test', status: 'ACTIVE' });
      expect(untouched.roles.map(({ role }) => role.key)).toEqual(['TEACHER']);
      await signIn(ctx, betaTeacher);
    });

    it('cannot create a user inside another tenant', async () => {
      const response = await asAlpha('post', '/users').send({
        email: 'planted@test.example',
        firstName: 'Planted',
        lastName: 'User',
        temporaryPassword: 'a-temporary-passphrase',
        roles: ['TEACHER'],
        tenantId: beta.id,
      });

      // Unknown properties are rejected outright; the tenant always comes
      // from the session, never from the request.
      expect(response.status).toBe(400);
      expect(await ctx.prisma.user.count({ where: { email: 'planted@test.example' } })).toBe(0);
    });

    it('attributes platform actions without exposing the platform account', async () => {
      const staff = await seedUser(ctx, { tenantId: null, roles: ['SUPER_ADMIN'] });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: alpha.id,
          actorId: staff.id,
          action: 'tenant.status.changed',
          resourceType: 'tenant',
          resourceId: alpha.id,
        },
      });

      const response = await asAlpha('get', '/audit-logs?action=tenant.').expect(200);
      const [record] = dataOf<Paginated<AuditLogView>>(response).items;

      expect(record).toMatchObject({ actor: null, byPlatformStaff: true });
      expect(JSON.stringify(response.body)).not.toContain(staff.email);
    });

    it("shows only the caller's own tenant's audit records", async () => {
      const response = await asAlpha('get', '/audit-logs?pageSize=100').expect(200);
      const records = dataOf<Paginated<AuditLogView>>(response).items;
      const betaRecords = await ctx.prisma.auditLog.count({ where: { tenantId: beta.id } });

      expect(betaRecords).toBeGreaterThan(0);
      expect(records.length).toBeGreaterThan(0);
      expect(
        records.every(
          (record) => record.byPlatformStaff || record.actor?.email === alpha.admin.email,
        ),
      ).toBe(true);
    });
  });

  describe('enforced by PostgreSQL row-level security', () => {
    it('hides other tenants’ rows even from unfiltered queries', async () => {
      const visible = await ctx.prisma.withTenant(alpha.id, async (tx) => ({
        tenants: await tx.tenant.findMany({ select: { id: true } }),
        schools: await tx.school.findMany({ select: { tenantId: true } }),
        users: await tx.user.findMany({ select: { tenantId: true } }),
        userRoles: await tx.userRole.findMany({ select: { tenantId: true } }),
        auditLogs: await tx.auditLog.findMany({ select: { tenantId: true } }),
        betaUser: await tx.user.findUnique({ where: { id: betaTeacher.id } }),
        betaSessions: await tx.refreshToken.count({ where: { userId: beta.admin.id } }),
        ownSessions: await tx.refreshToken.count({ where: { userId: alpha.admin.id } }),
      }));

      expect(visible.tenants).toEqual([{ id: alpha.id }]);
      expect(visible.schools).toEqual([{ tenantId: alpha.id }]);
      for (const rows of [visible.users, visible.userRoles, visible.auditLogs]) {
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((row) => row.tenantId === alpha.id)).toBe(true);
      }
      expect(visible.betaUser).toBeNull();
      expect(visible.betaSessions).toBe(0);
      expect(visible.ownSessions).toBeGreaterThan(0);
    });

    it('silently affects nothing when updating or deleting across tenants', async () => {
      const result = await ctx.prisma.withTenant(alpha.id, async (tx) => ({
        users: await tx.user.updateMany({ data: { firstName: 'Overwritten' } }),
        betaUsers: await tx.user.updateMany({
          where: { tenantId: beta.id },
          data: { status: 'DISABLED' },
        }),
        betaRoles: await tx.userRole.deleteMany({ where: { tenantId: beta.id } }),
        betaSessions: await tx.refreshToken.updateMany({
          where: { userId: beta.admin.id },
          data: { revokedAt: new Date() },
        }),
      }));

      expect(result.users.count).toBe(1);
      expect(result.betaUsers.count).toBe(0);
      expect(result.betaRoles.count).toBe(0);
      expect(result.betaSessions.count).toBe(0);
      const betaUsers = await ctx.prisma.user.findMany({ where: { tenantId: beta.id } });
      expect(betaUsers.every((user) => user.firstName === 'Test' && user.status === 'ACTIVE')).toBe(
        true,
      );

      await ctx.prisma.user.update({ where: { id: alpha.admin.id }, data: { firstName: 'Test' } });
    });

    it('rejects writing a row into another tenant', async () => {
      const attempts = [
        () =>
          ctx.prisma.withTenant(alpha.id, (tx) =>
            tx.school.create({ data: { tenantId: beta.id, name: 'Planted School' } }),
          ),
        () =>
          ctx.prisma.withTenant(alpha.id, (tx) =>
            tx.user.update({ where: { id: alpha.admin.id }, data: { tenantId: beta.id } }),
          ),
        () =>
          ctx.prisma.withTenant(alpha.id, (tx) =>
            tx.auditLog.create({
              data: { tenantId: beta.id, action: 'auth.logout', resourceType: 'session' },
            }),
          ),
      ];

      for (const attempt of attempts) {
        expect(await rejectionOf(attempt)).toMatch(/row-level security/);
      }
      expect(await ctx.prisma.school.count({ where: { name: 'Planted School' } })).toBe(0);
      const admin = await ctx.prisma.user.findUniqueOrThrow({ where: { id: alpha.admin.id } });
      expect(admin.tenantId).toBe(alpha.id);
    });

    it('keeps audit records append-only for tenants', async () => {
      const attempts = [
        () =>
          ctx.prisma.withTenant(alpha.id, (tx) =>
            tx.auditLog.updateMany({ data: { action: 'tampered' } }),
          ),
        () => ctx.prisma.withTenant(alpha.id, (tx) => tx.auditLog.deleteMany()),
      ];

      for (const attempt of attempts) {
        expect(await rejectionOf(attempt)).toMatch(/permission denied/);
      }
      expect(await ctx.prisma.auditLog.count({ where: { action: 'tampered' } })).toBe(0);
    });

    it('prevents tenants from deleting users, minting sessions or editing the role catalogue', async () => {
      const attempts = [
        () => ctx.prisma.withTenant(alpha.id, (tx) => tx.user.deleteMany()),
        () =>
          ctx.prisma.withTenant(alpha.id, (tx) =>
            tx.refreshToken.create({
              data: {
                userId: alpha.admin.id,
                familyId: alpha.admin.id,
                tokenHash: 'forged',
                expiresAt: new Date(Date.now() + 60_000),
              },
            }),
          ),
        () =>
          ctx.prisma.withTenant(alpha.id, (tx) => tx.role.updateMany({ data: { name: 'Hacked' } })),
        () => ctx.prisma.withTenant(alpha.id, (tx) => tx.rolePermission.deleteMany()),
        () =>
          ctx.prisma.withTenant(alpha.id, (tx) =>
            tx.tenant.updateMany({ data: { plan: 'ENTERPRISE' } }),
          ),
      ];

      for (const attempt of attempts) {
        expect(await rejectionOf(attempt)).toMatch(/permission denied/);
      }
    });

    it('exposes no tenant data when the tenant context is missing or malformed', async () => {
      const withoutContext = await ctx.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE edumaster_app');
        return { users: await tx.user.count(), tenants: await tx.tenant.count() };
      });
      const malformed = ctx.prisma.withTenant("' OR '1'='1", (tx) => tx.user.count());

      expect(withoutContext).toEqual({ users: 0, tenants: 0 });
      await expect(malformed).rejects.toThrow();
    });

    it('does not leak the tenant context to later queries on the same connection', async () => {
      await ctx.prisma.withTenant(alpha.id, (tx) => tx.user.count());

      const [row] = await ctx.prisma.$queryRaw<{ tenant: string | null; role: string }[]>`
        SELECT NULLIF(current_setting('app.tenant_id', TRUE), '') AS tenant,
               current_user::text AS role`;

      expect(row?.tenant).toBeNull();
      expect(row?.role).not.toBe('edumaster_app');
    });

    it('protects every table that has a tenant_id column', async () => {
      // Guard for future migrations: a tenant-owned table without row-level
      // security and a policy for the application role fails this test.
      const unprotected = await ctx.prisma.$queryRaw<{ table_name: string }[]>`
        SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND (
            NOT c.relrowsecurity
            OR NOT EXISTS (
              SELECT 1 FROM pg_policies p
              WHERE p.schemaname = 'public'
                AND p.tablename = c.relname
                AND 'edumaster_app' = ANY (p.roles)
            )
          )`;

      expect(unprotected).toEqual([]);
    });
  });
});
