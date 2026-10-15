import { Module } from '@nestjs/common';
import { AcademicsController } from './academics/academics.controller.js';
import { AcademicsService } from './academics/academics.service.js';
import { ClassesController } from './classes/classes.controller.js';
import { ClassesService } from './classes/classes.service.js';
import { GradingController } from './grading/grading.controller.js';
import { GradingService } from './grading/grading.service.js';
import { SchoolsController } from './schools/schools.controller.js';
import { SchoolsService } from './schools/schools.service.js';
import { SubjectsController } from './subjects/subjects.controller.js';
import { SubjectsService } from './subjects/subjects.service.js';

/** School configuration: profile, calendar structure, classes, subjects, grading. */
@Module({
  controllers: [
    SchoolsController,
    AcademicsController,
    ClassesController,
    SubjectsController,
    GradingController,
  ],
  providers: [AcademicsService, ClassesService, GradingService, SchoolsService, SubjectsService],
  exports: [GradingService],
})
export class SchoolConfigModule {}
