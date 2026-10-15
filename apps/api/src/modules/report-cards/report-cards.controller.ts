import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ClientMeta, CurrentUser, RequirePermissions } from '../../common/auth/auth.decorators.js';
import type { Principal, RequestMeta } from '../../common/auth/principal.js';
import { RequestedSchool, SCHOOL_HEADER } from '../../common/school/school-scope.service.js';
import { contentDisposition } from '../../storage/file-types.js';
import type { ReportCardData } from './report-card.pdf.js';
import { ReportCardsQueryDto, UpdateRemarksDto } from './report-cards.dto.js';
import {
  ReportCardsService,
  type GeneratedPdf,
  type ReportCardList,
} from './report-cards.service.js';

export function sendPdf(
  response: Response,
  file: GeneratedPdf,
  disposition: 'inline' | 'attachment',
): void {
  response
    .status(200)
    .set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': contentDisposition(disposition, file.fileName),
      // Report cards are personal: never stored by the browser or a proxy.
      'Cache-Control': 'no-store',
    })
    .send(file.buffer);
}

@ApiTags('Report cards')
@ApiBearerAuth()
@ApiHeader({ name: SCHOOL_HEADER, required: false })
@Controller('examinations/:examinationId/report-cards')
export class ReportCardsController {
  constructor(private readonly reportCards: ReportCardsService) {}

  @Get()
  @RequirePermissions('results:read')
  @ApiOperation({ summary: 'Learners with a report card in a compiled examination' })
  list(
    @CurrentUser() principal: Principal,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
    @Query() query: ReportCardsQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<ReportCardList> {
    return this.reportCards.list(principal, schoolId, examinationId, query);
  }

  @Get('pdf')
  @RequirePermissions('results:read')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Every report card in the selection as one PDF, a page per learner' })
  async bulkPdf(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
    @Query() query: ReportCardsQueryDto,
    @Res() response: Response,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    const file = await this.reportCards.bulkPdf(
      { principal, meta },
      schoolId,
      examinationId,
      query,
    );
    sendPdf(response, file, 'attachment');
  }

  @Get('students/:studentId')
  @RequirePermissions('results:read')
  @ApiOperation({ summary: 'The content of one learner’s report card' })
  card(
    @CurrentUser() principal: Principal,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<ReportCardData> {
    return this.reportCards.card(principal, schoolId, examinationId, studentId);
  }

  @Get('students/:studentId/pdf')
  @RequirePermissions('results:read')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'One learner’s report card as a PDF' })
  async pdf(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Res() response: Response,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    const file = await this.reportCards.pdf(
      { principal, meta },
      schoolId,
      examinationId,
      studentId,
    );
    sendPdf(response, file, 'inline');
  }

  @Put('students/:studentId/remarks')
  @RequirePermissions('results:read')
  @ApiOperation({ summary: 'Write the class teacher’s or principal’s remarks' })
  updateRemarks(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: UpdateRemarksDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<ReportCardData> {
    return this.reportCards.updateRemarks(
      { principal, meta },
      schoolId,
      examinationId,
      studentId,
      dto,
    );
  }
}
