import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { CalendarModule } from '../calendar/calendar.module.js';
import { ExaminationsModule } from '../examinations/examinations.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [AttendanceModule, CalendarModule, ExaminationsModule, FinanceModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
