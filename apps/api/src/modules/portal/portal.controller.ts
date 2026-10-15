import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ClientMeta, CurrentUser, RequirePermissions } from '../../common/auth/auth.decorators.js';
import type { Principal, RequestMeta } from '../../common/auth/principal.js';
import { RequestedSchool, SCHOOL_HEADER } from '../../common/school/school-scope.service.js';
import type { StudentAttendance } from '../attendance/attendance.service.js';
import type { MpesaConfigView, MpesaTransactionView } from '../finance/mpesa.service.js';
import type { ReportCardData } from '../report-cards/report-card.pdf.js';
import { sendDocument } from '../finance/finance.controller.js';
import { sendPdf } from '../report-cards/report-cards.controller.js';
import type { PortalChild } from './portal-access.service.js';
import { LinkAccountDto, PortalRangeQueryDto, PortalStkPushDto } from './portal.dto.js';
import { PortalUser } from './portal.guard.js';
import {
  PortalService,
  type PortalAccounts,
  type PortalFees,
  type PortalOverview,
  type PortalResultSummary,
} from './portal.service.js';

const StudentId = () => Param('studentId', ParseUUIDPipe);

/**
 * The parent and student portals. Each route is open to anyone holding either
 * portal permission; which learners they reach is then decided per request
 * from the database, never from anything the client sends.
 */
@ApiTags('Portal')
@ApiBearerAuth()
@ApiHeader({ name: SCHOOL_HEADER, required: false })
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('children')
  @PortalUser()
  @ApiOperation({ summary: 'The learners the caller may see: their children, or themselves' })
  children(
    @CurrentUser() principal: Principal,
    @RequestedSchool() schoolId?: string,
  ): Promise<PortalChild[]> {
    return this.portal.children(principal, schoolId);
  }

  @Get('children/:studentId')
  @PortalUser()
  overview(
    @CurrentUser() principal: Principal,
    @StudentId() studentId: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<PortalOverview> {
    return this.portal.overview(principal, schoolId, studentId);
  }

  @Get('children/:studentId/results')
  @PortalUser()
  @ApiOperation({ summary: 'Published results only' })
  results(
    @CurrentUser() principal: Principal,
    @StudentId() studentId: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<PortalResultSummary[]> {
    return this.portal.results(principal, schoolId, studentId);
  }

  @Get('children/:studentId/report-cards/:examinationId')
  @PortalUser()
  reportCard(
    @CurrentUser() principal: Principal,
    @StudentId() studentId: string,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<ReportCardData> {
    return this.portal.reportCard(principal, schoolId, studentId, examinationId);
  }

  @Get('children/:studentId/report-cards/:examinationId/pdf')
  @PortalUser()
  @ApiProduces('application/pdf')
  async reportCardPdf(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @StudentId() studentId: string,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
    @Res() response: Response,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    sendPdf(
      response,
      await this.portal.reportCardPdf({ principal, meta }, schoolId, studentId, examinationId),
      'inline',
    );
  }

  @Get('children/:studentId/attendance')
  @PortalUser()
  attendance(
    @CurrentUser() principal: Principal,
    @StudentId() studentId: string,
    @Query() query: PortalRangeQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<StudentAttendance> {
    return this.portal.attendanceOf(principal, schoolId, studentId, query);
  }

  @Get('children/:studentId/fees')
  @PortalUser()
  @ApiOperation({ summary: 'Statement of account and invoices still owed' })
  fees(
    @CurrentUser() principal: Principal,
    @StudentId() studentId: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<PortalFees> {
    return this.portal.fees(principal, schoolId, studentId);
  }

  @Get('children/:studentId/statement/pdf')
  @PortalUser()
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Statement of account as a PDF' })
  async statementPdf(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @StudentId() studentId: string,
    @Res() response: Response,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    sendDocument(
      response,
      await this.portal.statementPdf({ principal, meta }, schoolId, studentId),
      'inline',
    );
  }

  @Get('children/:studentId/invoices/:invoiceId/pdf')
  @PortalUser()
  @ApiProduces('application/pdf')
  async invoicePdf(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @StudentId() studentId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Res() response: Response,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    sendDocument(
      response,
      await this.portal.invoicePdf({ principal, meta }, schoolId, studentId, invoiceId),
      'inline',
    );
  }

  @Get('children/:studentId/receipts/:receiptNumber/pdf')
  @PortalUser()
  @ApiProduces('application/pdf')
  async receiptPdf(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @StudentId() studentId: string,
    @Param('receiptNumber') receiptNumber: string,
    @Res() response: Response,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    if (!/^RCT-\d{4}-\d{6}$/.test(receiptNumber)) {
      throw new BadRequestException({
        code: 'INVALID_RECEIPT',
        message: 'That is not a receipt number.',
      });
    }
    sendDocument(
      response,
      await this.portal.receiptPdf({ principal, meta }, schoolId, studentId, receiptNumber),
      'inline',
    );
  }

  @Get('mpesa/config')
  @PortalUser()
  mpesaConfig(): MpesaConfigView {
    return this.portal.mpesaConfig();
  }

  @Post('children/:studentId/mpesa')
  @RequirePermissions('portal:parent')
  @ApiOperation({ summary: 'Pay a child’s fees by M-Pesa' })
  pay(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @StudentId() studentId: string,
    @Body() dto: PortalStkPushDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<MpesaTransactionView> {
    return this.portal.pay({ principal, meta }, schoolId, studentId, dto);
  }

  @Post('mpesa/:id/verify')
  @HttpCode(200)
  @RequirePermissions('portal:parent')
  verifyPayment(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<MpesaTransactionView> {
    return this.portal.verifyPayment(principal, schoolId, id);
  }
}

/** Staff-side management of who has portal access to a learner's records. */
@ApiTags('Portal')
@ApiBearerAuth()
@ApiHeader({ name: SCHOOL_HEADER, required: false })
@Controller('students/:studentId/portal-accounts')
export class PortalAccountsController {
  constructor(private readonly portal: PortalService) {}

  @Get()
  @RequirePermissions('students:read', 'users:read')
  accounts(
    @CurrentUser() principal: Principal,
    @StudentId() studentId: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<PortalAccounts> {
    return this.portal.accounts(principal, schoolId, studentId);
  }

  @Put('student')
  @RequirePermissions('students:manage', 'users:manage')
  @ApiOperation({ summary: 'Link or unlink the learner’s own portal account' })
  linkStudent(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @StudentId() studentId: string,
    @Body() dto: LinkAccountDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<PortalAccounts> {
    return this.portal.linkStudent({ principal, meta }, schoolId, studentId, dto.email);
  }

  @Put('guardians/:guardianId')
  @RequirePermissions('students:manage', 'users:manage')
  @ApiOperation({ summary: 'Link or unlink a guardian’s parent-portal account' })
  linkGuardian(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @StudentId() studentId: string,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @Body() dto: LinkAccountDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<PortalAccounts> {
    return this.portal.linkGuardian(
      { principal, meta },
      schoolId,
      studentId,
      guardianId,
      dto.email,
    );
  }
}
