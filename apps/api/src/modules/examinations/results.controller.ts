import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../common/auth/auth.decorators.js';
import type { Principal } from '../../common/auth/principal.js';
import { RequestedSchool, SCHOOL_HEADER } from '../../common/school/school-scope.service.js';
import { ResultsQueryDto } from './results.dto.js';
import {
  ResultsService,
  type ResultsAnalytics,
  type ResultsOverview,
  type StudentResultView,
} from './results.service.js';

@ApiTags('Results')
@ApiBearerAuth()
@ApiHeader({ name: SCHOOL_HEADER, required: false })
@Controller('results')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get()
  @RequirePermissions('results:read')
  @ApiOperation({ summary: 'Summary statistics and the merit list of a compiled examination' })
  overview(
    @CurrentUser() principal: Principal,
    @Query() query: ResultsQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<ResultsOverview> {
    return this.results.overview(principal, schoolId, query);
  }

  @Get('analytics')
  @RequirePermissions('results:read')
  @ApiOperation({ summary: 'Subject performance, grade distribution, comparisons and trend' })
  analytics(
    @CurrentUser() principal: Principal,
    @Query() query: ResultsQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<ResultsAnalytics> {
    return this.results.analytics(principal, schoolId, query);
  }

  @Get('students/:studentId')
  @RequirePermissions('results:read')
  @ApiOperation({ summary: 'One learner’s result against the class, with their history' })
  student(
    @CurrentUser() principal: Principal,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: ResultsQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<StudentResultView> {
    return this.results.student(principal, schoolId, query.examinationId, studentId);
  }
}
