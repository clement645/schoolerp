import { Injectable, NotFoundException } from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import { formatCalendarDate, parseCalendarDate } from '../../common/http/dates.js';
import { auditConfigChange, type Actor } from '../../common/school/config-audit.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { SaveAnnouncementDto } from './communication.dto.js';
import { NotificationsService, type Audience } from './notifications.service.js';

export interface AnnouncementView {
  id: string;
  title: string;
  body: string;
  audience: Audience;
  isPinned: boolean;
  expiresOn: string | null;
  /** Past its last day; only those who manage announcements still see it. */
  isExpired: boolean;
  author: string | null;
  createdAt: string;
}

const SELECT = {
  id: true,
  title: true,
  body: true,
  audience: true,
  isPinned: true,
  expiresOn: true,
  createdAt: true,
  createdBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.AnnouncementSelect;

const today = (): Date => new Date(new Date().setUTCHours(0, 0, 0, 0));

const toView = (
  row: Prisma.AnnouncementGetPayload<{ select: typeof SELECT }>,
): AnnouncementView => ({
  id: row.id,
  title: row.title,
  body: row.body,
  audience: row.audience,
  isPinned: row.isPinned,
  expiresOn: row.expiresOn ? formatCalendarDate(row.expiresOn) : null,
  isExpired: row.expiresOn !== null && row.expiresOn < today(),
  author: row.createdBy ? `${row.createdBy.firstName} ${row.createdBy.lastName}` : null,
  createdAt: row.createdAt.toISOString(),
});

/** The audiences whose announcements a person receives. */
export function audiencesFor(principal: Principal): Audience[] {
  const parent = principal.permissions.has('portal:parent');
  const student = principal.permissions.has('portal:student');
  if (!parent && !student) return ['EVERYONE', 'STAFF'];
  return [
    'EVERYONE',
    ...(parent ? (['PARENTS'] as const) : []),
    ...(student ? (['STUDENTS'] as const) : []),
  ];
}

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  list(principal: Principal, schoolId: string | undefined): Promise<AnnouncementView[]> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      // Those who write announcements see every one, including expired ones.
      const manages = principal.permissions.has('announcements:manage');
      const rows = await scope.tx.announcement.findMany({
        where: {
          schoolId: scope.schoolId,
          ...(manages
            ? {}
            : {
                audience: { in: audiencesFor(principal) },
                OR: [{ expiresOn: null }, { expiresOn: { gte: today() } }],
              }),
        },
        select: SELECT,
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        take: 200,
      });
      return rows.map(toView);
    });
  }

  /** Publishes an announcement and notifies everyone it is for. */
  create(
    actor: Actor,
    schoolId: string | undefined,
    dto: SaveAnnouncementDto,
  ): Promise<AnnouncementView> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const created = await scope.tx.announcement.create({
        data: {
          tenantId: scope.tenantId,
          schoolId: scope.schoolId,
          createdById: actor.principal.userId,
          ...this.data(dto),
        },
        select: SELECT,
      });
      const recipients = (await this.notifications.audience(scope.tx, dto.audience)).filter(
        (userId) => userId !== actor.principal.userId,
      );
      const notified = await this.notifications.notify(scope.tx, scope.tenantId, recipients, {
        kind: 'ANNOUNCEMENT',
        title: dto.title,
        body: dto.body,
        link: '/announcements',
      });
      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'announcement.created',
        { type: 'announcement', id: created.id },
        {
          title: created.title,
          audience: created.audience,
          notified,
        },
      );
      return toView(created);
    });
  }

  update(
    actor: Actor,
    schoolId: string | undefined,
    id: string,
    dto: SaveAnnouncementDto,
  ): Promise<AnnouncementView> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      await this.find(scope, id);
      const updated = await scope.tx.announcement.update({
        where: { id },
        data: this.data(dto),
        select: SELECT,
      });
      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'announcement.updated',
        { type: 'announcement', id },
        { title: updated.title },
      );
      return toView(updated);
    });
  }

  remove(actor: Actor, schoolId: string | undefined, id: string): Promise<void> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const existing = await this.find(scope, id);
      await scope.tx.announcement.delete({ where: { id } });
      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'announcement.deleted',
        { type: 'announcement', id },
        { title: existing.title },
      );
    });
  }

  private async find(scope: SchoolScope, id: string): Promise<{ title: string }> {
    const found = await scope.tx.announcement.findFirst({
      where: { id, schoolId: scope.schoolId },
      select: { title: true },
    });
    if (!found)
      throw new NotFoundException({
        code: 'ANNOUNCEMENT_NOT_FOUND',
        message: 'Announcement not found.',
      });
    return found;
  }

  private data(dto: SaveAnnouncementDto) {
    return {
      title: dto.title,
      body: dto.body,
      audience: dto.audience,
      isPinned: dto.isPinned ?? false,
      expiresOn: dto.expiresOn ? parseCalendarDate(dto.expiresOn) : null,
    };
  }
}
