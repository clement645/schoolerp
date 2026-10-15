import { Module } from '@nestjs/common';
import { RbacSyncService } from './rbac-sync.service.js';
import { RolesController } from './roles.controller.js';

@Module({
  controllers: [RolesController],
  providers: [RbacSyncService],
  exports: [RbacSyncService],
})
export class RbacModule {}
