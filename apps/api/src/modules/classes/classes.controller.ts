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
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientMeta, CurrentUser, RequirePermissions } from '../../common/auth/auth.decorators.js';
import type { Principal, RequestMeta } from '../../common/auth/principal.js';
import { RequestedSchool, SCHOOL_HEADER } from '../../common/school/school-scope.service.js';
import {
  CreateClassDto,
  SaveStreamDto,
  SetClassSubjectsDto,
  UpdateClassDto,
} from './classes.dto.js';
import { ClassesService, type ClassView, type StreamView } from './classes.service.js';

@ApiTags('Classes and streams')
@ApiBearerAuth()
@ApiHeader({ name: SCHOOL_HEADER, required: false })
@Controller()
export class ClassesController {
  constructor(private readonly classes: ClassesService) {}

  @Get('classes')
  @RequirePermissions('classes:read')
  @ApiOperation({ summary: 'List classes with their streams and subjects, youngest first' })
  list(
    @CurrentUser() principal: Principal,
    @RequestedSchool() schoolId?: string,
  ): Promise<ClassView[]> {
    return this.classes.list(principal, schoolId);
  }

  @Post('classes')
  @RequirePermissions('classes:manage')
  @ApiOperation({ summary: 'Create a class' })
  create(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: CreateClassDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<ClassView> {
    return this.classes.create({ principal, meta }, schoolId, dto);
  }

  @Patch('classes/:id')
  @RequirePermissions('classes:manage')
  @ApiOperation({ summary: 'Update a class' })
  update(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<ClassView> {
    return this.classes.update({ principal, meta }, schoolId, id, dto);
  }

  @Delete('classes/:id')
  @HttpCode(204)
  @RequirePermissions('classes:manage')
  @ApiOperation({ summary: 'Delete a class that has no streams or records' })
  delete(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    return this.classes.delete({ principal, meta }, schoolId, id);
  }

  @Put('classes/:id/subjects')
  @RequirePermissions('classes:manage')
  @ApiOperation({ summary: 'Replace the subjects taught in a class' })
  setSubjects(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetClassSubjectsDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<ClassView> {
    return this.classes.setSubjects({ principal, meta }, schoolId, id, dto);
  }

  @Post('classes/:id/streams')
  @RequirePermissions('classes:manage')
  @ApiOperation({ summary: 'Add a stream to a class' })
  createStream(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveStreamDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<StreamView> {
    return this.classes.createStream({ principal, meta }, schoolId, id, dto);
  }

  @Patch('streams/:id')
  @RequirePermissions('classes:manage')
  @ApiOperation({ summary: 'Update a stream' })
  updateStream(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveStreamDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<StreamView> {
    return this.classes.updateStream({ principal, meta }, schoolId, id, dto);
  }

  @Delete('streams/:id')
  @HttpCode(204)
  @RequirePermissions('classes:manage')
  @ApiOperation({ summary: 'Delete a stream that has no records' })
  deleteStream(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    return this.classes.deleteStream({ principal, meta }, schoolId, id);
  }
}
