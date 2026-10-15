import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../common/auth/auth.decorators.js';
import type { Principal } from '../../common/auth/principal.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { canGrantRole, isRoleKey } from './rbac.catalogue.js';

export interface RoleView {
  key: string;
  name: string;
  description: string;
  permissions: { key: string; description: string }[];
  /** Whether the caller may assign this role to other users. */
  grantable: boolean;
}

@ApiTags('Roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('roles:read')
  @ApiOperation({ summary: 'List roles with the permissions each one carries' })
  async list(@CurrentUser() principal: Principal): Promise<RoleView[]> {
    // The role catalogue is global reference data, not tenant-owned.
    const roles = await this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      select: {
        key: true,
        name: true,
        description: true,
        permissions: {
          select: { permission: { select: { key: true, description: true } } },
          orderBy: { permission: { key: 'asc' } },
        },
      },
    });

    return roles.map((role) => ({
      key: role.key,
      name: role.name,
      description: role.description,
      permissions: role.permissions.map(({ permission }) => permission),
      grantable: isRoleKey(role.key) && canGrantRole(principal.permissions, role.key),
    }));
  }
}
