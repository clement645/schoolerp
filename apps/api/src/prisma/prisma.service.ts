import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../config/env.schema.js';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';

/** Database role that tenant-scoped transactions run as (see ADR 0002). */
export const TENANT_DB_ROLE = 'edumaster_app';

export type TenantTransaction = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
      }),
      // Bulk work — importing a class list, compiling an examination — runs
      // as one transaction so it succeeds or fails as a whole; Prisma's
      // five-second default would abort it part-way.
      transactionOptions: { maxWait: 10_000, timeout: 60_000 },
    });
  }

  /** Fails application start-up early when the database is unreachable. */
  async onModuleInit(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs `work` in a transaction confined to one tenant.
   *
   * The transaction drops to the unprivileged tenant role and records the
   * tenant id, so PostgreSQL row-level security hides and write-protects every
   * other tenant's rows regardless of the queries `work` issues. All access to
   * tenant-owned data must go through here; calling models directly on this
   * service bypasses the policies and is reserved for authentication and
   * platform administration.
   */
  async withTenant<T>(tenantId: string, work: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      // set_config is parameterised; the role name is a compile-time constant.
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${TENANT_DB_ROLE}`);
      return work(tx);
    });
  }
}
