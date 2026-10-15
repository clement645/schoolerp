import { Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../common/auth/principal.js';
import { paginate, toSkipTake, type Paginated } from '../../common/http/pagination.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type TenantTransaction } from '../../prisma/prisma.service.js';
import type { ListAuditLogsQueryDto } from './audit.dto.js';

/** Every auditable event. Names are stable: reports and alerts key on them. */
export type AuditAction =
  | 'auth.login.succeeded'
  | 'auth.login.failed'
  | 'auth.logout'
  | 'auth.refresh.reuse_detected'
  | 'auth.password.changed'
  | 'user.created'
  | 'user.updated'
  | 'user.roles.changed'
  | 'user.password.reset'
  | 'tenant.created'
  | 'tenant.status.changed'
  | 'school.updated'
  | 'school.settings.updated'
  | `${ConfigResource}.${'created' | 'updated' | 'deleted'}`
  | 'academic_year.set_current'
  | 'term.set_current'
  | 'class.subjects.changed'
  | 'grading_scheme.set_default'
  | 'student.created'
  | 'student.updated'
  | 'student.transferred'
  | 'student.status.changed'
  | 'student.promoted'
  | 'student.guardian.added'
  | 'student.guardian.updated'
  | 'student.guardian.removed'
  | 'student.photo.updated'
  | 'student.photo.removed'
  | 'student.document.uploaded'
  | 'student.document.downloaded'
  | 'student.document.deleted'
  | 'school.logo.updated'
  | 'school.logo.removed'
  | `examination.${'created' | 'updated' | 'deleted' | 'opened' | 'compiled' | 'reopened' | 'approved' | 'published'}`
  | 'marks.saved'
  | 'marks.imported'
  | 'marks.exported'
  | 'results.remarks.updated'
  | 'report_cards.generated'
  | 'attendance.marked'
  | `announcement.${'created' | 'updated' | 'deleted'}`
  | `timetable.slot.${'created' | 'updated' | 'deleted'}`
  | `portal.account.${'linked' | 'unlinked'}`
  | `calendar_event.${'created' | 'updated' | 'deleted'}`
  | `finance.fee_item.${'created' | 'updated'}`
  | `finance.fee_structure.${'created' | 'updated'}`
  | `finance.discount.${'created' | 'updated'}`
  | 'finance.invoice.issued'
  | 'finance.invoice.voided'
  | 'finance.invoices.generated'
  | 'finance.credit_note.issued'
  | 'finance.payment.recorded'
  | 'finance.payment.reversed'
  | 'finance.refund.issued'
  | 'finance.document.exported'
  | `finance.mpesa.${'requested' | 'confirmed' | 'failed'}`
  | 'students.imported'
  | 'students.exported'
  | 'teacher.created'
  | 'teacher.updated'
  | 'teacher.assignment.added'
  | 'teacher.assignment.removed';

/** School configuration records whose changes are audited uniformly. */
export type ConfigResource =
  'academic_year' | 'term' | 'class' | 'stream' | 'subject' | 'grading_scheme';

export interface AuditEntry {
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  tenantId?: string | null;
  schoolId?: string | null;
  actorId?: string | null;
  meta?: RequestMeta | null;
  /**
   * Structured details such as `{ before, after }`. Callers pass only the
   * fields they intend to record — never passwords, tokens or hashes.
   */
  details?: Prisma.InputJsonObject;
}

export interface AuditLogView {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actor: { id: string; name: string; email: string } | null;
  /**
   * True when the event was performed by platform staff. Their accounts sit
   * outside every tenant, so tenants are told who acted only in general terms.
   */
  byPlatformStaff: boolean;
  ipAddress: string | null;
  details: unknown;
  createdAt: Date;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Appends an audit record. Pass the surrounding transaction as `tx` so the
   * record commits or rolls back together with the change it describes.
   */
  async record(entry: AuditEntry, tx?: TenantTransaction): Promise<void> {
    await (tx ?? this.prisma).auditLog.create({
      data: {
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        tenantId: entry.tenantId ?? null,
        schoolId: entry.schoolId ?? null,
        actorId: entry.actorId ?? null,
        ipAddress: entry.meta?.ipAddress ?? null,
        userAgent: entry.meta?.userAgent ?? null,
        ...(entry.details ? { metadata: entry.details } : {}),
      },
    });
  }

  /** Appends several records at once, e.g. one per student of a bulk action. */
  async recordMany(entries: readonly AuditEntry[], tx?: TenantTransaction): Promise<void> {
    if (entries.length === 0) return;
    await (tx ?? this.prisma).auditLog.createMany({
      data: entries.map((entry) => ({
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        tenantId: entry.tenantId ?? null,
        schoolId: entry.schoolId ?? null,
        actorId: entry.actorId ?? null,
        ipAddress: entry.meta?.ipAddress ?? null,
        userAgent: entry.meta?.userAgent ?? null,
        ...(entry.details ? { metadata: entry.details } : {}),
      })),
    });
  }

  /**
   * Lists audit records, newest first. With a tenant id the query runs under
   * row-level security; without one (platform staff) it spans all tenants.
   */
  async list(
    tenantId: string | null,
    query: ListAuditLogsQueryDto,
  ): Promise<Paginated<AuditLogView>> {
    const where: Prisma.AuditLogWhereInput = query.action
      ? { action: { startsWith: query.action } }
      : {};

    const run = async (db: TenantTransaction | PrismaService) => {
      const [rows, total] = await Promise.all([
        db.auditLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...toSkipTake(query),
          select: {
            id: true,
            action: true,
            resourceType: true,
            resourceId: true,
            ipAddress: true,
            actorId: true,
            metadata: true,
            createdAt: true,
            actor: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        }),
        db.auditLog.count({ where }),
      ]);
      return { rows, total };
    };

    const { rows, total } = tenantId
      ? await this.prisma.withTenant(tenantId, run)
      : await run(this.prisma);

    return paginate(
      rows.map((row) => ({
        id: row.id,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        actor: row.actor
          ? {
              id: row.actor.id,
              name: `${row.actor.firstName} ${row.actor.lastName}`,
              email: row.actor.email,
            }
          : null,
        byPlatformStaff: row.actorId !== null && row.actor === null,
        ipAddress: row.ipAddress,
        details: row.metadata,
        createdAt: row.createdAt,
      })),
      total,
      query,
    );
  }
}
