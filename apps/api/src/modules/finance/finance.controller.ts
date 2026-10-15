import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiHeader,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { contentDisposition } from '../../storage/file-types.js';
import {
  ClientMeta,
  CurrentUser,
  Public,
  RequirePermissions,
} from '../../common/auth/auth.decorators.js';
import type { Principal, RequestMeta } from '../../common/auth/principal.js';
import type { Paginated } from '../../common/http/pagination.js';
import { RequestedSchool, SCHOOL_HEADER } from '../../common/school/school-scope.service.js';
import {
  FeesService,
  type DiscountView,
  type FeeItemView,
  type FeeStructureView,
} from './fees.service.js';
import {
  FinanceReportsService,
  type FinanceSummary,
  type Statement,
} from './finance-reports.service.js';
import {
  CreateCreditNoteDto,
  CreateDiscountDto,
  CreateFeeItemDto,
  CreateInvoiceDto,
  CreateRefundDto,
  DiscountsQueryDto,
  FinanceSummaryQueryDto,
  GenerateInvoicesDto,
  InvoicesQueryDto,
  MpesaQueryDto,
  PaymentsQueryDto,
  ReasonDto,
  RecordPaymentDto,
  SaveFeeStructureDto,
  StatementQueryDto,
  StkPushDto,
  UpdateDiscountDto,
  UpdateFeeItemDto,
} from './finance.dto.js';
import {
  InvoicesService,
  type GenerationResult,
  type InvoiceDetail,
  type InvoiceSummary,
} from './invoices.service.js';
import { FinanceDocumentsService, type FinanceDocument } from './finance-documents.service.js';
import { MpesaService, type MpesaConfigView, type MpesaTransactionView } from './mpesa.service.js';
import { PaymentsService, type PaymentDetail, type PaymentSummary } from './payments.service.js';

const Id = () => Param('id', ParseUUIDPipe);

/** Sends a generated document; never cached, since it carries personal data. */
export function sendDocument(
  response: Response,
  document: FinanceDocument,
  disposition: 'inline' | 'attachment',
): void {
  response
    .status(200)
    .set({
      'Content-Type': document.contentType,
      'Content-Disposition': contentDisposition(disposition, document.fileName),
      'Cache-Control': 'no-store',
    })
    .send(document.body);
}

@ApiTags('Finance')
@ApiBearerAuth()
@ApiHeader({ name: SCHOOL_HEADER, required: false })
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly fees: FeesService,
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly reports: FinanceReportsService,
    private readonly mpesa: MpesaService,
    private readonly documents: FinanceDocumentsService,
  ) {}

  // ── Documents and exports ──────────────────────────────────────────────────

  @Get('exports/invoices.csv')
  @RequirePermissions('finance:read')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'The invoice list, with the same filters, as CSV' })
  async exportInvoices(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Query() query: InvoicesQueryDto,
    @Res() response: Response,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    sendDocument(
      response,
      await this.documents.invoicesCsv({ principal, meta }, schoolId, query),
      'attachment',
    );
  }

  @Get('exports/payments.csv')
  @RequirePermissions('finance:read')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'The payment list, with the same filters, as CSV' })
  async exportPayments(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Query() query: PaymentsQueryDto,
    @Res() response: Response,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    sendDocument(
      response,
      await this.documents.paymentsCsv({ principal, meta }, schoolId, query),
      'attachment',
    );
  }

  @Get('invoices/:id/pdf')
  @RequirePermissions('finance:read')
  @ApiProduces('application/pdf')
  async invoicePdf(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Id() id: string,
    @Res() response: Response,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    sendDocument(
      response,
      await this.documents.invoicePdf({ principal, meta }, schoolId, id),
      'inline',
    );
  }

  @Get('payments/:id/pdf')
  @RequirePermissions('finance:read')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'The receipt for a payment' })
  async receiptPdf(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Id() id: string,
    @Res() response: Response,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    sendDocument(
      response,
      await this.documents.receiptPdf({ principal, meta }, schoolId, id),
      'inline',
    );
  }

  @Get('students/:id/statement/pdf')
  @RequirePermissions('finance:read')
  @ApiProduces('application/pdf')
  async statementPdf(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Id() id: string,
    @Query() query: StatementQueryDto,
    @Res() response: Response,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    sendDocument(
      response,
      await this.documents.statementPdf({ principal, meta }, schoolId, id, query),
      'inline',
    );
  }

  @Get('students/:id/statement/csv')
  @RequirePermissions('finance:read')
  @ApiProduces('text/csv')
  async statementCsv(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Id() id: string,
    @Query() query: StatementQueryDto,
    @Res() response: Response,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    sendDocument(
      response,
      await this.documents.statementCsv({ principal, meta }, schoolId, id, query),
      'attachment',
    );
  }

  // ── Fee items ──────────────────────────────────────────────────────────────

  @Get('fee-items')
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: 'Kinds of charge' })
  listItems(
    @CurrentUser() principal: Principal,
    @RequestedSchool() schoolId?: string,
  ): Promise<FeeItemView[]> {
    return this.fees.listItems(principal, schoolId);
  }

  @Post('fee-items')
  @RequirePermissions('finance:manage')
  createItem(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: CreateFeeItemDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<FeeItemView> {
    return this.fees.createItem({ principal, meta }, schoolId, dto);
  }

  @Patch('fee-items/:id')
  @RequirePermissions('finance:manage')
  updateItem(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Id() id: string,
    @Body() dto: UpdateFeeItemDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<FeeItemView> {
    return this.fees.updateItem({ principal, meta }, schoolId, id, dto);
  }

  // ── Fee structures ─────────────────────────────────────────────────────────

  @Get('fee-structures')
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: 'What each class is charged per term' })
  listStructures(
    @CurrentUser() principal: Principal,
    @RequestedSchool() schoolId?: string,
  ): Promise<FeeStructureView[]> {
    return this.fees.listStructures(principal, schoolId);
  }

  @Post('fee-structures')
  @RequirePermissions('finance:manage')
  createStructure(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: SaveFeeStructureDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<FeeStructureView> {
    return this.fees.createStructure({ principal, meta }, schoolId, dto);
  }

  @Put('fee-structures/:id')
  @RequirePermissions('finance:manage')
  updateStructure(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Id() id: string,
    @Body() dto: SaveFeeStructureDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<FeeStructureView> {
    return this.fees.updateStructure({ principal, meta }, schoolId, id, dto);
  }

  // ── Discounts and scholarships ─────────────────────────────────────────────

  @Get('discounts')
  @RequirePermissions('finance:read')
  listDiscounts(
    @CurrentUser() principal: Principal,
    @Query() query: DiscountsQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<DiscountView[]> {
    return this.fees.listDiscounts(principal, schoolId, query.studentId);
  }

  @Post('discounts')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Grant a learner a standing discount or scholarship' })
  createDiscount(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: CreateDiscountDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<DiscountView> {
    return this.fees.createDiscount({ principal, meta }, schoolId, dto);
  }

  @Patch('discounts/:id')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'End or reinstate a discount' })
  updateDiscount(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Id() id: string,
    @Body() dto: UpdateDiscountDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<DiscountView> {
    return this.fees.setDiscountActive({ principal, meta }, schoolId, id, dto.isActive);
  }

  // ── Invoices ───────────────────────────────────────────────────────────────

  @Get('invoices')
  @RequirePermissions('finance:read')
  listInvoices(
    @CurrentUser() principal: Principal,
    @Query() query: InvoicesQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<Paginated<InvoiceSummary>> {
    return this.invoices.list(principal, schoolId, query);
  }

  @Post('invoices')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Invoice one learner' })
  createInvoice(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: CreateInvoiceDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<InvoiceDetail> {
    return this.invoices.create({ principal, meta }, schoolId, dto);
  }

  @Post('invoices/generate')
  @HttpCode(200)
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Invoice every learner a fee structure applies to' })
  generateInvoices(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: GenerateInvoicesDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<GenerationResult> {
    return this.invoices.generate({ principal, meta }, schoolId, dto);
  }

  @Get('invoices/:id')
  @RequirePermissions('finance:read')
  getInvoice(
    @CurrentUser() principal: Principal,
    @Id() id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<InvoiceDetail> {
    return this.invoices.get(principal, schoolId, id);
  }

  @Post('invoices/:id/void')
  @HttpCode(200)
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Cancel an invoice that nothing has been paid against' })
  voidInvoice(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Id() id: string,
    @Body() dto: ReasonDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<InvoiceDetail> {
    return this.invoices.void({ principal, meta }, schoolId, id, dto.reason);
  }

  @Post('invoices/:id/credit-notes')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Reduce what is owed on an invoice' })
  creditNote(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Id() id: string,
    @Body() dto: CreateCreditNoteDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<InvoiceDetail> {
    return this.invoices.creditNote({ principal, meta }, schoolId, id, dto);
  }

  // ── Payments and refunds ───────────────────────────────────────────────────

  @Get('payments')
  @RequirePermissions('finance:read')
  listPayments(
    @CurrentUser() principal: Principal,
    @Query() query: PaymentsQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<Paginated<PaymentSummary>> {
    return this.payments.list(principal, schoolId, query);
  }

  @Post('payments')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Record money received; it is applied to the oldest invoices' })
  recordPayment(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: RecordPaymentDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<PaymentDetail> {
    return this.payments.record({ principal, meta }, schoolId, dto);
  }

  @Get('payments/:id')
  @RequirePermissions('finance:read')
  getPayment(
    @CurrentUser() principal: Principal,
    @Id() id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<PaymentDetail> {
    return this.payments.get(principal, schoolId, id);
  }

  @Post('payments/:id/reverse')
  @HttpCode(200)
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Cancel a payment recorded in error' })
  reversePayment(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Id() id: string,
    @Body() dto: ReasonDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<PaymentDetail> {
    return this.payments.reverse({ principal, meta }, schoolId, id, dto.reason);
  }

  @Post('payments/:id/refunds')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Return the unallocated part of a payment' })
  refund(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Id() id: string,
    @Body() dto: CreateRefundDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<PaymentDetail> {
    return this.payments.refund({ principal, meta }, schoolId, id, dto);
  }

  // ── Reports ────────────────────────────────────────────────────────────────

  @Get('summary')
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: 'Invoiced, collected and outstanding, with breakdowns' })
  summary(
    @CurrentUser() principal: Principal,
    @Query() query: FinanceSummaryQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<FinanceSummary> {
    return this.reports.summary(principal, schoolId, query);
  }

  @Get('students/:id/statement')
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: 'A learner’s account with a running balance' })
  statement(
    @CurrentUser() principal: Principal,
    @Id() id: string,
    @Query() query: StatementQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<Statement> {
    return this.reports.statement(principal, schoolId, id, query);
  }

  // ── M-Pesa ─────────────────────────────────────────────────────────────────

  @Get('mpesa/config')
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: 'Whether M-Pesa is set up, and against which environment' })
  mpesaConfig(): MpesaConfigView {
    return this.mpesa.config();
  }

  @Get('mpesa/transactions')
  @RequirePermissions('finance:read')
  mpesaTransactions(
    @CurrentUser() principal: Principal,
    @Query() query: MpesaQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<Paginated<MpesaTransactionView>> {
    return this.mpesa.list(principal, schoolId, query);
  }

  @Post('mpesa/stk-push')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Prompt a phone to pay by M-Pesa' })
  stkPush(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: StkPushDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<MpesaTransactionView> {
    return this.mpesa.requestPayment({ principal, meta }, schoolId, dto);
  }

  @Post('mpesa/transactions/:id/verify')
  @HttpCode(200)
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Ask Safaricom for the outcome of a pending request' })
  verifyMpesa(
    @CurrentUser() principal: Principal,
    @Id() id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<MpesaTransactionView> {
    return this.mpesa.verify(principal, schoolId, id);
  }

  /**
   * Called by Safaricom, not by users: it carries no session. The secret in
   * the path is checked in constant time, and the body is validated before
   * anything is read from it.
   */
  @Post('mpesa/callback/:secret')
  @HttpCode(200)
  @Public()
  @ApiExcludeEndpoint()
  async mpesaCallback(
    @Param('secret') secret: string,
    @Body() body: unknown,
  ): Promise<{ ResultCode: number; ResultDesc: string }> {
    await this.mpesa.handleCallback(secret, body);
    return { ResultCode: 0, ResultDesc: 'Accepted' };
  }
}
