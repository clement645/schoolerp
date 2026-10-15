import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ClientMeta, CurrentUser, RequirePermissions } from '../../common/auth/auth.decorators.js';
import type { Principal, RequestMeta } from '../../common/auth/principal.js';
import type { Paginated } from '../../common/http/pagination.js';
import { RequestedSchool, SCHOOL_HEADER } from '../../common/school/school-scope.service.js';
import { MAX_IMPORT_BYTES } from './students.csv.js';
import {
  ChangeStudentStatusDto,
  CreateStudentDto,
  LinkGuardianDto,
  PromoteStudentsDto,
  StudentFilterDto,
  TransferStudentDto,
  UpdateGuardianLinkDto,
  UpdateStudentDto,
} from './students.dto.js';
import {
  StudentsService,
  type ImportResult,
  type PromotionResult,
  type StudentDetail,
  type StudentSummary,
} from './students.service.js';

/** The part of an uploaded file this controller relies on. */
interface UploadedCsv {
  originalname: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('Students')
@ApiBearerAuth()
@ApiHeader({ name: SCHOOL_HEADER, required: false })
@Controller('students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get()
  @RequirePermissions('students:read')
  @ApiOperation({
    summary: 'Search the student directory',
    description: 'Teachers see only students in the classes they are assigned to.',
  })
  list(
    @CurrentUser() principal: Principal,
    @Query() query: StudentFilterDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<Paginated<StudentSummary>> {
    return this.students.list(principal, schoolId, query);
  }

  // Fixed paths are declared before `:id` so they are not read as an id.

  @Get('export')
  @RequirePermissions('students:read')
  @ApiOperation({ summary: 'Download the filtered directory as CSV' })
  async export(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Query() query: StudentFilterDto,
    @Res() response: Response,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    const csv = await this.students.exportCsv({ principal, meta }, schoolId, query);
    const date = new Date().toISOString().slice(0, 10);
    response
      .status(200)
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="students-${date}.csv"`,
        'Cache-Control': 'no-store',
      })
      .send(csv);
  }

  @Get('guardians')
  @RequirePermissions('students:manage')
  @ApiOperation({ summary: 'Find guardians already on record by name or phone' })
  searchGuardians(
    @CurrentUser() principal: Principal,
    @Query('search') search: string = '',
    @RequestedSchool() schoolId?: string,
  ) {
    return this.students.searchGuardians(principal, schoolId, String(search).slice(0, 100));
  }

  @Post('import')
  @HttpCode(200)
  @RequirePermissions('students:manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({
    summary: 'Import students from a CSV file',
    description:
      'All-or-nothing: if any row has a problem nothing is created. Use dryRun=true to check a file.',
  })
  import(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @UploadedFile() file: UploadedCsv | undefined,
    @Query('dryRun', new ParseBoolPipe({ optional: true })) dryRun: boolean = false,
    @RequestedSchool() schoolId?: string,
  ): Promise<ImportResult> {
    if (!file) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'Choose a CSV file to import.',
      });
    }
    // The browser-reported type is unreliable for CSV, so check the content:
    // it must be a .csv name and plain text (no NUL bytes, as binaries have).
    if (!/\.csv$/i.test(file.originalname) || file.buffer.includes(0)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_FILE',
        message: 'Only CSV files can be imported. In Excel, use "Save as → CSV (UTF-8)".',
      });
    }
    return this.students.importCsv(
      { principal, meta },
      schoolId,
      file.buffer.toString('utf8'),
      dryRun,
    );
  }

  @Post('promote')
  @HttpCode(200)
  @RequirePermissions('students:manage')
  @ApiOperation({
    summary: 'Promote, repeat or graduate a group of students into a new academic year',
  })
  promote(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: PromoteStudentsDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<PromotionResult> {
    return this.students.promote({ principal, meta }, schoolId, dto);
  }

  @Post()
  @RequirePermissions('students:manage')
  @ApiOperation({ summary: 'Admit a student into the current academic year' })
  create(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: CreateStudentDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<StudentDetail> {
    return this.students.create({ principal, meta }, schoolId, dto);
  }

  @Get(':id')
  @RequirePermissions('students:read')
  @ApiOperation({ summary: 'A student’s profile, guardians and enrolment history' })
  get(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<StudentDetail> {
    return this.students.get(principal, schoolId, id);
  }

  @Patch(':id')
  @RequirePermissions('students:manage')
  @ApiOperation({ summary: 'Update a student’s personal details' })
  update(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudentDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<StudentDetail> {
    return this.students.update({ principal, meta }, schoolId, id, dto);
  }

  @Post(':id/transfer')
  @HttpCode(200)
  @RequirePermissions('students:manage')
  @ApiOperation({ summary: 'Move a student to another class or stream' })
  transfer(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferStudentDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<StudentDetail> {
    return this.students.transfer({ principal, meta }, schoolId, id, dto);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions('students:manage')
  @ApiOperation({ summary: 'Suspend, reinstate, re-admit, or record that a student has left' })
  changeStatus(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStudentStatusDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<StudentDetail> {
    return this.students.changeStatus({ principal, meta }, schoolId, id, dto);
  }

  @Post(':id/guardians')
  @RequirePermissions('students:manage')
  @ApiOperation({ summary: 'Add a guardian, new or already on record' })
  addGuardian(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkGuardianDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<StudentDetail> {
    return this.students.addGuardian({ principal, meta }, schoolId, id, dto);
  }

  @Patch(':id/guardians/:guardianId')
  @RequirePermissions('students:manage')
  @ApiOperation({ summary: 'Update a guardian’s details or relationship' })
  updateGuardian(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @Body() dto: UpdateGuardianLinkDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<StudentDetail> {
    return this.students.updateGuardian({ principal, meta }, schoolId, id, guardianId, dto);
  }

  @Delete(':id/guardians/:guardianId')
  @RequirePermissions('students:manage')
  @ApiOperation({ summary: 'Unlink a guardian from a student' })
  removeGuardian(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<StudentDetail> {
    return this.students.removeGuardian({ principal, meta }, schoolId, id, guardianId);
  }
}
