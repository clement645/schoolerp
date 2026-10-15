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
import { CreateSubjectDto, UpdateSubjectDto } from './subjects.dto.js';
import { SubjectsService, type SubjectView } from './subjects.service.js';

@ApiTags('Subjects')
@ApiBearerAuth()
@ApiHeader({ name: SCHOOL_HEADER, required: false })
@Controller('subjects')
export class SubjectsController {
  constructor(private readonly subjects: SubjectsService) {}

  @Get()
  @RequirePermissions('subjects:read')
  @ApiOperation({ summary: 'List subjects' })
  list(
    @CurrentUser() principal: Principal,
    @RequestedSchool() schoolId?: string,
  ): Promise<SubjectView[]> {
    return this.subjects.list(principal, schoolId);
  }

  @Post()
  @RequirePermissions('subjects:manage')
  @ApiOperation({ summary: 'Create a subject' })
  create(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: CreateSubjectDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<SubjectView> {
    return this.subjects.create({ principal, meta }, schoolId, dto);
  }

  @Patch(':id')
  @RequirePermissions('subjects:manage')
  @ApiOperation({ summary: 'Update a subject' })
  update(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubjectDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<SubjectView> {
    return this.subjects.update({ principal, meta }, schoolId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('subjects:manage')
  @ApiOperation({ summary: 'Delete a subject that no class uses' })
  delete(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    return this.subjects.delete({ principal, meta }, schoolId, id);
  }
}
