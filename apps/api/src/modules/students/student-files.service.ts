import { Injectable, NotFoundException } from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import { ClassScopeService } from '../../common/school/class-scope.service.js';
import type { Actor } from '../../common/school/config-audit.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  DOCUMENT_POLICY,
  IMAGE_POLICY,
  sanitizeFileName,
  validateUpload,
  type UploadedFile,
} from '../../storage/file-types.js';
import { StorageService, type StoredObject } from '../../storage/storage.service.js';
import { AuditService, type AuditAction } from '../audit/audit.service.js';
import type { UploadDocumentDto } from './student-files.dto.js';

export interface DocumentView {
  id: string;
  title: string;
  category: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  createdAt: Date;
}

export interface FileToSend {
  object: StoredObject;
  contentType: string;
  fileName: string;
}

const DOCUMENT_SELECT = {
  id: true,
  title: true,
  category: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  createdAt: true,
  uploadedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.StudentDocumentSelect;

type DocumentRow = Prisma.StudentDocumentGetPayload<{ select: typeof DOCUMENT_SELECT }>;

const toView = ({ uploadedBy, ...document }: DocumentRow): DocumentView => ({
  ...document,
  uploadedBy: uploadedBy ? `${uploadedBy.firstName} ${uploadedBy.lastName}` : null,
});

const studentNotFound = () =>
  new NotFoundException({ code: 'STUDENT_NOT_FOUND', message: 'Student not found.' });

/**
 * Photographs and documents on a student's record.
 *
 * Writes go to storage first and the database second; if the database step
 * fails the new object is removed again. Replaced and deleted objects are
 * removed only after the database no longer refers to them, so a record never
 * points at a file that is gone.
 */
@Injectable()
export class StudentFilesService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly classScopes: ClassScopeService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  // ── Photograph ─────────────────────────────────────────────────────────────

  async setPhoto(
    actor: Actor,
    schoolId: string | undefined,
    studentId: string,
    file: UploadedFile | undefined,
  ): Promise<void> {
    const type = validateUpload(file, IMAGE_POLICY);
    const previous = await this.replaceFile(
      actor,
      schoolId,
      'students',
      type.extension,
      file,
      async (scope, key) => {
        const student = await this.findStudent(scope, studentId);
        await scope.tx.student.update({
          where: { id: studentId },
          data: { photoKey: key, photoContentType: type.contentType },
        });
        await this.record(scope, actor, 'student.photo.updated', studentId);
        return student.photoKey;
      },
      type.contentType,
    );
    await this.storage.remove(previous);
  }

  async removePhoto(actor: Actor, schoolId: string | undefined, studentId: string): Promise<void> {
    const previous = await this.scopes.run(actor.principal, schoolId, async (scope) => {
      const student = await this.findStudent(scope, studentId);
      if (!student.photoKey) return null;
      await scope.tx.student.update({
        where: { id: studentId },
        data: { photoKey: null, photoContentType: null },
      });
      await this.record(scope, actor, 'student.photo.removed', studentId);
      return student.photoKey;
    });
    await this.storage.remove(previous);
  }

  /** A student's photograph, for anyone allowed to see that student. */
  async getPhoto(
    principal: Principal,
    schoolId: string | undefined,
    studentId: string,
  ): Promise<FileToSend> {
    const student = await this.scopes.run(principal, schoolId, async (scope) => {
      const classScope = await this.classScopes.resolve(scope, principal);
      return scope.tx.student.findFirst({
        where: {
          AND: [
            { id: studentId, schoolId: scope.schoolId },
            this.classScopes.studentFilter(classScope),
          ],
        },
        select: { photoKey: true, photoContentType: true },
      });
    });
    if (!student) throw studentNotFound();
    if (!student.photoKey || !student.photoContentType) {
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: 'This student has no photo.',
      });
    }
    return {
      object: await this.storage.get(student.photoKey),
      contentType: student.photoContentType,
      fileName: 'photo',
    };
  }

  // ── Documents ──────────────────────────────────────────────────────────────

  listDocuments(
    principal: Principal,
    schoolId: string | undefined,
    studentId: string,
  ): Promise<DocumentView[]> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      await this.findStudent(scope, studentId);
      const documents = await scope.tx.studentDocument.findMany({
        where: { studentId },
        select: DOCUMENT_SELECT,
        orderBy: { createdAt: 'desc' },
      });
      return documents.map(toView);
    });
  }

  async uploadDocument(
    actor: Actor,
    schoolId: string | undefined,
    studentId: string,
    dto: UploadDocumentDto,
    file: UploadedFile | undefined,
  ): Promise<DocumentView> {
    const type = validateUpload(file, DOCUMENT_POLICY);
    const fileName = sanitizeFileName(file?.originalname ?? '', type.extension);
    let created: DocumentRow | undefined;

    await this.replaceFile(
      actor,
      schoolId,
      'documents',
      type.extension,
      file,
      async (scope, key) => {
        await this.findStudent(scope, studentId);
        created = await scope.tx.studentDocument.create({
          data: {
            tenantId: scope.tenantId,
            schoolId: scope.schoolId,
            studentId,
            title: dto.title,
            category: dto.category,
            fileName,
            contentType: type.contentType,
            sizeBytes: file?.size ?? 0,
            storageKey: key,
            uploadedById: actor.principal.userId,
          },
          select: DOCUMENT_SELECT,
        });
        await this.record(scope, actor, 'student.document.uploaded', studentId, {
          documentId: created.id,
          title: dto.title,
          category: dto.category,
        });
        return null;
      },
      type.contentType,
    );

    if (!created) throw new Error('Document was not created');
    return toView(created);
  }

  /** Opening a personal document is itself recorded. */
  async downloadDocument(
    actor: Actor,
    schoolId: string | undefined,
    studentId: string,
    documentId: string,
  ): Promise<FileToSend> {
    const document = await this.scopes.run(actor.principal, schoolId, async (scope) => {
      const found = await this.findDocument(scope, studentId, documentId);
      await this.record(scope, actor, 'student.document.downloaded', studentId, {
        documentId,
        title: found.title,
      });
      return found;
    });
    return {
      object: await this.storage.get(document.storageKey),
      contentType: document.contentType,
      fileName: document.fileName,
    };
  }

  async deleteDocument(
    actor: Actor,
    schoolId: string | undefined,
    studentId: string,
    documentId: string,
  ): Promise<void> {
    const key = await this.scopes.run(actor.principal, schoolId, async (scope) => {
      const document = await this.findDocument(scope, studentId, documentId);
      await scope.tx.studentDocument.delete({ where: { id: documentId } });
      await this.record(scope, actor, 'student.document.deleted', studentId, {
        documentId,
        title: document.title,
      });
      return document.storageKey;
    });
    await this.storage.remove(key);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * Stores `file` under a fresh key, then runs `persist` to record it. If
   * recording fails the stored object is removed. Returns whatever `persist`
   * returns (the key of a file being replaced, if any).
   */
  private async replaceFile(
    actor: Actor,
    schoolId: string | undefined,
    folder: string,
    extension: string,
    file: UploadedFile | undefined,
    persist: (scope: SchoolScope, key: string) => Promise<string | null>,
    contentType: string,
  ): Promise<string | null> {
    if (!file) return null;
    // Resolve the school first so the key is namespaced by the right tenant
    // and nothing is stored for a request that was never going to be allowed.
    const tenantId = await this.scopes.run(actor.principal, schoolId, (scope) =>
      Promise.resolve(scope.tenantId),
    );
    const key = this.storage.buildKey(tenantId, folder, extension);
    await this.storage.put(key, file.buffer, contentType);
    try {
      return await this.scopes.run(actor.principal, schoolId, (scope) => persist(scope, key));
    } catch (error) {
      await this.storage.remove(key);
      throw error;
    }
  }

  private async findStudent(scope: SchoolScope, studentId: string) {
    const student = await scope.tx.student.findFirst({
      where: { id: studentId, schoolId: scope.schoolId },
      select: { id: true, photoKey: true },
    });
    if (!student) throw studentNotFound();
    return student;
  }

  private async findDocument(scope: SchoolScope, studentId: string, documentId: string) {
    await this.findStudent(scope, studentId);
    const document = await scope.tx.studentDocument.findFirst({
      where: { id: documentId, studentId },
      select: { title: true, fileName: true, contentType: true, storageKey: true },
    });
    if (!document) {
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Document not found.' });
    }
    return document;
  }

  private record(
    scope: SchoolScope,
    actor: Actor,
    action: AuditAction,
    studentId: string,
    details?: Prisma.InputJsonObject,
  ): Promise<void> {
    return this.audit.record(
      {
        action,
        resourceType: 'student',
        resourceId: studentId,
        tenantId: scope.tenantId,
        schoolId: scope.schoolId,
        actorId: actor.principal.userId,
        meta: actor.meta,
        details,
      },
      scope.tx,
    );
  }
}
