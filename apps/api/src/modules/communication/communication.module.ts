import { Global, Module } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service.js';
import {
  AnnouncementsController,
  MessagesController,
  NotificationsController,
} from './communication.controller.js';
import { MessagesService } from './messages.service.js';
import { NotificationsService } from './notifications.service.js';

/** Global so any module can raise a notification without importing this one. */
@Global()
@Module({
  controllers: [AnnouncementsController, NotificationsController, MessagesController],
  providers: [NotificationsService, AnnouncementsService, MessagesService],
  exports: [NotificationsService],
})
export class CommunicationModule {}
