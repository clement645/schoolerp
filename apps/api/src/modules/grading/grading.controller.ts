import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedOnly,
  ClientMeta,
  CurrentUser,
  RequirePermissions,
} from '../../common/auth/auth.decorators.js';
import type { Principal, RequestMeta } from '../../common/auth/principal.js';
import { RequestedSchool, SCHOOL_HEADER } from '../../common/school/school-scope.service.js';
import { SaveGradingSchemeDto } from './grading.dto.js';
import { GradingService, type GradingSchemeView } from './grading.service.js';

@ApiTags('Grading schemes')
@ApiBearerAuth()
@ApiHeader({ name: SCHOOL_HEADER, required: false })
@Controller('grading-schemes')
export class GradingController {
  constructor(private readonly grading: GradingService) {}

  @Get()
  @AuthenticatedOnly()
  @ApiOperation({ summary: "List the school's grading schemes with their grades" })
  list(
    @CurrentUser() principal: Principal,
    @RequestedSchool() schoolId?: string,
  ): Promise<GradingSchemeView[]> {
    return this.grading.list(principal, schoolId);
  }

  @Post()
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Create a grading scheme' })
  create(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: SaveGradingSchemeDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<GradingSchemeView> {
    return this.grading.create({ principal, meta }, schoolId, dto);
  }

  @Put(':id')
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Replace a grading scheme and all of its grades' })
  replace(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveGradingSchemeDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<GradingSchemeView> {
    return this.grading.replace({ principal, meta }, schoolId, id, dto);
  }

  @Post(':id/set-default')
  @HttpCode(200)
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: "Make this the school's default grading scheme" })
  setDefault(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<GradingSchemeView> {
    return this.grading.setDefault({ principal, meta }, schoolId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Delete a grading scheme that no class uses' })
  delete(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    return this.grading.delete({ principal, meta }, schoolId, id);
  }
}
