import { Module } from '@nestjs/common';
import { FeesService } from './fees.service.js';
import { FinanceDocumentsService } from './finance-documents.service.js';
import { FinanceReportsService } from './finance-reports.service.js';
import { FinanceController } from './finance.controller.js';
import { InvoicesService } from './invoices.service.js';
import { DarajaGateway, MpesaGateway } from './mpesa.gateway.js';
import { MpesaService } from './mpesa.service.js';
import { PaymentsService } from './payments.service.js';

@Module({
  controllers: [FinanceController],
  providers: [
    FeesService,
    InvoicesService,
    PaymentsService,
    FinanceReportsService,
    FinanceDocumentsService,
    MpesaService,
    { provide: MpesaGateway, useClass: DarajaGateway },
  ],
  exports: [
    InvoicesService,
    PaymentsService,
    FinanceReportsService,
    FinanceDocumentsService,
    MpesaService,
  ],
})
export class FinanceModule {}
