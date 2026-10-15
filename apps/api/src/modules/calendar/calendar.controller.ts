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
import { EventsQueryDto, SaveEventDto } from './calendar.dto.js';
import { CalendarService, type CalendarEventView } from './calendar.service.js';

@ApiTags('Calendar')
@ApiBearerAuth()
@ApiHeader({ name: SCHOOL_HEADER, required: false })
@Controller('calendar/events')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  @RequirePermissions('calendar:read')
  @ApiOperation({ summary: 'Events overlapping a period' })
  list(
    @CurrentUser() principal: Principal,
    @Query() query: EventsQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<CalendarEventView[]> {
    return this.calendar.list(principal, schoolId, query);
  }

  @Post()
  @RequirePermissions('calendar:manage')
  create(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: SaveEventDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<CalendarEventView> {
    return this.calendar.create({ principal, meta }, schoolId, dto);
  }

  @Put(':id')
  @RequirePermissions('calendar:manage')
  update(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveEventDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<CalendarEventView> {
    return this.calendar.update({ principal, meta }, schoolId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('calendar:manage')
  remove(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    return this.calendar.remove({ principal, meta }, schoolId, id);
  }
}
