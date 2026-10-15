import { Injectable, NotFoundException } from '@nestjs/common';
import { requireTenantId } from '../../common/auth/auth.decorators.js';
import type { Principal } from '../../common/auth/principal.js';
import {
  paginate,
  toSkipTake,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/http/pagination.js';
import { PrismaService, type TenantTransaction } from '../../prisma/prisma.service.js';

export type NotificationKind = 'ANNOUNCEMENT' | 'MESSAGE' | 'RESULTS_PUBLISHED' | 'SYSTEM';

export interface NotificationView {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  /** In-app path to open. */
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationList extends Paginated<NotificationView> {
  unread: number;
}

export interface NewNotification {
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
}

/** Who an announcement or a broadcast is for. */
export type Audience = 'EVERYONE' | 'STAFF' | 'PARENTS' | 'STUDENTS';

const PORTAL_ROLES = ['PARENT', 'STUDENT'];

/**
 * In-app notifications. They are written in the same transaction as the event
 * that causes them, so a notification never refers to something that did not
 * happen. Delivery is in-app only: nothing is sent by email or SMS.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Notifies users, skipping duplicates in the list. */
  async notify(
    tx: TenantTransaction,
    tenantId: string,
    userIds: readonly string[],
    notification: NewNotification,
  ): Promise<number> {
    const recipients = [...new Set(userIds)];
    if (recipients.length === 0) return 0;
    const { count } = await tx.notification.createMany({
      data: recipients.map((userId) => ({
        tenantId,
        userId,
        kind: notification.kind,
        title: notification.title.slice(0, 200),
        body: notification.body?.slice(0, 500) ?? null,
        link: notification.link ?? null,
      })),
    });
    return count;
  }

  /** The active users of a tenant that an audience covers. */
  async audience(tx: TenantTransaction, audience: Audience): Promise<string[]> {
    const users = await tx.user.findMany({
      where: {
        status: 'ACTIVE',
        ...(audience === 'STAFF'
          ? { roles: { some: { role: { key: { notIn: PORTAL_ROLES } } } } }
          : audience === 'PARENTS'
            ? { roles: { some: { role: { key: 'PARENT' } } } }
            : audience === 'STUDENTS'
              ? { roles: { some: { role: { key: 'STUDENT' } } } }
              : {}),
      },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }

  list(
    principal: Principal,
    query: PaginationQueryDto & { unreadOnly?: boolean },
  ): Promise<NotificationList> {
    return this.prisma.withTenant(requireTenantId(principal), async (tx) => {
      const mine = { userId: principal.userId };
      const where = { ...mine, ...(query.unreadOnly ? { readAt: null } : {}) };
      const [rows, total, unread] = await Promise.all([
        tx.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...toSkipTake(query) }),
        tx.notification.count({ where }),
        tx.notification.count({ where: { ...mine, readAt: null } }),
      ]);
      return {
        ...paginate(
          rows.map((row) => ({
            id: row.id,
            kind: row.kind,
            title: row.title,
            body: row.body,
            link: row.link,
            isRead: row.readAt !== null,
            createdAt: row.createdAt.toISOString(),
          })),
          total,
          query,
        ),
        unread,
      };
    });
  }

  /** Marks one of the caller's own notifications as read. */
  markRead(principal: Principal, id: string): Promise<void> {
    return this.prisma.withTenant(requireTenantId(principal), async (tx) => {
      // The user id is part of the condition: nobody can touch another's.
      const { count } = await tx.notification.updateMany({
        where: { id, userId: principal.userId },
        data: { readAt: new Date() },
      });
      if (count === 0) {
        throw new NotFoundException({
          code: 'NOTIFICATION_NOT_FOUND',
          message: 'Notification not found.',
        });
      }
    });
  }

  markAllRead(principal: Principal): Promise<{ updated: number }> {
    return this.prisma.withTenant(requireTenantId(principal), async (tx) => {
      const { count } = await tx.notification.updateMany({
        where: { userId: principal.userId, readAt: null },
        data: { readAt: new Date() },
      });
      return { updated: count };
    });
  }
}
