import { fileURLToPath } from 'node:url';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthGuard } from './common/auth/auth.guard.js';
import { PermissionsGuard } from './common/auth/permissions.guard.js';
import { isStrictlyRateLimited } from './common/http/rate-limit.js';
import { RedisThrottlerStorage } from './common/http/redis-throttler.storage.js';
import { ThrottlerStorageModule } from './common/http/throttler-storage.module.js';
import { SchoolScopeModule } from './common/school/school-scope.module.js';
import { validateEnv, type Env } from './config/env.schema.js';
import { AttendanceModule } from './modules/attendance/attendance.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CalendarModule } from './modules/calendar/calendar.module.js';
import { CommunicationModule } from './modules/communication/communication.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { ExaminationsModule } from './modules/examinations/examinations.module.js';
import { PortalModule } from './modules/portal/portal.module.js';
import { ReportCardsModule } from './modules/report-cards/report-cards.module.js';
import { FinanceModule } from './modules/finance/finance.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { PeopleModule } from './modules/people.module.js';
import { PlatformModule } from './modules/platform/platform.module.js';
import { RbacModule } from './modules/rbac/rbac.module.js';
import { SchoolConfigModule } from './modules/school-config.module.js';
import { TimetableModule } from './modules/timetable/timetable.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { StorageModule } from './storage/storage.module.js';

// The monorepo keeps one `.env` at the repository root (three levels above
// both `src/` and the compiled `dist/`). Real environment variables win, and
// the file is simply absent in containerised deployments.
const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: rootEnvFile,
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      imports: [ThrottlerStorageModule],
      inject: [ConfigService, RedisThrottlerStorage],
      useFactory: (config: ConfigService<Env, true>, storage: RedisThrottlerStorage) => {
        const general = config.get('RATE_LIMIT_PER_MINUTE', { infer: true });
        const strict = config.get('RATE_LIMIT_LOGIN_PER_MINUTE', { infer: true });
        return {
          // Counters live in Redis, so the limit holds across instances.
          storage,
          throttlers: [
            {
              ttl: 60_000,
              // Counted per client IP and per route.
              limit: (context) => (isStrictlyRateLimited(context) ? strict : general),
            },
          ],
        };
      },
    }),
    PrismaModule,
    RedisModule,
    StorageModule,
    AuditModule,
    AuthModule,
    SchoolScopeModule,
    RbacModule,
    HealthModule,
    UsersModule,
    PlatformModule,
    SchoolConfigModule,
    PeopleModule,
    ExaminationsModule,
    ReportCardsModule,
    AttendanceModule,
    FinanceModule,
    CalendarModule,
    DashboardModule,
    PortalModule,
    CommunicationModule,
    TimetableModule,
  ],
  providers: [
    // Order matters: throttle first, then authenticate, then authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
