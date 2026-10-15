import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { ReportCardsModule } from '../report-cards/report-cards.module.js';
import { PortalAccessService } from './portal-access.service.js';
import { PortalAccountsController, PortalController } from './portal.controller.js';
import { PortalGuard } from './portal.guard.js';
import { PortalService } from './portal.service.js';

@Module({
  imports: [AttendanceModule, FinanceModule, ReportCardsModule],
  controllers: [PortalController, PortalAccountsController],
  providers: [PortalService, PortalAccessService, PortalGuard],
  exports: [PortalAccessService],
})
export class PortalModule {}
