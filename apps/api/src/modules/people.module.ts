import { Module } from '@nestjs/common';
import { StudentFilesController } from './students/student-files.controller.js';
import { StudentFilesService } from './students/student-files.service.js';
import { StudentsController } from './students/students.controller.js';
import { StudentsService } from './students/students.service.js';
import { TeachersController } from './teachers/teachers.controller.js';
import { TeachersService } from './teachers/teachers.service.js';

/** Students, their guardians, and teaching staff. */
@Module({
  controllers: [StudentsController, StudentFilesController, TeachersController],
  providers: [StudentsService, StudentFilesService, TeachersService],
})
export class PeopleModule {}
