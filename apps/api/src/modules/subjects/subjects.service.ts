import { Injectable, NotFoundException } from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import { rethrowConflict } from '../../common/http/prisma-errors.js';
import { auditConfigChange, type Actor } from '../../common/school/config-audit.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { CreateSubjectDto, UpdateSubjectDto } from './subjects.dto.js';

export interface SubjectView {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  /** Number of classes this subject is taught in. */
  classCount: number;
}

const SUBJECT_SELECT = {
  id: true,
  name: true,
  code: true,
  isActive: true,
  _count: { select: { classes: true } },
} satisfies Prisma.SubjectSelect;

type SubjectRow = Prisma.SubjectGetPayload<{ select: typeof SUBJECT_SELECT }>;

const toView = ({ _count, ...subject }: SubjectRow): SubjectView => ({
  ...subject,
  classCount: _count.classes,
});

const DUPLICATE = 'Another subject already uses this name or code.';

@Injectable()
export class SubjectsService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly audit: AuditService,
  ) {}

  list(principal: Principal, schoolId: string | undefined): Promise<SubjectView[]> {
    return this.scopes.run(principal, schoolId, async ({ tx, schoolId: id }) => {
      const subjects = await tx.subject.findMany({
        where: { schoolId: id },
        select: SUBJECT_SELECT,
        orderBy: { name: 'asc' },
      });
      return subjects.map(toView);
    });
  }

  async create(
    actor: Actor,
    schoolId: string | undefined,
    dto: CreateSubjectDto,
  ): Promise<SubjectView> {
    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const subject = await scope.tx.subject.create({
          data: { tenantId: scope.tenantId, schoolId: scope.schoolId, ...dto },
          select: SUBJECT_SELECT,
        });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'subject.created',
          { type: 'subject', id: subject.id },
          { name: subject.name, code: subject.code },
        );
        return toView(subject);
      });
    } catch (error) {
      rethrowConflict(error, { duplicate: DUPLICATE });
    }
  }

  async update(
    actor: Actor,
    schoolId: string | undefined,
    subjectId: string,
    dto: UpdateSubjectDto,
  ): Promise<SubjectView> {
    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const before = await this.find(scope, subjectId);
        const after = await scope.tx.subject.update({
          where: { id: subjectId },
          data: dto,
          select: SUBJECT_SELECT,
        });
        const pick = ({ name, code, isActive }: SubjectRow) => ({ name, code, isActive });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'subject.updated',
          { type: 'subject', id: subjectId },
          { before: pick(before), after: pick(after) },
        );
        return toView(after);
      });
    } catch (error) {
      rethrowConflict(error, { duplicate: DUPLICATE });
    }
  }

  async delete(actor: Actor, schoolId: string | undefined, subjectId: string): Promise<void> {
    try {
      await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const subject = await this.find(scope, subjectId);
        await scope.tx.subject.delete({ where: { id: subjectId } });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'subject.deleted',
          { type: 'subject', id: subjectId },
          { name: subject.name, code: subject.code },
        );
      });
    } catch (error) {
      rethrowConflict(error, {
        inUse:
          'This subject is taught in one or more classes and cannot be deleted. Mark it inactive instead.',
      });
    }
  }

  private async find(scope: SchoolScope, subjectId: string): Promise<SubjectRow> {
    const subject = await scope.tx.subject.findFirst({
      where: { id: subjectId, schoolId: scope.schoolId },
      select: SUBJECT_SELECT,
    });
    if (!subject) {
      throw new NotFoundException({ code: 'SUBJECT_NOT_FOUND', message: 'Subject not found.' });
    }
    return subject;
  }
}
