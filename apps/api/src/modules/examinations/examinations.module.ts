import { Module } from '@nestjs/common';
import { ExaminationsController } from './examinations.controller.js';
import { ExaminationsService } from './examinations.service.js';
import { MarksService } from './marks.service.js';
import { ResultsController } from './results.controller.js';
import { ResultsService } from './results.service.js';

@Module({
  controllers: [ExaminationsController, ResultsController],
  providers: [ExaminationsService, MarksService, ResultsService],
  exports: [ExaminationsService, ResultsService],
})
export class ExaminationsModule {}
