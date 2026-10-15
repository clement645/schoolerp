import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import {
  DOCUMENT_POLICY,
  IMAGE_POLICY,
  type UploadedFile as Upload,
} from '../../storage/file-types.js';
import { sendFile } from '../../storage/send-file.js';
import { UploadDocumentDto } from './student-files.dto.js';
import { StudentFilesService, type DocumentView } from './student-files.service.js';

// Multer rejects larger bodies before they are buffered in full.
const imageUpload = () =>
  FileInterceptor('file', { limits: { fileSize: IMAGE_POLICY.maxBytes, files: 1 } });
const documentUpload = () =>
  FileInterceptor('file', { limits: { fileSize: DOCUMENT_POLICY.maxBytes, files: 1 } });

@ApiTags('Student files')
@ApiBearerAuth()
@ApiHeader({ name: SCHOOL_HEADER, required: false })
@Controller('students/:id')
export class StudentFilesController {
  constructor(private readonly files: StudentFilesService) {}

  @Get('photo')
  @RequirePermissions('students:read')
  @ApiOperation({ summary: 'The student’s photograph' })
  async getPhoto(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    const photo = await this.files.getPhoto(principal, schoolId, id);
    sendFile(response, photo.object, {
      contentType: photo.contentType,
      fileName: photo.fileName,
      disposition: 'inline',
      maxAgeSeconds: 300,
    });
  }

  @Put('photo')
  @HttpCode(204)
  @RequirePermissions('students:manage')
  @UseInterceptors(imageUpload())
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload or replace the photograph (JPEG, PNG or WebP, up to 2 MB)' })
  setPhoto(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Upload | undefined,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    return this.files.setPhoto({ principal, meta }, schoolId, id, file);
  }

  @Delete('photo')
  @HttpCode(204)
  @RequirePermissions('students:manage')
  @ApiOperation({ summary: 'Remove the photograph' })
  removePhoto(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    return this.files.removePhoto({ principal, meta }, schoolId, id);
  }

  @Get('documents')
  @RequirePermissions('students:documents')
  @ApiOperation({ summary: 'Documents kept on the student’s record' })
  listDocuments(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<DocumentView[]> {
    return this.files.listDocuments(principal, schoolId, id);
  }

  @Post('documents')
  @RequirePermissions('students:manage', 'students:documents')
  @UseInterceptors(documentUpload())
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Add a document (PDF, JPEG or PNG, up to 5 MB)' })
  uploadDocument(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Upload | undefined,
    @RequestedSchool() schoolId?: string,
  ): Promise<DocumentView> {
    return this.files.uploadDocument({ principal, meta }, schoolId, id, dto, file);
  }

  @Get('documents/:documentId/download')
  @RequirePermissions('students:documents')
  @ApiOperation({ summary: 'Download a document (recorded in the audit log)' })
  async downloadDocument(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res() response: Response,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    const document = await this.files.downloadDocument(
      { principal, meta },
      schoolId,
      id,
      documentId,
    );
    sendFile(response, document.object, {
      contentType: document.contentType,
      fileName: document.fileName,
      // Always a download: a document is never rendered inside the application.
      disposition: 'attachment',
      maxAgeSeconds: 0,
    });
  }

  @Delete('documents/:documentId')
  @HttpCode(204)
  @RequirePermissions('students:manage', 'students:documents')
  @ApiOperation({ summary: 'Delete a document' })
  deleteDocument(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    return this.files.deleteDocument({ principal, meta }, schoolId, id, documentId);
  }
}
