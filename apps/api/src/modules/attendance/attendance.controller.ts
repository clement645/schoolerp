import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientMeta, CurrentUser, RequirePermissions } from '../../common/auth/auth.decorators.js';
import type { Principal, RequestMeta } from '../../common/auth/principal.js';
import { RequestedSchool, SCHOOL_HEADER } from '../../common/school/school-scope.service.js';
import {
  AttendanceRangeQueryDto,
  MarkRegisterDto,
  MonthlyQueryDto,
  RegisterQueryDto,
  StudentRangeQueryDto,
} from './attendance.dto.js';
import {
  AttendanceService,
  type AttendanceSummary,
  type MonthlyRegister,
  type RegisterView,
  type StudentAttendance,
} from './attendance.service.js';

@ApiTags('Attendance')
@ApiBearerAuth()
@ApiHeader({ name: SCHOOL_HEADER, required: false })
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('register')
  @RequirePermissions('attendance:read')
  @ApiOperation({ summary: 'A class’s register for one day' })
  register(
    @CurrentUser() principal: Principal,
    @Query() query: RegisterQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<RegisterView> {
    return this.attendance.register(principal, schoolId, query);
  }

  @Put('register')
  @RequirePermissions('attendance:mark')
  @ApiOperation({ summary: 'Mark or correct attendance for several learners at once' })
  mark(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: MarkRegisterDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<RegisterView> {
    return this.attendance.mark({ principal, meta }, schoolId, dto);
  }

  @Get('summary')
  @RequirePermissions('attendance:read')
  @ApiOperation({ summary: 'Totals, daily trend and per-class rates over a period' })
  summary(
    @CurrentUser() principal: Principal,
    @Query() query: AttendanceRangeQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<AttendanceSummary> {
    return this.attendance.summary(principal, schoolId, query);
  }

  @Get('monthly')
  @RequirePermissions('attendance:read')
  @ApiOperation({ summary: 'A class’s register for a whole month' })
  monthly(
    @CurrentUser() principal: Principal,
    @Query() query: MonthlyQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<MonthlyRegister> {
    return this.attendance.monthly(principal, schoolId, query);
  }

  @Get('students/:studentId')
  @RequirePermissions('attendance:read')
  @ApiOperation({ summary: 'One learner’s attendance over a period' })
  student(
    @CurrentUser() principal: Principal,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: StudentRangeQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<StudentAttendance> {
    return this.attendance.student(principal, schoolId, studentId, query);
  }
}
