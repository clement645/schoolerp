import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import { rethrowConflict } from '../../common/http/prisma-errors.js';
import { auditConfigChange, type Actor } from '../../common/school/config-audit.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type {
  CreateClassDto,
  SaveStreamDto,
  SetClassSubjectsDto,
  UpdateClassDto,
} from './classes.dto.js';

export interface StreamView {
  id: string;
  classId: string;
  name: string;
  capacity: number | null;
}

export interface ClassSubjectView {
  subjectId: string;
  name: string;
  code: string;
  isCompulsory: boolean;
}

export interface ClassView {
  id: string;
  name: string;
  level: number;
  isActive: boolean;
  /** The scheme set on the class, or `null` when it follows the school default. */
  gradingScheme: { id: string; name: string } | null;
  streams: StreamView[];
  subjects: ClassSubjectView[];
}

const STREAM_SELECT = {
  id: true,
  classId: true,
  name: true,
  capacity: true,
} satisfies Prisma.StreamSelect;

const CLASS_SELECT = {
  id: true,
  name: true,
  level: true,
  isActive: true,
  gradingScheme: { select: { id: true, name: true } },
  streams: { select: STREAM_SELECT, orderBy: { name: 'asc' } },
  subjects: {
    select: { isCompulsory: true, subject: { select: { id: true, name: true, code: true } } },
    orderBy: { subject: { name: 'asc' } },
  },
} satisfies Prisma.SchoolClassSelect;

type ClassRow = Prisma.SchoolClassGetPayload<{ select: typeof CLASS_SELECT }>;

const toView = ({ subjects, ...schoolClass }: ClassRow): ClassView => ({
  ...schoolClass,
  subjects: subjects.map(({ isCompulsory, subject }) => ({
    subjectId: subject.id,
    name: subject.name,
    code: subject.code,
    isCompulsory,
  })),
});

const DUPLICATE_CLASS = 'Another class already has this name.';
const DUPLICATE_STREAM = 'This class already has a stream with that name.';

@Injectable()
export class ClassesService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly audit: AuditService,
  ) {}

  list(principal: Principal, schoolId: string | undefined): Promise<ClassView[]> {
    return this.scopes.run(principal, schoolId, async ({ tx, schoolId: id }) => {
      const classes = await tx.schoolClass.findMany({
        where: { schoolId: id },
        select: CLASS_SELECT,
        orderBy: [{ level: 'asc' }, { name: 'asc' }],
      });
      return classes.map(toView);
    });
  }

  async create(
    actor: Actor,
    schoolId: string | undefined,
    dto: CreateClassDto,
  ): Promise<ClassView> {
    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        await this.assertSchemeInSchool(scope, dto.gradingSchemeId);
        const created = await scope.tx.schoolClass.create({
          data: {
            tenantId: scope.tenantId,
            schoolId: scope.schoolId,
            name: dto.name,
            level: dto.level,
            gradingSchemeId: dto.gradingSchemeId ?? null,
          },
          select: CLASS_SELECT,
        });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'class.created',
          { type: 'class', id: created.id },
          { name: created.name, level: created.level },
        );
        return toView(created);
      });
    } catch (error) {
      rethrowConflict(error, { duplicate: DUPLICATE_CLASS });
    }
  }

  async update(
    actor: Actor,
    schoolId: string | undefined,
    classId: string,
    dto: UpdateClassDto,
  ): Promise<ClassView> {
    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const before = await this.find(scope, classId);
        await this.assertSchemeInSchool(scope, dto.gradingSchemeId);

        const after = await scope.tx.schoolClass.update({
          where: { id: classId },
          data: {
            name: dto.name,
            level: dto.level,
            isActive: dto.isActive,
            // `undefined` leaves the scheme alone; `null` reverts to the default.
            gradingSchemeId: dto.gradingSchemeId,
          },
          select: CLASS_SELECT,
        });
        const pick = (row: ClassRow) => ({
          name: row.name,
          level: row.level,
          isActive: row.isActive,
          gradingScheme: row.gradingScheme?.name ?? null,
        });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'class.updated',
          { type: 'class', id: classId },
          { before: pick(before), after: pick(after) },
        );
        return toView(after);
      });
    } catch (error) {
      rethrowConflict(error, { duplicate: DUPLICATE_CLASS });
    }
  }

  async delete(actor: Actor, schoolId: string | undefined, classId: string): Promise<void> {
    try {
      await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const schoolClass = await this.find(scope, classId);
        await scope.tx.schoolClass.delete({ where: { id: classId } });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'class.deleted',
          { type: 'class', id: classId },
          { name: schoolClass.name },
        );
      });
    } catch (error) {
      rethrowConflict(error, {
        inUse:
          'This class has streams or other records and cannot be deleted. Mark it inactive instead.',
      });
    }
  }

  /** Replaces the set of subjects taught in a class. */
  setSubjects(
    actor: Actor,
    schoolId: string | undefined,
    classId: string,
    dto: SetClassSubjectsDto,
  ): Promise<ClassView> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const before = await this.find(scope, classId);
      const requestedIds = dto.subjects.map((entry) => entry.subjectId);
      const alreadyAssigned = new Set(before.subjects.map(({ subject }) => subject.id));

      const known = await scope.tx.subject.findMany({
        where: { schoolId: scope.schoolId, id: { in: requestedIds } },
        select: { id: true, name: true, isActive: true },
      });
      if (known.length !== requestedIds.length) {
        throw new BadRequestException({
          code: 'UNKNOWN_SUBJECT',
          message: 'One or more subjects do not exist in this school.',
        });
      }
      // Retired subjects may stay on a class but cannot be newly added.
      const retired = known.find(
        (subject) => !subject.isActive && !alreadyAssigned.has(subject.id),
      );
      if (retired) {
        throw new BadRequestException({
          code: 'INACTIVE_SUBJECT',
          message: `"${retired.name}" is inactive and cannot be added to a class.`,
        });
      }

      await scope.tx.classSubject.deleteMany({
        where: { classId, subjectId: { notIn: requestedIds } },
      });
      for (const { subjectId, isCompulsory } of dto.subjects) {
        await scope.tx.classSubject.upsert({
          where: { classId_subjectId: { classId, subjectId } },
          create: {
            classId,
            subjectId,
            isCompulsory,
            tenantId: scope.tenantId,
            schoolId: scope.schoolId,
          },
          update: { isCompulsory },
        });
      }

      const after = await this.find(scope, classId);
      const codes = (row: ClassRow) => row.subjects.map(({ subject }) => subject.code).sort();
      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'class.subjects.changed',
        { type: 'class', id: classId },
        { class: after.name, before: codes(before), after: codes(after) },
      );
      return toView(after);
    });
  }

  async createStream(
    actor: Actor,
    schoolId: string | undefined,
    classId: string,
    dto: SaveStreamDto,
  ): Promise<StreamView> {
    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const schoolClass = await this.find(scope, classId);
        const stream = await scope.tx.stream.create({
          data: {
            tenantId: scope.tenantId,
            schoolId: scope.schoolId,
            classId,
            name: dto.name,
            capacity: dto.capacity ?? null,
          },
          select: STREAM_SELECT,
        });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'stream.created',
          { type: 'stream', id: stream.id },
          { class: schoolClass.name, name: stream.name },
        );
        return stream;
      });
    } catch (error) {
      rethrowConflict(error, { duplicate: DUPLICATE_STREAM });
    }
  }

  async updateStream(
    actor: Actor,
    schoolId: string | undefined,
    streamId: string,
    dto: SaveStreamDto,
  ): Promise<StreamView> {
    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const before = await this.findStream(scope, streamId);
        const after = await scope.tx.stream.update({
          where: { id: streamId },
          data: { name: dto.name, capacity: dto.capacity },
          select: STREAM_SELECT,
        });
        const pick = ({ name, capacity }: StreamView) => ({ name, capacity });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'stream.updated',
          { type: 'stream', id: streamId },
          { before: pick(before), after: pick(after) },
        );
        return after;
      });
    } catch (error) {
      rethrowConflict(error, { duplicate: DUPLICATE_STREAM });
    }
  }

  async deleteStream(actor: Actor, schoolId: string | undefined, streamId: string): Promise<void> {
    try {
      await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const stream = await this.findStream(scope, streamId);
        await scope.tx.stream.delete({ where: { id: streamId } });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'stream.deleted',
          { type: 'stream', id: streamId },
          { name: stream.name },
        );
      });
    } catch (error) {
      rethrowConflict(error, {
        inUse: 'This stream has records attached to it and cannot be deleted.',
      });
    }
  }

  private async find(scope: SchoolScope, classId: string): Promise<ClassRow> {
    const schoolClass = await scope.tx.schoolClass.findFirst({
      where: { id: classId, schoolId: scope.schoolId },
      select: CLASS_SELECT,
    });
    if (!schoolClass) {
      throw new NotFoundException({ code: 'CLASS_NOT_FOUND', message: 'Class not found.' });
    }
    return schoolClass;
  }

  private async findStream(scope: SchoolScope, streamId: string): Promise<StreamView> {
    const stream = await scope.tx.stream.findFirst({
      where: { id: streamId, schoolId: scope.schoolId },
      select: STREAM_SELECT,
    });
    if (!stream) {
      throw new NotFoundException({ code: 'STREAM_NOT_FOUND', message: 'Stream not found.' });
    }
    return stream;
  }

  private async assertSchemeInSchool(
    scope: SchoolScope,
    schemeId: string | null | undefined,
  ): Promise<void> {
    if (!schemeId) return;
    const scheme = await scope.tx.gradingScheme.findFirst({
      where: { id: schemeId, schoolId: scope.schoolId },
      select: { id: true },
    });
    if (!scheme) {
      throw new BadRequestException({
        code: 'UNKNOWN_GRADING_SCHEME',
        message: 'The selected grading scheme does not exist in this school.',
      });
    }
  }
}
