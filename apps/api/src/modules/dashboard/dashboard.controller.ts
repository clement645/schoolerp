import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { AuthenticatedOnly, CurrentUser } from '../../common/auth/auth.decorators.js';
import type { Principal } from '../../common/auth/principal.js';
import { RequestedSchool, SCHOOL_HEADER } from '../../common/school/school-scope.service.js';
import { DashboardService, type Dashboard } from './dashboard.service.js';

class DashboardQueryDto {
  @ApiPropertyOptional({ description: 'Defaults to the current term.' })
  @IsOptional()
  @IsUUID()
  termId?: string;
}

@ApiTags('Dashboard')
@ApiBearerAuth()
@ApiHeader({ name: SCHOOL_HEADER, required: false })
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /**
   * Open to any signed-in member of a school: each section is filled in only
   * when the caller holds the permission for that kind of record, and is
   * null otherwise.
   */
  @Get()
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Headline figures for the landing page' })
  get(
    @CurrentUser() principal: Principal,
    @Query() query: DashboardQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<Dashboard> {
    return this.dashboard.get(principal, schoolId, query.termId);
  }
}
