import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PERMISSIONS, PERMISSION_KEYS, ROLE_KEYS, SYSTEM_ROLES } from './rbac.catalogue.js';

/** Arbitrary constant identifying the catalogue sync for pg advisory locks. */
const SYNC_LOCK_ID = 730_114_001;

/**
 * Mirrors the code-defined permission and role catalogue into the database on
 * start-up, so a deployment can never run with roles that lag the code.
 */
@Injectable()
export class RbacSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RbacSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.sync();
  }

  async sync(): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Several instances may boot at once; serialise them.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SYNC_LOCK_ID})`;

      for (const key of PERMISSION_KEYS) {
        const description = PERMISSIONS[key];
        await tx.permission.upsert({
          where: { key },
          create: { key, description },
          update: { description },
        });
      }
      const permissions = await tx.permission.findMany({ select: { id: true, key: true } });
      const permissionId = new Map(
        permissions.map((permission) => [permission.key, permission.id]),
      );

      for (const key of ROLE_KEYS) {
        const { name, description, permissions: granted } = SYSTEM_ROLES[key];
        const role = await tx.role.upsert({
          where: { key },
          create: { key, name, description, isSystem: true },
          update: { name, description, isSystem: true },
        });

        const grantedIds = granted.map((permission) => {
          const id = permissionId.get(permission);
          if (!id) throw new Error(`Permission ${permission} is missing from the database`);
          return id;
        });

        await tx.rolePermission.deleteMany({
          where: { roleId: role.id, permissionId: { notIn: grantedIds } },
        });
        await tx.rolePermission.createMany({
          data: grantedIds.map((id) => ({ roleId: role.id, permissionId: id })),
          skipDuplicates: true,
        });
      }
    });

    this.logger.log(
      `Synchronised ${PERMISSION_KEYS.length} permissions and ${ROLE_KEYS.length} system roles`,
    );
  }
}
