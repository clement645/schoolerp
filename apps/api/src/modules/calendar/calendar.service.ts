import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import { formatCalendarDate, parseCalendarDate } from '../../common/http/dates.js';
import { auditConfigChange, type Actor } from '../../common/school/config-audit.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { EventsQueryDto, SaveEventDto } from './calendar.dto.js';

export interface CalendarEventView {
  id: string;
  title: string;
  description: string | null;
  category: 'ACADEMIC' | 'EXAMINATION' | 'HOLIDAY' | 'MEETING' | 'SPORTS' | 'OTHER';
  visibility: 'EVERYONE' | 'STAFF';
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
}

/** Longest window one calendar request may span. */
const MAX_WINDOW_DAYS = 400;

const SELECT = {
  id: true,
  title: true,
  description: true,
  category: true,
  visibility: true,
  startDate: true,
  endDate: true,
  startTime: true,
  endTime: true,
  location: true,
} satisfies Prisma.CalendarEventSelect;

const toView = (
  row: Prisma.CalendarEventGetPayload<{ select: typeof SELECT }>,
): CalendarEventView => ({
  ...row,
  startDate: formatCalendarDate(row.startDate),
  endDate: formatCalendarDate(row.endDate),
});

/** Parents and students see only what is meant for everyone. */
export const isPortalUser = (principal: Principal): boolean =>
  principal.permissions.has('portal:parent') || principal.permissions.has('portal:student');

@Injectable()
export class CalendarService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly audit: AuditService,
  ) {}

  list(
    principal: Principal,
    schoolId: string | undefined,
    query: EventsQueryDto,
  ): Promise<CalendarEventView[]> {
    const from = parseCalendarDate(query.from);
    const to = parseCalendarDate(query.to);
    if (to < from) {
      throw new BadRequestException({
        code: 'INVALID_RANGE',
        message: 'The start date must not be after the end date.',
      });
    }
    if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_WINDOW_DAYS) {
      throw new BadRequestException({
        code: 'RANGE_TOO_LONG',
        message: `The calendar shows at most ${MAX_WINDOW_DAYS} days at a time.`,
      });
    }
    return this.scopes.run(principal, schoolId, (scope) =>
      this.between(scope, principal, from, to),
    );
  }

  /** Events overlapping a window, soonest first. Shared with the dashboard. */
  async between(
    scope: SchoolScope,
    principal: Principal,
    from: Date,
    to: Date,
    take?: number,
  ): Promise<CalendarEventView[]> {
    const rows = await scope.tx.calendarEvent.findMany({
      where: {
        schoolId: scope.schoolId,
        startDate: { lte: to },
        endDate: { gte: from },
        ...(isPortalUser(principal) ? { visibility: 'EVERYONE' } : {}),
      },
      select: SELECT,
      orderBy: [{ startDate: 'asc' }, { startTime: 'asc' }, { title: 'asc' }],
      ...(take ? { take } : {}),
    });
    return rows.map(toView);
  }

  create(
    actor: Actor,
    schoolId: string | undefined,
    dto: SaveEventDto,
  ): Promise<CalendarEventView> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const created = await scope.tx.calendarEvent.create({
        data: {
          tenantId: scope.tenantId,
          schoolId: scope.schoolId,
          createdById: actor.principal.userId,
          ...this.data(dto),
        },
        select: SELECT,
      });
      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'calendar_event.created',
        { type: 'calendar_event', id: created.id },
        { title: created.title },
      );
      return toView(created);
    });
  }

  update(
    actor: Actor,
    schoolId: string | undefined,
    id: string,
    dto: SaveEventDto,
  ): Promise<CalendarEventView> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      await this.find(scope, id);
      const updated = await scope.tx.calendarEvent.update({
        where: { id },
        data: this.data(dto),
        select: SELECT,
      });
      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'calendar_event.updated',
        { type: 'calendar_event', id },
        { title: updated.title },
      );
      return toView(updated);
    });
  }

  remove(actor: Actor, schoolId: string | undefined, id: string): Promise<void> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const event = await this.find(scope, id);
      await scope.tx.calendarEvent.delete({ where: { id } });
      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'calendar_event.deleted',
        { type: 'calendar_event', id },
        { title: event.title },
      );
    });
  }

  private async find(scope: SchoolScope, id: string): Promise<{ title: string }> {
    const event = await scope.tx.calendarEvent.findFirst({
      where: { id, schoolId: scope.schoolId },
      select: { title: true },
    });
    if (!event)
      throw new NotFoundException({ code: 'EVENT_NOT_FOUND', message: 'Event not found.' });
    return event;
  }

  private data(dto: SaveEventDto) {
    const startDate = parseCalendarDate(dto.startDate);
    const endDate = dto.endDate ? parseCalendarDate(dto.endDate) : startDate;
    if (endDate < startDate) {
      throw new BadRequestException({
        code: 'INVALID_RANGE',
        message: 'An event cannot end before it starts.',
      });
    }
    const startTime = dto.startTime ?? null;
    const endTime = dto.endTime ?? null;
    if (endTime && !startTime) {
      throw new BadRequestException({
        code: 'INVALID_TIME',
        message: 'Give a start time as well as an end time.',
      });
    }
    if (
      startTime &&
      endTime &&
      dto.startDate === (dto.endDate ?? dto.startDate) &&
      endTime <= startTime
    ) {
      throw new BadRequestException({
        code: 'INVALID_TIME',
        message: 'The end time must be after the start time.',
      });
    }
    return {
      title: dto.title,
      description: dto.description ?? null,
      category: dto.category,
      visibility: dto.visibility,
      startDate,
      endDate,
      startTime,
      endTime,
      location: dto.location ?? null,
    };
  }
}
