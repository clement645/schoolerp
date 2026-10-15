/**
 * Creates the first platform administrator. Tenants and their users are
 * provisioned through the API afterwards, so this is the only account that
 * has to be created out of band.
 *
 *   SUPERADMIN_EMAIL=you@example.com SUPERADMIN_PASSWORD='…' \
 *     npm run create-super-admin -w @edumaster/api
 *
 * The password is read from the environment so it is never written to a file
 * or echoed. Optional: SUPERADMIN_FIRST_NAME, SUPERADMIN_LAST_NAME.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { describePasswordProblem, PasswordService } from '../modules/auth/password.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

async function main(): Promise<number> {
  const email = process.env['SUPERADMIN_EMAIL']?.trim().toLowerCase();
  const password = process.env['SUPERADMIN_PASSWORD'];
  const firstName = process.env['SUPERADMIN_FIRST_NAME']?.trim() || 'Platform';
  const lastName = process.env['SUPERADMIN_LAST_NAME']?.trim() || 'Administrator';

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('SUPERADMIN_EMAIL must be set to a valid email address.');
    return 1;
  }
  if (!password) {
    console.error('SUPERADMIN_PASSWORD must be set.');
    return 1;
  }
  const problem = describePasswordProblem(password, { email });
  if (problem) {
    console.error(problem);
    return 1;
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const passwords = app.get(PasswordService);

    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      console.error(`A user with the email ${email} already exists.`);
      return 1;
    }

    const role = await prisma.role.findUniqueOrThrow({
      where: { key: 'SUPER_ADMIN' },
      select: { id: true },
    });
    const user = await prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        passwordHash: await passwords.hash(password),
        roles: { create: { roleId: role.id } },
      },
      select: { id: true },
    });
    await prisma.auditLog.create({
      data: {
        action: 'user.created',
        resourceType: 'user',
        resourceId: user.id,
        metadata: { email, roles: ['SUPER_ADMIN'], via: 'cli' },
      },
    });

    console.log(`Super administrator ${email} created.`);
    return 0;
  } finally {
    await app.close();
  }
}

process.exitCode = await main();
