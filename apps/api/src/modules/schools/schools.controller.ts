import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedOnly,
  ClientMeta,
  CurrentUser,
  RequirePermissions,
} from '../../common/auth/auth.decorators.js';
import type { Principal, RequestMeta } from '../../common/auth/principal.js';
import { RequestedSchool, SCHOOL_HEADER } from '../../common/school/school-scope.service.js';
import { IMAGE_POLICY, type UploadedFile as Upload } from '../../storage/file-types.js';
import { sendFile } from '../../storage/send-file.js';
import type { SchoolPolicies } from '../../common/school/school-settings.js';
import { UpdateSchoolDto, UpdateSchoolSettingsDto } from './schools.dto.js';
import { SchoolsService, type SchoolView } from './schools.service.js';

@ApiTags('School')
@ApiBearerAuth()
@ApiHeader({
  name: SCHOOL_HEADER,
  required: false,
  description: 'Required for multi-school accounts.',
})
@Controller('school')
export class SchoolsController {
  constructor(private readonly schools: SchoolsService) {}

  @Get()
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Profile of the current school' })
  get(
    @CurrentUser() principal: Principal,
    @RequestedSchool() schoolId?: string,
  ): Promise<SchoolView> {
    return this.schools.get(principal, schoolId);
  }

  @Patch()
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Update the school profile' })
  update(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: UpdateSchoolDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<SchoolView> {
    return this.schools.update({ principal, meta }, schoolId, dto);
  }

  @Get('logo')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'The school logo' })
  async getLogo(
    @CurrentUser() principal: Principal,
    @Res() response: Response,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    const logo = await this.schools.getLogo(principal, schoolId);
    sendFile(response, logo.object, {
      contentType: logo.contentType,
      fileName: 'logo',
      disposition: 'inline',
      maxAgeSeconds: 300,
    });
  }

  @Put('logo')
  @HttpCode(204)
  @RequirePermissions('settings:manage')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: IMAGE_POLICY.maxBytes, files: 1 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload or replace the logo (JPEG, PNG or WebP, up to 2 MB)' })
  setLogo(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @UploadedFile() file: Upload | undefined,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    return this.schools.setLogo({ principal, meta }, schoolId, file);
  }

  @Delete('logo')
  @HttpCode(204)
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Remove the logo' })
  removeLogo(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    return this.schools.removeLogo({ principal, meta }, schoolId);
  }

  @Get('settings')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Pass mark, ranking and report-card policies' })
  getSettings(
    @CurrentUser() principal: Principal,
    @RequestedSchool() schoolId?: string,
  ): Promise<SchoolPolicies> {
    return this.schools.getSettings(principal, schoolId);
  }

  @Put('settings')
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Change the school’s policies' })
  updateSettings(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: UpdateSchoolSettingsDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<SchoolPolicies> {
    return this.schools.updateSettings({ principal, meta }, schoolId, dto);
  }
}
