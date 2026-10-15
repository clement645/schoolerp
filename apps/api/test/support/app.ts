import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { REFRESH_COOKIE } from '../../src/modules/auth/auth.controller.js';
import type { Session } from '../../src/modules/auth/auth.service.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import type { RoleKey } from '../../src/modules/rbac/rbac.catalogue.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

export const TEST_PASSWORD = 'correct-horse-battery-staple';

export interface TestContext {
  app: INestApplication<App>;
  prisma: PrismaService;
  passwords: PasswordService;
  http: () => ReturnType<typeof request>;
}

/** Boots the real application with the production HTTP pipeline. */
export async function createTestApp(
  /** Replaces providers, e.g. to stand in for an external service. */
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (builder) => builder,
): Promise<TestContext> {
  const moduleRef = await customize(Test.createTestingModule({ imports: [AppModule] })).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    passwords: app.get(PasswordService),
    http: () => request(app.getHttpServer()),
  };
}

/** Suites share one database, so every fixture gets a unique identity. */
export const unique = (prefix: string): string => `${prefix}-${randomBytes(5).toString('hex')}`;

export interface SeededUser {
  id: string;
  email: string;
  password: string;
  tenantId: string | null;
}

export async function seedUser(
  ctx: TestContext,
  options: {
    tenantId: string | null;
    roles: RoleKey[];
    password?: string;
    mustChangePassword?: boolean;
  },
): Promise<SeededUser> {
  const password = options.password ?? TEST_PASSWORD;
  const email = `${unique('user')}@test.example`;
  const roles = await ctx.prisma.role.findMany({
    where: { key: { in: options.roles } },
    select: { id: true },
  });
  const user = await ctx.prisma.user.create({
    data: {
      tenantId: options.tenantId,
      email,
      firstName: 'Test',
      lastName: options.roles[0] ?? 'User',
      passwordHash: await ctx.passwords.hash(password),
      mustChangePassword: options.mustChangePassword ?? false,
      roles: { create: roles.map((role) => ({ roleId: role.id, tenantId: options.tenantId })) },
    },
    select: { id: true },
  });
  return { id: user.id, email, password, tenantId: options.tenantId };
}

export interface SeededTenant {
  id: string;
  name: string;
  schoolId: string;
  admin: SeededUser;
}

export async function seedTenant(ctx: TestContext): Promise<SeededTenant> {
  const name = unique('Tenant');
  const tenant = await ctx.prisma.tenant.create({
    data: { name, slug: name.toLowerCase(), schools: { create: { name: `${name} School` } } },
    select: { id: true, schools: { select: { id: true } } },
  });
  const school = tenant.schools[0];
  if (!school) throw new Error('seedTenant: school was not created');
  const admin = await seedUser(ctx, { tenantId: tenant.id, roles: ['SCHOOL_ADMIN'] });
  return { id: tenant.id, name, schoolId: school.id, admin };
}

export interface SignedIn {
  accessToken: string;
  /** `name=value` pair of the refresh cookie, ready for a Cookie header. */
  cookie: string;
  session: Session;
  /** Authorization header value. */
  bearer: string;
}

export function refreshCookieOf(response: request.Response): string | null {
  const header: unknown = response.headers['set-cookie'];
  const cookies = Array.isArray(header) ? (header as string[]) : [];
  const cookie = cookies.find((value) => value.startsWith(`${REFRESH_COOKIE}=`));
  return cookie?.split(';')[0] ?? null;
}

export async function signIn(
  ctx: TestContext,
  user: Pick<SeededUser, 'email' | 'password'>,
): Promise<SignedIn> {
  const response = await ctx
    .http()
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: user.password })
    .expect(200);
  const { data } = response.body as { data: Session };
  const cookie = refreshCookieOf(response);
  if (!cookie) throw new Error('signIn: no refresh cookie was set');
  return {
    accessToken: data.accessToken,
    cookie,
    session: data,
    bearer: `Bearer ${data.accessToken}`,
  };
}

/** Shape of the error envelope, for typed assertions. */
export interface ErrorBody {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export const errorOf = (response: request.Response): ErrorBody['error'] =>
  (response.body as ErrorBody).error;

export const dataOf = <T>(response: request.Response): T => (response.body as { data: T }).data;
