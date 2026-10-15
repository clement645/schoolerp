import { Module } from '@nestjs/common';
import { ReportCardsController } from './report-cards.controller.js';
import { ReportCardsService } from './report-cards.service.js';

@Module({
  controllers: [ReportCardsController],
  providers: [ReportCardsService],
  exports: [ReportCardsService],
})
export class ReportCardsModule {}
