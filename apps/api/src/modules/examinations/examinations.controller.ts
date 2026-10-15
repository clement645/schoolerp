import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ClientMeta, CurrentUser, RequirePermissions } from '../../common/auth/auth.decorators.js';
import type { Principal, RequestMeta } from '../../common/auth/principal.js';
import { RequestedSchool, SCHOOL_HEADER } from '../../common/school/school-scope.service.js';
import { contentDisposition, type UploadedFile as Upload } from '../../storage/file-types.js';
import {
  CreateExaminationDto,
  ImportMarksQueryDto,
  ListExaminationsQueryDto,
  MarksSheetQueryDto,
  SaveMarksDto,
  SetMaxMarksDto,
  UpdateExaminationDto,
} from './examinations.dto.js';
import {
  ExaminationsService,
  type ExaminationDetail,
  type ExaminationSummary,
} from './examinations.service.js';
import { MarksService, type MarksImportResult, type MarksSheet } from './marks.service.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

@ApiTags('Examinations')
@ApiBearerAuth()
@ApiHeader({ name: SCHOOL_HEADER, required: false })
@Controller('examinations')
export class ExaminationsController {
  constructor(
    private readonly examinations: ExaminationsService,
    private readonly marks: MarksService,
  ) {}

  @Get()
  @RequirePermissions('examinations:read')
  @ApiOperation({ summary: 'List examinations with their marks-entry progress' })
  list(
    @CurrentUser() principal: Principal,
    @Query() query: ListExaminationsQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<ExaminationSummary[]> {
    return this.examinations.list(principal, schoolId, query);
  }

  @Post()
  @RequirePermissions('examinations:manage')
  @ApiOperation({ summary: 'Create an examination for one or more classes' })
  create(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: CreateExaminationDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<ExaminationDetail> {
    return this.examinations.create({ principal, meta }, schoolId, dto);
  }

  @Get(':id')
  @RequirePermissions('examinations:read')
  @ApiOperation({ summary: 'An examination with the subjects each class sits' })
  get(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<ExaminationDetail> {
    return this.examinations.get(principal, schoolId, id);
  }

  @Patch(':id')
  @RequirePermissions('examinations:manage')
  @ApiOperation({ summary: 'Rename an examination or change its dates' })
  update(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExaminationDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<ExaminationDetail> {
    return this.examinations.update({ principal, meta }, schoolId, id, dto);
  }

  @Put(':id/subjects/:examSubjectId')
  @RequirePermissions('examinations:manage')
  @ApiOperation({ summary: 'Set the maximum mark of a subject' })
  setMaxMarks(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('examSubjectId', ParseUUIDPipe) examSubjectId: string,
    @Body() dto: SetMaxMarksDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<ExaminationDetail> {
    return this.examinations.setMaxMarks({ principal, meta }, schoolId, id, examSubjectId, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('examinations:manage')
  @ApiOperation({ summary: 'Delete an examination that has no marks' })
  delete(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    return this.examinations.delete({ principal, meta }, schoolId, id);
  }

  @Post(':id/open')
  @HttpCode(200)
  @RequirePermissions('examinations:manage')
  @ApiOperation({ summary: 'Open the examination for marks entry' })
  open(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<ExaminationDetail> {
    return this.examinations.open({ principal, meta }, schoolId, id);
  }

  @Post(':id/compile')
  @HttpCode(200)
  @RequirePermissions('examinations:manage')
  @ApiOperation({ summary: 'Close marks entry and compile results' })
  compile(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<ExaminationDetail> {
    return this.examinations.compile({ principal, meta }, schoolId, id);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermissions('examinations:manage')
  @ApiOperation({ summary: 'Return a compiled or approved examination to marks entry' })
  reopen(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<ExaminationDetail> {
    return this.examinations.reopen({ principal, meta }, schoolId, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('results:approve')
  @ApiOperation({ summary: 'Approve compiled results' })
  approve(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<ExaminationDetail> {
    return this.examinations.approve({ principal, meta }, schoolId, id);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermissions('results:publish')
  @ApiOperation({ summary: 'Publish approved results; they are locked from then on' })
  publish(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<ExaminationDetail> {
    return this.examinations.publish({ principal, meta }, schoolId, id);
  }

  @Get(':id/marks')
  @RequirePermissions('examinations:read')
  @ApiOperation({
    summary: 'The marks sheet of one class',
    description: 'Teachers see only learners in the classes they are assigned to.',
  })
  getMarks(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MarksSheetQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<MarksSheet> {
    return this.marks.getSheet(principal, schoolId, id, query.classId, query.streamId);
  }

  @Put(':id/marks')
  @RequirePermissions('marks:enter')
  @ApiOperation({
    summary: 'Save mark changes',
    description:
      'Atomic. Answers 409 MARKS_CONFLICT if any mark was changed by someone else since it was read.',
  })
  saveMarks(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveMarksDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<MarksSheet> {
    return this.marks.save({ principal, meta }, schoolId, id, dto);
  }

  @Get(':id/marks/export')
  @RequirePermissions('examinations:read')
  @ApiOperation({ summary: 'Download a class’s marks sheet as Excel' })
  async exportMarks(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MarksSheetQueryDto,
    @Res() response: Response,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    const file = await this.marks.exportXlsx(
      { principal, meta },
      schoolId,
      id,
      query.classId,
      query.streamId,
    );
    response
      .status(200)
      .set({
        'Content-Type': XLSX,
        'Content-Disposition': contentDisposition('attachment', file.fileName),
        'Cache-Control': 'no-store',
      })
      .send(file.buffer);
  }

  @Post(':id/marks/import')
  @HttpCode(200)
  @RequirePermissions('marks:enter')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Import marks from an exported Excel sheet',
    description:
      'All-or-nothing. Blank cells are left unchanged. Use dryRun=true to preview the effect.',
  })
  importMarks(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ImportMarksQueryDto,
    @UploadedFile() file: Upload | undefined,
    @RequestedSchool() schoolId?: string,
  ): Promise<MarksImportResult> {
    if (!file)
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'Choose an Excel file to import.',
      });
    // An .xlsx file is a ZIP archive, which always starts with "PK".
    if (
      !/\.xlsx$/i.test(file.originalname) ||
      file.buffer.subarray(0, 2).toString('latin1') !== 'PK'
    ) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_FILE',
        message: 'Upload the Excel (.xlsx) file exported from this page.',
      });
    }
    return this.marks.importXlsx(
      { principal, meta },
      schoolId,
      id,
      query.classId,
      file.buffer,
      query.dryRun ?? false,
    );
  }
}
