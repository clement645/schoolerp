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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientMeta, CurrentUser, RequirePermissions } from '../../common/auth/auth.decorators.js';
import type { Principal, RequestMeta } from '../../common/auth/principal.js';
import { RequestedSchool, SCHOOL_HEADER } from '../../common/school/school-scope.service.js';
import { SaveSlotDto, TimetableQueryDto } from './timetable.dto.js';
import { TimetableService, type SlotView } from './timetable.service.js';

@ApiTags('Timetable')
@ApiBearerAuth()
@ApiHeader({ name: SCHOOL_HEADER, required: false })
@Controller('timetable')
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  @Get()
  @RequirePermissions('timetable:read')
  @ApiOperation({ summary: 'The weekly lessons of a class, a stream or a teacher' })
  list(
    @CurrentUser() principal: Principal,
    @Query() query: TimetableQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<SlotView[]> {
    return this.timetable.list(principal, schoolId, query);
  }

  @Post()
  @RequirePermissions('timetable:manage')
  @ApiOperation({ summary: 'Add a lesson; refused if it clashes for the class or the teacher' })
  create(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: SaveSlotDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<SlotView> {
    return this.timetable.create({ principal, meta }, schoolId, dto);
  }

  @Put(':id')
  @RequirePermissions('timetable:manage')
  update(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveSlotDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<SlotView> {
    return this.timetable.update({ principal, meta }, schoolId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('timetable:manage')
  remove(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    return this.timetable.remove({ principal, meta }, schoolId, id);
  }
}
