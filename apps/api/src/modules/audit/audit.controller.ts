import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../common/auth/auth.decorators.js';
import type { Principal } from '../../common/auth/principal.js';
import type { Paginated } from '../../common/http/pagination.js';
import { ListAuditLogsQueryDto } from './audit.dto.js';
import { AuditService, type AuditLogView } from './audit.service.js';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: "List audit records for the caller's tenant, newest first" })
  list(
    @CurrentUser() principal: Principal,
    @Query() query: ListAuditLogsQueryDto,
  ): Promise<Paginated<AuditLogView>> {
    return this.audit.list(principal.tenantId, query);
  }
}
