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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedOnly,
  ClientMeta,
  CurrentUser,
  RequirePermissions,
} from '../../common/auth/auth.decorators.js';
import type { Principal, RequestMeta } from '../../common/auth/principal.js';
import { RequestedSchool, SCHOOL_HEADER } from '../../common/school/school-scope.service.js';
import { AnnouncementsService, type AnnouncementView } from './announcements.service.js';
import {
  NotificationsQueryDto,
  RecipientsQueryDto,
  ReplyDto,
  SaveAnnouncementDto,
  StartThreadDto,
} from './communication.dto.js';
import {
  MessagesService,
  type Correspondent,
  type ThreadDetail,
  type ThreadSummary,
} from './messages.service.js';
import { NotificationsService, type NotificationList } from './notifications.service.js';

const Id = () => Param('id', ParseUUIDPipe);

@ApiTags('Announcements')
@ApiBearerAuth()
@ApiHeader({ name: SCHOOL_HEADER, required: false })
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  @RequirePermissions('announcements:read')
  @ApiOperation({ summary: 'Announcements addressed to the caller' })
  list(
    @CurrentUser() principal: Principal,
    @RequestedSchool() schoolId?: string,
  ): Promise<AnnouncementView[]> {
    return this.announcements.list(principal, schoolId);
  }

  @Post()
  @RequirePermissions('announcements:manage')
  @ApiOperation({ summary: 'Publish an announcement and notify its audience' })
  create(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Body() dto: SaveAnnouncementDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<AnnouncementView> {
    return this.announcements.create({ principal, meta }, schoolId, dto);
  }

  @Put(':id')
  @RequirePermissions('announcements:manage')
  update(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Id() id: string,
    @Body() dto: SaveAnnouncementDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<AnnouncementView> {
    return this.announcements.update({ principal, meta }, schoolId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('announcements:manage')
  remove(
    @CurrentUser() principal: Principal,
    @ClientMeta() meta: RequestMeta,
    @Id() id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<void> {
    return this.announcements.remove({ principal, meta }, schoolId, id);
  }
}

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'The caller’s own notifications' })
  list(
    @CurrentUser() principal: Principal,
    @Query() query: NotificationsQueryDto,
  ): Promise<NotificationList> {
    return this.notifications.list(principal, query);
  }

  @Post('read-all')
  @HttpCode(200)
  @AuthenticatedOnly()
  markAllRead(@CurrentUser() principal: Principal): Promise<{ updated: number }> {
    return this.notifications.markAllRead(principal);
  }

  @Post(':id/read')
  @HttpCode(204)
  @AuthenticatedOnly()
  markRead(@CurrentUser() principal: Principal, @Id() id: string): Promise<void> {
    return this.notifications.markRead(principal, id);
  }
}

@ApiTags('Messages')
@ApiBearerAuth()
@ApiHeader({ name: SCHOOL_HEADER, required: false })
@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get('recipients')
  @RequirePermissions('messages:send')
  @ApiOperation({ summary: 'People the caller may write to' })
  recipients(
    @CurrentUser() principal: Principal,
    @Query() query: RecipientsQueryDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<Correspondent[]> {
    return this.messages.recipients(principal, schoolId, query.search);
  }

  @Get('threads')
  @RequirePermissions('messages:read')
  threads(
    @CurrentUser() principal: Principal,
    @RequestedSchool() schoolId?: string,
  ): Promise<ThreadSummary[]> {
    return this.messages.threads(principal, schoolId);
  }

  @Post('threads')
  @RequirePermissions('messages:send')
  @ApiOperation({ summary: 'Start a conversation' })
  start(
    @CurrentUser() principal: Principal,
    @Body() dto: StartThreadDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<ThreadDetail> {
    return this.messages.start(principal, schoolId, dto);
  }

  @Get('threads/:id')
  @RequirePermissions('messages:read')
  thread(
    @CurrentUser() principal: Principal,
    @Id() id: string,
    @RequestedSchool() schoolId?: string,
  ): Promise<ThreadDetail> {
    return this.messages.thread(principal, schoolId, id);
  }

  @Post('threads/:id/messages')
  @RequirePermissions('messages:send')
  reply(
    @CurrentUser() principal: Principal,
    @Id() id: string,
    @Body() dto: ReplyDto,
    @RequestedSchool() schoolId?: string,
  ): Promise<ThreadDetail> {
    return this.messages.reply(principal, schoolId, id, dto);
  }
}
