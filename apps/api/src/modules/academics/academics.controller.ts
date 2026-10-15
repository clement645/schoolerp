import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientMeta, CurrentUser, RequirePermissions } from '../../common/auth/auth.decorators.js';
import type { Principal, RequestMeta } from '../../common/auth/principal.js';
import { RequestedSchool, SCHOOL_HEADER } from '../../common/school/school-scope.service.js';
import {
  CreateAcademicYearDto,
  CreateTermDto,
  UpdateAcademicYearDto,
  UpdateTermDto,
} from './academics.dto.js';
import { AcademicsService, type AcademicYearView, type TermView } from './academics.service.js';

@ApiTags('Academic years and terms')
@ApiBearerAuth()
@ApiHeader({ name: SCHOOL_HEADER, required: false })
@Controller()
export class AcademicsController {
  constructor(private readonly academics: AcademicsService) {}

  @Get('academic-years')
  @RequirePermissions('calendar:read')
  @ApiOperation({ summary: 'List academic years with their terms, newest first' })
  listYears(
    @CurrentUser() principal: Principal,
    @RequestedSchool() schoolId?: string,
  ): Promise<AcademicYearView[]> {
    return this.academics.listYears(principal, schoolId);
  }

  @Post('academic-years')
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Create an academic year' })
  createYear(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: CreateAcademicYearDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<AcademicYearView> {
    return this.academics.createYear({ principal, meta }, schoolId, dto);
  }

  @Patch('academic-years/:id')
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Rename an academic year or change its dates' })
  updateYear(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAcademicYearDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<AcademicYearView> {
    return this.academics.updateYear({ principal, meta }, schoolId, id, dto);
  }

  @Post('academic-years/:id/set-current')
  @HttpCode(200)
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Make this the current academic year' })
  setCurrentYear(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<AcademicYearView> {
    return this.academics.setCurrentYear({ principal, meta }, schoolId, id);
  }

  @Delete('academic-years/:id')
  @HttpCode(204)
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Delete an academic year that has no terms' })
  deleteYear(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    return this.academics.deleteYear({ principal, meta }, schoolId, id);
  }

  @Post('academic-years/:id/terms')
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Add a term to an academic year' })
  createTerm(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTermDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<TermView> {
    return this.academics.createTerm({ principal, meta }, schoolId, id, dto);
  }

  @Patch('terms/:id')
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Rename a term or change its dates' })
  updateTerm(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTermDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<TermView> {
    return this.academics.updateTerm({ principal, meta }, schoolId, id, dto);
  }

  @Post('terms/:id/set-current')
  @HttpCode(200)
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Make this the current term (and its year the current year)' })
  setCurrentTerm(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<TermView> {
    return this.academics.setCurrentTerm({ principal, meta }, schoolId, id);
  }

  @Delete('terms/:id')
  @HttpCode(204)
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Delete a term that has no records' })
  deleteTerm(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    return this.academics.deleteTerm({ principal, meta }, schoolId, id);
  }
}
