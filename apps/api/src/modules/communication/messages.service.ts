import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import type { ReplyDto, StartThreadDto } from './communication.dto.js';
import { NotificationsService } from './notifications.service.js';

export interface Correspondent {
  id: string;
  name: string;
  /** How the person appears to others: their main role. */
  role: string;
}

export interface ThreadSummary {
  id: string;
  subject: string;
  participants: Correspondent[];
  lastMessage: { body: string; sender: string | null; sentAt: string } | null;
  hasUnread: boolean;
}

export interface ThreadDetail {
  id: string;
  subject: string;
  participants: Correspondent[];
  messages: {
    id: string;
    body: string;
    sender: Correspondent | null;
    isMine: boolean;
    sentAt: string;
  }[];
}

const PORTAL_ROLES = ['PARENT', 'STUDENT'];
const USER = {
  id: true,
  firstName: true,
  lastName: true,
  roles: { select: { role: { select: { key: true, name: true } } } },
} as const;

type UserRow = {
  id: string;
  firstName: string;
  lastName: string;
  roles: { role: { key: string; name: string } }[];
};

const toCorrespondent = (user: UserRow): Correspondent => ({
  id: user.id,
  name: `${user.firstName} ${user.lastName}`,
  role: user.roles[0]?.role.name ?? 'User',
});
const isStaff = (user: UserRow): boolean =>
  user.roles.some((entry) => !PORTAL_ROLES.includes(entry.role.key));
const isPortalCaller = (principal: Principal): boolean =>
  principal.permissions.has('portal:parent') || principal.permissions.has('portal:student');

const notFound = (): NotFoundException =>
  new NotFoundException({ code: 'THREAD_NOT_FOUND', message: 'Conversation not found.' });

/**
 * Private conversations. A conversation is visible only to its participants:
 * every read and write is conditioned on the caller being one, and anyone
 * else is told it does not exist.
 *
 * Staff may write to anyone in the school. Parents may write to staff only,
 * so the portal cannot be used to contact other families.
 */
@Injectable()
export class MessagesService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  /** People the caller may start a conversation with. */
  recipients(
    principal: Principal,
    schoolId: string | undefined,
    search?: string,
  ): Promise<Correspondent[]> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const term = search?.trim();
      const users = await scope.tx.user.findMany({
        where: {
          status: 'ACTIVE',
          id: { not: principal.userId },
          ...(isPortalCaller(principal)
            ? { roles: { some: { role: { key: { notIn: PORTAL_ROLES } } } } }
            : {}),
          ...(term
            ? {
                OR: [
                  { firstName: { contains: term, mode: 'insensitive' } },
                  { lastName: { contains: term, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        select: USER,
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        take: 20,
      });
      return users.map(toCorrespondent);
    });
  }

  threads(principal: Principal, schoolId: string | undefined): Promise<ThreadSummary[]> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const mine = await scope.tx.threadParticipant.findMany({
        where: { userId: principal.userId, thread: { schoolId: scope.schoolId } },
        select: {
          lastReadAt: true,
          thread: {
            select: {
              id: true,
              subject: true,
              lastMessageAt: true,
              participants: { select: { user: { select: USER } } },
              messages: {
                select: {
                  body: true,
                  createdAt: true,
                  senderId: true,
                  sender: { select: { firstName: true, lastName: true } },
                },
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
          },
        },
        orderBy: { thread: { lastMessageAt: 'desc' } },
        take: 100,
      });
      return mine.map(({ lastReadAt, thread }) => {
        const last = thread.messages[0];
        return {
          id: thread.id,
          subject: thread.subject,
          participants: thread.participants
            .filter((entry) => entry.user.id !== principal.userId)
            .map((entry) => toCorrespondent(entry.user)),
          lastMessage: last
            ? {
                body: last.body.length > 140 ? `${last.body.slice(0, 140)}…` : last.body,
                sender: last.sender ? `${last.sender.firstName} ${last.sender.lastName}` : null,
                sentAt: last.createdAt.toISOString(),
              }
            : null,
          hasUnread:
            last !== undefined &&
            last.senderId !== principal.userId &&
            (lastReadAt === null || last.createdAt > lastReadAt),
        };
      });
    });
  }

  /** Opens a conversation, marking it read for the caller. */
  thread(principal: Principal, schoolId: string | undefined, id: string): Promise<ThreadDetail> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      await this.requireParticipant(scope, principal, id);
      await scope.tx.threadParticipant.update({
        where: { threadId_userId: { threadId: id, userId: principal.userId } },
        data: { lastReadAt: new Date() },
      });
      return this.load(scope, principal, id);
    });
  }

  start(
    principal: Principal,
    schoolId: string | undefined,
    dto: StartThreadDto,
  ): Promise<ThreadDetail> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const ids = dto.recipientIds.filter((id) => id !== principal.userId);
      // Row-level security confines this to the caller's tenant.
      const recipients = await scope.tx.user.findMany({
        where: { id: { in: ids }, status: 'ACTIVE' },
        select: USER,
      });
      if (ids.length === 0 || recipients.length !== ids.length) {
        throw new UnprocessableEntityException({
          code: 'RECIPIENT_NOT_FOUND',
          message: 'One or more recipients could not be found.',
        });
      }
      if (isPortalCaller(principal) && !recipients.every(isStaff)) {
        throw new ForbiddenException({
          code: 'RECIPIENT_NOT_ALLOWED',
          message: 'You can send messages to school staff only.',
        });
      }

      const now = new Date();
      const thread = await scope.tx.messageThread.create({
        data: {
          tenantId: scope.tenantId,
          schoolId: scope.schoolId,
          subject: dto.subject,
          createdById: principal.userId,
          lastMessageAt: now,
          participants: {
            create: [
              { tenantId: scope.tenantId, userId: principal.userId, lastReadAt: now },
              ...ids.map((userId) => ({ tenantId: scope.tenantId, userId })),
            ],
          },
          messages: {
            create: {
              tenantId: scope.tenantId,
              senderId: principal.userId,
              body: dto.body,
              createdAt: now,
            },
          },
        },
        select: { id: true },
      });
      await this.announce(scope, principal, thread.id, dto.subject, dto.body, ids);
      return this.load(scope, principal, thread.id);
    });
  }

  reply(
    principal: Principal,
    schoolId: string | undefined,
    id: string,
    dto: ReplyDto,
  ): Promise<ThreadDetail> {
    return this.scopes.run(principal, schoolId, async (scope) => {
      const thread = await this.requireParticipant(scope, principal, id);
      const now = new Date();
      await scope.tx.message.create({
        data: {
          tenantId: scope.tenantId,
          threadId: id,
          senderId: principal.userId,
          body: dto.body,
          createdAt: now,
        },
      });
      await scope.tx.messageThread.update({ where: { id }, data: { lastMessageAt: now } });
      await scope.tx.threadParticipant.update({
        where: { threadId_userId: { threadId: id, userId: principal.userId } },
        data: { lastReadAt: now },
      });
      const others = thread.participants
        .map((entry) => entry.userId)
        .filter((userId) => userId !== principal.userId);
      await this.announce(scope, principal, id, thread.subject, dto.body, others);
      return this.load(scope, principal, id);
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async requireParticipant(scope: SchoolScope, principal: Principal, id: string) {
    const thread = await scope.tx.messageThread.findFirst({
      where: { id, schoolId: scope.schoolId, participants: { some: { userId: principal.userId } } },
      select: { subject: true, participants: { select: { userId: true } } },
    });
    if (!thread) throw notFound();
    return thread;
  }

  private async load(scope: SchoolScope, principal: Principal, id: string): Promise<ThreadDetail> {
    const thread = await scope.tx.messageThread.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        subject: true,
        participants: { select: { user: { select: USER } } },
        messages: {
          select: {
            id: true,
            body: true,
            createdAt: true,
            senderId: true,
            sender: { select: USER },
          },
          orderBy: { createdAt: 'asc' },
          take: 500,
        },
      },
    });
    return {
      id: thread.id,
      subject: thread.subject,
      participants: thread.participants.map((entry) => toCorrespondent(entry.user)),
      messages: thread.messages.map((message) => ({
        id: message.id,
        body: message.body,
        sender: message.sender ? toCorrespondent(message.sender) : null,
        isMine: message.senderId === principal.userId,
        sentAt: message.createdAt.toISOString(),
      })),
    };
  }

  private async announce(
    scope: SchoolScope,
    principal: Principal,
    threadId: string,
    subject: string,
    body: string,
    recipients: string[],
  ): Promise<void> {
    const sender = await scope.tx.user.findUnique({
      where: { id: principal.userId },
      select: { firstName: true, lastName: true },
    });
    await this.notifications.notify(scope.tx, scope.tenantId, recipients, {
      kind: 'MESSAGE',
      title: `${sender ? `${sender.firstName} ${sender.lastName}` : 'Someone'}: ${subject}`,
      body,
      link: `/messages?thread=${threadId}`,
    });
  }
}
