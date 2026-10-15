import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import { auditConfigChange, type Actor } from '../../common/school/config-audit.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { SaveSlotDto, TimetableQueryDto } from './timetable.dto.js';
import { lessonsOverlap, shareLearners } from './timetable.rules.js';

export interface SlotView {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  class: { id: string; name: string };
  stream: { id: string; name: string } | null;
  subject: { id: string; name: string; code: string };
  teacher: { id: string; name: string } | null;
  room: string | null;
}

const SELECT = {
  id: true,
  dayOfWeek: true,
  startTime: true,
  endTime: true,
  classId: true,
  streamId: true,
  teacherId: true,
  room: true,
  class: { select: { id: true, name: true } },
  stream: { select: { id: true, name: true } },
  subject: { select: { id: true, name: true, code: true } },
  teacher: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.TimetableSlotSelect;

type Row = Prisma.TimetableSlotGetPayload<{ select: typeof SELECT }>;

const toView = (row: Row): SlotView => ({
  id: row.id,
  dayOfWeek: row.dayOfWeek,
  startTime: row.startTime,
  endTime: row.endTime,
  class: row.class,
  stream: row.stream,
  subject: row.subject,
  teacher: row.teacher && {
    id: row.teacher.id,
    name: `${row.teacher.firstName} ${row.teacher.lastName}`,
  },
  room: row.room,
});

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

@Injectable()
export class TimetableService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly audit: AuditService,
  ) {}

  list(
    principal: Principal,
    schoolId: string | undefined,
    query: TimetableQueryDto,
  ): Promise<SlotView[]> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      let teacherId = query.teacherId;
      if (query.mine) {
        const teacher = await scope.tx.teacher.findFirst({
          where: { userId: principal.userId, schoolId: scope.schoolId },
          select: { id: true },
        });
        // Someone who is not a teacher has no lessons of their own.
        if (!teacher) return [];
        teacherId = teacher.id;
      }
      if (!query.classId && !teacherId) {
        throw new BadRequestException({
          code: 'FILTER_REQUIRED',
          message: 'Choose a class or a teacher.',
        });
      }
      const rows = await scope.tx.timetableSlot.findMany({
        where: {
          schoolId: scope.schoolId,
          ...(teacherId ? { teacherId } : {}),
          ...(query.classId ? { classId: query.classId } : {}),
          // A stream's timetable includes lessons its whole class shares.
          ...(query.streamId ? { OR: [{ streamId: query.streamId }, { streamId: null }] } : {}),
        },
        select: SELECT,
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });
      return rows.map(toView);
    });
  }

  create(actor: Actor, schoolId: string | undefined, dto: SaveSlotDto): Promise<SlotView> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const data = await this.validated(scope, dto);
      const created = await scope.tx.timetableSlot.create({
        data: { tenantId: scope.tenantId, schoolId: scope.schoolId, ...data },
        select: SELECT,
      });
      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'timetable.slot.created',
        { type: 'timetable_slot', id: created.id },
        this.describe(created),
      );
      return toView(created);
    });
  }

  update(
    actor: Actor,
    schoolId: string | undefined,
    id: string,
    dto: SaveSlotDto,
  ): Promise<SlotView> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      await this.find(scope, id);
      const data = await this.validated(scope, dto, id);
      const updated = await scope.tx.timetableSlot.update({ where: { id }, data, select: SELECT });
      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'timetable.slot.updated',
        { type: 'timetable_slot', id },
        this.describe(updated),
      );
      return toView(updated);
    });
  }

  remove(actor: Actor, schoolId: string | undefined, id: string): Promise<void> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const existing = await this.find(scope, id);
      await scope.tx.timetableSlot.delete({ where: { id } });
      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'timetable.slot.deleted',
        { type: 'timetable_slot', id },
        this.describe(existing),
      );
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private describe(row: Row): Prisma.InputJsonObject {
    return {
      class: row.class.name,
      stream: row.stream?.name ?? null,
      day: DAYS[row.dayOfWeek] ?? String(row.dayOfWeek),
      time: `${row.startTime}-${row.endTime}`,
      subject: row.subject.name,
    };
  }

  private async find(scope: SchoolScope, id: string): Promise<Row> {
    const slot = await scope.tx.timetableSlot.findFirst({
      where: { id, schoolId: scope.schoolId },
      select: SELECT,
    });
    if (!slot)
      throw new NotFoundException({ code: 'SLOT_NOT_FOUND', message: 'Lesson not found.' });
    return slot;
  }

  /** Checks a lesson's parts exist and that it clashes with nothing. */
  private async validated(scope: SchoolScope, dto: SaveSlotDto, ignoreId?: string) {
    if (dto.endTime <= dto.startTime) {
      throw new BadRequestException({
        code: 'INVALID_TIME',
        message: 'A lesson must end after it starts.',
      });
    }
    const streamId = dto.streamId ?? null;
    const teacherId = dto.teacherId ?? null;

    const [schoolClass, classSubject, teacher] = await Promise.all([
      scope.tx.schoolClass.findFirst({
        where: { id: dto.classId, schoolId: scope.schoolId },
        select: { id: true, streams: { select: { id: true } } },
      }),
      scope.tx.classSubject.findFirst({
        where: { classId: dto.classId, subjectId: dto.subjectId },
        select: { subjectId: true },
      }),
      teacherId
        ? scope.tx.teacher.findFirst({
            where: { id: teacherId, schoolId: scope.schoolId, status: 'ACTIVE' },
            select: { id: true },
          })
        : null,
    ]);
    if (!schoolClass)
      throw new BadRequestException({
        code: 'CLASS_NOT_FOUND',
        message: 'The class does not exist.',
      });
    if (streamId && !schoolClass.streams.some((stream) => stream.id === streamId)) {
      throw new BadRequestException({
        code: 'STREAM_NOT_FOUND',
        message: 'That stream does not belong to the class.',
      });
    }
    if (!classSubject) {
      throw new BadRequestException({
        code: 'SUBJECT_NOT_TAKEN',
        message: 'The class does not take that subject.',
      });
    }
    if (teacherId && !teacher) {
      throw new BadRequestException({
        code: 'TEACHER_NOT_FOUND',
        message: 'The teacher does not exist or is not active.',
      });
    }

    // Everything else that day which could involve the same learners or teacher.
    const sameDay = await scope.tx.timetableSlot.findMany({
      where: {
        schoolId: scope.schoolId,
        dayOfWeek: dto.dayOfWeek,
        ...(ignoreId ? { id: { not: ignoreId } } : {}),
        OR: [{ classId: dto.classId }, ...(teacherId ? [{ teacherId }] : [])],
      },
      select: SELECT,
    });
    const clash = sameDay.find(
      (other) =>
        lessonsOverlap(dto, other) &&
        (shareLearners({ classId: dto.classId, streamId }, other) ||
          (teacherId !== null && other.teacherId === teacherId)),
    );
    if (clash) {
      const withTeacher =
        teacherId !== null &&
        clash.teacherId === teacherId &&
        !shareLearners({ classId: dto.classId, streamId }, clash);
      throw new ConflictException({
        code: 'TIMETABLE_CLASH',
        message: withTeacher
          ? `The teacher is already teaching ${clash.subject.name} to ${clash.class.name} from ${clash.startTime} to ${clash.endTime}.`
          : `${clash.class.name} already has ${clash.subject.name} from ${clash.startTime} to ${clash.endTime}.`,
      });
    }

    return {
      classId: dto.classId,
      streamId,
      dayOfWeek: dto.dayOfWeek,
      startTime: dto.startTime,
      endTime: dto.endTime,
      subjectId: dto.subjectId,
      teacherId,
      room: dto.room ?? null,
    };
  }
}
