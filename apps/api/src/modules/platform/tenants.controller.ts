import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientMeta, CurrentUser, RequirePermissions } from '../../common/auth/auth.decorators.js';
import type { Principal, RequestMeta } from '../../common/auth/principal.js';
import { PaginationQueryDto, type Paginated } from '../../common/http/pagination.js';
import { CreateTenantDto, UpdateTenantStatusDto } from './tenants.dto.js';
import { TenantsService, type TenantView } from './tenants.service.js';

@ApiTags('Platform')
@ApiBearerAuth()
@Controller('platform/tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  @RequirePermissions('platform:tenants:manage')
  @ApiOperation({ summary: 'List all tenants (platform staff only)' })
  list(@Query() query: PaginationQueryDto): Promise<Paginated<TenantView>> {
    return this.tenants.list(query);
  }

  @Post()
  @RequirePermissions('platform:tenants:manage')
  @ApiOperation({ summary: 'Provision a tenant with its first school and administrator' })
  create(
    @CurrentUser() principal: Principal,
    @Body() dto: CreateTenantDto,
    @ClientMeta() meta: RequestMeta,
  ): Promise<TenantView> {
    return this.tenants.create(principal, dto, meta);
  }

  @Patch(':id/status')
  @RequirePermissions('platform:tenants:manage')
  @ApiOperation({ summary: 'Suspend or reactivate a tenant' })
  setStatus(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantStatusDto,
    @ClientMeta() meta: RequestMeta,
  ): Promise<TenantView> {
    return this.tenants.setStatus(principal, id, dto, meta);
  }
}
