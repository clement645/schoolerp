import { LOCKOUT_MINUTES, MAX_FAILED_LOGINS } from '../src/modules/auth/auth.service.js';
import type { Session, UserProfile } from '../src/modules/auth/auth.service.js';
import {
  createTestApp,
  dataOf,
  errorOf,
  refreshCookieOf,
  seedTenant,
  seedUser,
  signIn,
  TEST_PASSWORD,
  type SeededTenant,
  type TestContext,
} from './support/app.js';

describe('Authentication (e2e)', () => {
  let ctx: TestContext;
  let tenant: SeededTenant;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await seedTenant(ctx);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const login = (email: string, password: string) =>
    ctx.http().post('/api/v1/auth/login').send({ email, password });

  const auditActions = async (userId: string) =>
    (
      await ctx.prisma.auditLog.findMany({
        where: { actorId: userId },
        orderBy: { createdAt: 'asc' },
        select: { action: true, metadata: true },
      })
    ).map((row) => row.action);

  describe('sign-in', () => {
    it('returns an access token and profile, and sets a locked-down refresh cookie', async () => {
      const response = await login(tenant.admin.email, tenant.admin.password).expect(200);
      const session = dataOf<Session>(response);

      expect(session.accessToken.split('.')).toHaveLength(3);
      expect(session.expiresInSeconds).toBe(900);
      expect(session.user).toMatchObject({
        id: tenant.admin.id,
        email: tenant.admin.email,
        mustChangePassword: false,
        roles: [{ key: 'SCHOOL_ADMIN', name: 'School Administrator' }],
        tenant: { id: tenant.id, name: tenant.name },
        schools: [{ id: tenant.schoolId }],
      });
      expect(session.user.permissions).toContain('users:manage');
      expect(session.user.permissions).not.toContain('platform:tenants:manage');

      const [cookie] = response.headers['set-cookie'] as unknown as string[];
      expect(cookie).toMatch(/^edumaster_rt=[\w-]{43};/);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/api/v1/auth');
    });

    it('never exposes the refresh token or password hash in the response body', async () => {
      const response = await login(tenant.admin.email, tenant.admin.password).expect(200);
      const cookieValue = refreshCookieOf(response)?.split('=')[1];
      const body = JSON.stringify(response.body);

      expect(cookieValue).toBeTruthy();
      expect(body).not.toContain(cookieValue);
      expect(body).not.toMatch(/passwordHash|argon2/i);
    });

    it('accepts the email in any letter case', async () => {
      await login(tenant.admin.email.toUpperCase(), tenant.admin.password).expect(200);
    });

    it('answers a wrong password and an unknown account identically', async () => {
      const wrong = await login(tenant.admin.email, 'not-the-password').expect(401);
      const unknown = await login('nobody@test.example', 'not-the-password').expect(401);

      expect(errorOf(wrong)).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });
      expect(errorOf(unknown)).toEqual(errorOf(wrong));
      expect(wrong.headers['set-cookie']).toBeUndefined();
    });

    it('rejects malformed input before touching credentials', async () => {
      const response = await login('not-an-email', '').expect(400);

      expect(errorOf(response).code).toBe('BAD_REQUEST');
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: tenant.admin.email, password: TEST_PASSWORD, role: 'SUPER_ADMIN' })
        .expect(400);
    });

    it('rejects sign-in attempts from origins outside the allow-list', async () => {
      const response = await login(tenant.admin.email, tenant.admin.password)
        .set('Origin', 'https://evil.example')
        .expect(403);

      expect(errorOf(response).code).toBe('ORIGIN_NOT_ALLOWED');
    });

    it('stores passwords as Argon2id hashes', async () => {
      const user = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: tenant.admin.id },
        select: { passwordHash: true },
      });

      expect(user.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
      expect(user.passwordHash).not.toContain(tenant.admin.password);
    });

    it('audits successful and failed sign-ins without recording the password', async () => {
      const user = await seedUser(ctx, { tenantId: tenant.id, roles: ['TEACHER'] });
      await login(user.email, 'a-wrong-password-attempt').expect(401);
      await login(user.email, user.password).expect(200);

      const records = await ctx.prisma.auditLog.findMany({
        where: { actorId: user.id },
        orderBy: { createdAt: 'asc' },
      });

      expect(records.map((record) => record.action)).toEqual([
        'auth.login.failed',
        'auth.login.succeeded',
      ]);
      expect(records[0]).toMatchObject({
        tenantId: tenant.id,
        resourceType: 'user',
        resourceId: user.id,
        metadata: { reason: 'wrong_password' },
      });
      expect(records[0]?.ipAddress).toBeTruthy();
      expect(JSON.stringify(records)).not.toContain('a-wrong-password-attempt');
    });

    it('refuses disabled accounts and users of suspended tenants', async () => {
      const suspended = await seedTenant(ctx);
      await ctx.prisma.tenant.update({
        where: { id: suspended.id },
        data: { status: 'SUSPENDED' },
      });
      const disabled = await seedUser(ctx, { tenantId: tenant.id, roles: ['TEACHER'] });
      await ctx.prisma.user.update({ where: { id: disabled.id }, data: { status: 'DISABLED' } });

      await login(suspended.admin.email, suspended.admin.password).expect(401);
      await login(disabled.email, disabled.password).expect(401);
    });
  });

  describe('account lockout', () => {
    it(`locks the account after ${MAX_FAILED_LOGINS} consecutive failures`, async () => {
      const user = await seedUser(ctx, { tenantId: tenant.id, roles: ['TEACHER'] });

      for (let attempt = 0; attempt < MAX_FAILED_LOGINS; attempt += 1) {
        await login(user.email, 'wrong-password-guess').expect(401);
      }
      const whileLocked = await login(user.email, user.password).expect(401);
      const stored = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });

      expect(errorOf(whileLocked).code).toBe('INVALID_CREDENTIALS');
      expect(stored.lockedUntil).not.toBeNull();
      const minutes = ((stored.lockedUntil?.getTime() ?? 0) - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(LOCKOUT_MINUTES - 1);
      expect(minutes).toBeLessThanOrEqual(LOCKOUT_MINUTES);
      expect(await auditActions(user.id)).toContain('auth.login.failed');
    });

    it('lets the user back in once the lock expires, and resets the counter', async () => {
      const user = await seedUser(ctx, { tenantId: tenant.id, roles: ['TEACHER'] });
      await ctx.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 3, lockedUntil: new Date(Date.now() - 1000) },
      });

      await login(user.email, user.password).expect(200);
      const stored = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });

      expect(stored.failedLoginCount).toBe(0);
      expect(stored.lockedUntil).toBeNull();
      expect(stored.lastLoginAt).not.toBeNull();
    });
  });

  describe('access tokens', () => {
    it('authenticates /auth/me', async () => {
      const { bearer } = await signIn(ctx, tenant.admin);

      const response = await ctx.http().get('/api/v1/auth/me').set('Authorization', bearer);

      expect(response.status).toBe(200);
      expect(dataOf<UserProfile>(response).email).toBe(tenant.admin.email);
    });

    it('rejects missing, malformed and tampered tokens', async () => {
      const { accessToken } = await signIn(ctx, tenant.admin);
      const [header, payload, signature] = accessToken.split('.') as [string, string, string];
      const forgedPayload = Buffer.from(
        JSON.stringify({
          ...(JSON.parse(Buffer.from(payload, 'base64url').toString()) as object),
          sub: '00000000-0000-7000-8000-000000000000',
        }),
      ).toString('base64url');
      const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${payload}.`;

      const attempts = [
        undefined,
        'Bearer',
        'Bearer not-a-jwt',
        `Basic ${accessToken}`,
        `Bearer ${header}.${forgedPayload}.${signature}`,
        `Bearer ${unsigned}`,
      ];
      for (const authorization of attempts) {
        const request = ctx.http().get('/api/v1/auth/me');
        if (authorization) void request.set('Authorization', authorization);
        const response = await request;

        expect(response.status, String(authorization)).toBe(401);
        expect(errorOf(response).code).toBe('UNAUTHENTICATED');
      }
    });

    it('stops working the moment the account is disabled', async () => {
      const user = await seedUser(ctx, { tenantId: tenant.id, roles: ['TEACHER'] });
      const { bearer } = await signIn(ctx, user);
      await ctx.http().get('/api/v1/auth/me').set('Authorization', bearer).expect(200);

      await ctx.prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });

      await ctx.http().get('/api/v1/auth/me').set('Authorization', bearer).expect(401);
    });

    it('reflects a role change on the very next request', async () => {
      const user = await seedUser(ctx, { tenantId: tenant.id, roles: ['TEACHER'] });
      const { bearer } = await signIn(ctx, user);
      await ctx.http().get('/api/v1/users').set('Authorization', bearer).expect(403);

      const adminRole = await ctx.prisma.role.findUniqueOrThrow({ where: { key: 'SCHOOL_ADMIN' } });
      await ctx.prisma.userRole.create({
        data: { userId: user.id, roleId: adminRole.id, tenantId: tenant.id },
      });

      await ctx.http().get('/api/v1/users').set('Authorization', bearer).expect(200);
    });
  });

  describe('refresh-token rotation', () => {
    const refresh = (cookie?: string) => {
      const request = ctx.http().post('/api/v1/auth/refresh');
      return cookie ? request.set('Cookie', cookie) : request;
    };

    it('issues a new access token and a new refresh cookie', async () => {
      const first = await signIn(ctx, tenant.admin);

      const response = await refresh(first.cookie).expect(200);
      const rotated = refreshCookieOf(response);

      expect(rotated).toBeTruthy();
      expect(rotated).not.toBe(first.cookie);
      expect(dataOf<Session>(response).user.id).toBe(tenant.admin.id);
      await ctx
        .http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${dataOf<Session>(response).accessToken}`)
        .expect(200);
    });

    it('rejects a request without a cookie or with an unknown token', async () => {
      expect(errorOf(await refresh().expect(401)).code).toBe('INVALID_SESSION');
      await refresh('edumaster_rt=this-token-was-never-issued').expect(401);
    });

    it('revokes the whole session when a used token is replayed', async () => {
      const user = await seedUser(ctx, { tenantId: tenant.id, roles: ['TEACHER'] });
      const stolen = await signIn(ctx, user);
      const legitimate = refreshCookieOf(await refresh(stolen.cookie).expect(200));

      // The original token has been used once already: this is a replay.
      const replay = await refresh(stolen.cookie).expect(401);

      expect(replay.headers['set-cookie']?.[0]).toMatch(/^edumaster_rt=;/);
      // …and the token that was legitimately issued is dead too.
      await refresh(legitimate ?? '').expect(401);
      expect(await auditActions(user.id)).toContain('auth.refresh.reuse_detected');
    });

    it('lets exactly one of two simultaneous refreshes succeed', async () => {
      const user = await seedUser(ctx, { tenantId: tenant.id, roles: ['TEACHER'] });
      const { cookie } = await signIn(ctx, user);

      const responses = await Promise.all([refresh(cookie), refresh(cookie), refresh(cookie)]);

      expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
      expect(responses.filter((response) => response.status === 401)).toHaveLength(2);
    });

    it('rejects expired tokens', async () => {
      const user = await seedUser(ctx, { tenantId: tenant.id, roles: ['TEACHER'] });
      const { cookie } = await signIn(ctx, user);
      await ctx.prisma.refreshToken.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await refresh(cookie).expect(401);
    });

    it('stores only a hash of the token', async () => {
      const user = await seedUser(ctx, { tenantId: tenant.id, roles: ['TEACHER'] });
      const { cookie } = await signIn(ctx, user);
      const token = cookie.split('=')[1] ?? '';
      const rows = await ctx.prisma.refreshToken.findMany({ where: { userId: user.id } });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(rows)).not.toContain(token);
    });
  });

  describe('sign-out', () => {
    it('ends the session and clears the cookie', async () => {
      const user = await seedUser(ctx, { tenantId: tenant.id, roles: ['TEACHER'] });
      const { cookie } = await signIn(ctx, user);

      const response = await ctx.http().post('/api/v1/auth/logout').set('Cookie', cookie);

      expect(response.status).toBe(204);
      expect(response.headers['set-cookie']?.[0]).toMatch(/^edumaster_rt=;/);
      await ctx.http().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
      expect(await auditActions(user.id)).toContain('auth.logout');
    });

    it('succeeds quietly without a session', async () => {
      await ctx.http().post('/api/v1/auth/logout').expect(204);
    });
  });

  describe('changing a password', () => {
    const NEW_PASSWORD = 'a-brand-new-passphrase-2026';
    const changePassword = (bearer: string, currentPassword: string, newPassword: string) =>
      ctx
        .http()
        .post('/api/v1/auth/change-password')
        .set('Authorization', bearer)
        .send({ currentPassword, newPassword });

    it('confines a user with a temporary password to changing it', async () => {
      const user = await seedUser(ctx, {
        tenantId: tenant.id,
        roles: ['SCHOOL_ADMIN'],
        mustChangePassword: true,
      });
      const { bearer, session } = await signIn(ctx, user);

      expect(session.user.mustChangePassword).toBe(true);
      const blocked = await ctx.http().get('/api/v1/users').set('Authorization', bearer);
      expect(blocked.status).toBe(403);
      expect(errorOf(blocked).code).toBe('PASSWORD_CHANGE_REQUIRED');
      await ctx.http().get('/api/v1/auth/me').set('Authorization', bearer).expect(200);

      const changed = await changePassword(bearer, user.password, NEW_PASSWORD).expect(200);
      const fresh = dataOf<Session>(changed);

      expect(fresh.user.mustChangePassword).toBe(false);
      await ctx
        .http()
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${fresh.accessToken}`)
        .expect(200);
    });

    it('replaces the password and signs out every other session', async () => {
      const user = await seedUser(ctx, { tenantId: tenant.id, roles: ['TEACHER'] });
      const otherDevice = await signIn(ctx, user);
      const thisDevice = await signIn(ctx, user);

      const response = await changePassword(thisDevice.bearer, user.password, NEW_PASSWORD);

      expect(response.status).toBe(200);
      expect(refreshCookieOf(response)).toBeTruthy();
      await ctx.http().post('/api/v1/auth/refresh').set('Cookie', otherDevice.cookie).expect(401);
      await ctx.http().post('/api/v1/auth/refresh').set('Cookie', thisDevice.cookie).expect(401);
      await login(user.email, user.password).expect(401);
      await login(user.email, NEW_PASSWORD).expect(200);
      expect(await auditActions(user.id)).toContain('auth.password.changed');
    });

    it('requires the current password and enforces the password policy', async () => {
      const user = await seedUser(ctx, { tenantId: tenant.id, roles: ['TEACHER'] });
      const { bearer } = await signIn(ctx, user);
      const localPart = user.email.split('@')[0] ?? '';

      const wrongCurrent = await changePassword(bearer, 'not-my-password', NEW_PASSWORD);
      const tooShort = await changePassword(bearer, user.password, 'short');
      const unchanged = await changePassword(bearer, user.password, user.password);
      const containsEmail = await changePassword(bearer, user.password, `${localPart}-2026!`);
      const repetitive = await changePassword(bearer, user.password, 'aaaaaaaaaaaaaaaa');

      expect(errorOf(wrongCurrent).code).toBe('CURRENT_PASSWORD_INCORRECT');
      expect(tooShort.status).toBe(400);
      expect(errorOf(unchanged).code).toBe('WEAK_PASSWORD');
      expect(errorOf(containsEmail).code).toBe('WEAK_PASSWORD');
      expect(errorOf(repetitive).code).toBe('WEAK_PASSWORD');
      await login(user.email, user.password).expect(200);
    });
  });
});
