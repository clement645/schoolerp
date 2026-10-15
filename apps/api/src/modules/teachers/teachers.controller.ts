import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedOnly,
  ClientMeta,
  CurrentUser,
  RequirePermissions,
} from '../../common/auth/auth.decorators.js';
import type { Principal, RequestMeta } from '../../common/auth/principal.js';
import type { Paginated } from '../../common/http/pagination.js';
import { RequestedSchool, SCHOOL_HEADER } from '../../common/school/school-scope.service.js';
import {
  CreateAssignmentDto,
  CreateTeacherDto,
  TeacherFilterDto,
  UpdateTeacherDto,
  WorkloadQueryDto,
} from './teachers.dto.js';
import {
  TeachersService,
  type TeacherDetail,
  type TeacherSummary,
  type Workload,
} from './teachers.service.js';

@ApiTags('Teachers')
@ApiBearerAuth()
@ApiHeader({ name: SCHOOL_HEADER, required: false })
@Controller('teachers')
export class TeachersController {
  constructor(private readonly teachers: TeachersService) {}

  @Get()
  @RequirePermissions('teachers:read')
  @ApiOperation({ summary: 'Search the staff directory' })
  list(
    @CurrentUser() principal: Principal,
    @Query() query: TeacherFilterDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<Paginated<TeacherSummary>> {
    return this.teachers.list(principal, schoolId, query);
  }

  // Fixed paths are declared before `:id` so they are not read as an id.

  @Get('me')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'The caller’s own staff profile and assignments, if any' })
  me(
    @CurrentUser() principal: Principal,
    @RequestedSchool() schoolId?: string,
  ): Promise<TeacherDetail | null> {
    return this.teachers.getOwn(principal, schoolId);
  }

  @Get('workload')
  @RequirePermissions('teachers:read')
  @ApiOperation({ summary: 'Teaching and class-teacher responsibilities per teacher' })
  workload(
    @CurrentUser() principal: Principal,
    @Query() query: WorkloadQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<Workload> {
    return this.teachers.workload(principal, schoolId, query.academicYearId);
  }

  @Get('linkable-users')
  @RequirePermissions('teachers:manage')
  @ApiOperation({ summary: 'Teacher accounts not yet linked to a staff profile' })
  linkableUsers(@CurrentUser() principal: Principal, @RequestedSchool() schoolId?: string) {
    return this.teachers.linkableUsers(principal, schoolId);
  }

  @Post()
  @RequirePermissions('teachers:manage')
  @ApiOperation({ summary: 'Register a teacher' })
  create(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: CreateTeacherDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<TeacherDetail> {
    return this.teachers.create({ principal, meta }, schoolId, dto);
  }

  @Get(':id')
  @RequirePermissions('teachers:read')
  @ApiOperation({ summary: 'A teacher’s profile and assignments' })
  get(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<TeacherDetail> {
    return this.teachers.get(principal, schoolId, id);
  }

  @Patch(':id')
  @RequirePermissions('teachers:manage')
  @ApiOperation({ summary: 'Update a teacher, their status or their linked account' })
  update(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeacherDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<TeacherDetail> {
    return this.teachers.update({ principal, meta }, schoolId, id, dto);
  }

  @Post(':id/assignments')
  @RequirePermissions('teachers:manage')
  @ApiOperation({ summary: 'Assign a subject to teach, or a class to be class teacher of' })
  addAssignment(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAssignmentDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<TeacherDetail> {
    return this.teachers.addAssignment({ principal, meta }, schoolId, id, dto);
  }

  @Delete(':id/assignments/:assignmentId')
  @RequirePermissions('teachers:manage')
  @ApiOperation({ summary: 'Remove an assignment' })
  removeAssignment(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<TeacherDetail> {
    return this.teachers.removeAssignment({ principal, meta }, schoolId, id, assignmentId);
  }
}
