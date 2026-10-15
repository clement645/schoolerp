import { Injectable, NotFoundException } from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import { rethrowConflict } from '../../common/http/prisma-errors.js';
import { auditConfigChange, type Actor } from '../../common/school/config-audit.js';
import { SchoolScopeService } from '../../common/school/school-scope.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { IMAGE_POLICY, validateUpload, type UploadedFile } from '../../storage/file-types.js';
import { StorageService, type StoredObject } from '../../storage/storage.service.js';
import { loadPolicies, type SchoolPolicies } from '../../common/school/school-settings.js';
import type { UpdateSchoolDto, UpdateSchoolSettingsDto } from './schools.dto.js';

const SCHOOL_SELECT = {
  id: true,
  name: true,
  motto: true,
  addressLine: true,
  city: true,
  county: true,
  country: true,
  phone: true,
  email: true,
  website: true,
  logoKey: true,
} satisfies Prisma.SchoolSelect;

type SchoolRow = Prisma.SchoolGetPayload<{ select: typeof SCHOOL_SELECT }>;

export type SchoolView = Omit<SchoolRow, 'logoKey'> & {
  /** Whether a logo is on file (served by GET /school/logo). */
  hasLogo: boolean;
};

// The storage key itself never leaves the server.
const toView = ({ logoKey, ...school }: SchoolRow): SchoolView => ({
  ...school,
  hasLogo: logoKey !== null,
});

@Injectable()
export class SchoolsService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  get(principal: Principal, schoolId: string | undefined): Promise<SchoolView> {
    return this.scopes.run(principal, schoolId, async ({ tx, schoolId: id }) =>
      toView(await tx.school.findUniqueOrThrow({ where: { id }, select: SCHOOL_SELECT })),
    );
  }

  async update(
    actor: Actor,
    schoolId: string | undefined,
    dto: UpdateSchoolDto,
  ): Promise<SchoolView> {
    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const where = { id: scope.schoolId };
        const before = await scope.tx.school.findUniqueOrThrow({ where, select: SCHOOL_SELECT });
        const after = await scope.tx.school.update({ where, data: dto, select: SCHOOL_SELECT });

        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'school.updated',
          { type: 'school', id: scope.schoolId },
          { before: toView(before), after: toView(after) },
        );
        return toView(after);
      });
    } catch (error) {
      rethrowConflict(error, {
        duplicate: 'Another school in your account already has this name.',
      });
    }
  }

  async getLogo(
    principal: Principal,
    schoolId: string | undefined,
  ): Promise<{ object: StoredObject; contentType: string }> {
    const school = await this.scopes.run(principal, schoolId, ({ tx, schoolId: id }) =>
      tx.school.findUniqueOrThrow({
        where: { id },
        select: { logoKey: true, logoContentType: true },
      }),
    );
    if (!school.logoKey || !school.logoContentType) {
      throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'This school has no logo.' });
    }
    return { object: await this.storage.get(school.logoKey), contentType: school.logoContentType };
  }

  /** Uploads or replaces the logo. The new file is stored before the old one is removed. */
  async setLogo(
    actor: Actor,
    schoolId: string | undefined,
    file: UploadedFile | undefined,
  ): Promise<void> {
    const type = validateUpload(file, IMAGE_POLICY);
    if (!file) return;

    const tenantId = await this.scopes.run(actor.principal, schoolId, (scope) =>
      Promise.resolve(scope.tenantId),
    );
    const key = this.storage.buildKey(tenantId, 'school', type.extension);
    await this.storage.put(key, file.buffer, type.contentType);

    let previous: string | null;
    try {
      previous = await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const where = { id: scope.schoolId };
        const before = await scope.tx.school.findUniqueOrThrow({
          where,
          select: { logoKey: true },
        });
        await scope.tx.school.update({
          where,
          data: { logoKey: key, logoContentType: type.contentType },
        });
        await auditConfigChange(this.audit, scope, actor, 'school.logo.updated', {
          type: 'school',
          id: scope.schoolId,
        });
        return before.logoKey;
      });
    } catch (error) {
      await this.storage.remove(key);
      throw error;
    }
    await this.storage.remove(previous);
  }

  async removeLogo(actor: Actor, schoolId: string | undefined): Promise<void> {
    const previous = await this.scopes.run(actor.principal, schoolId, async (scope) => {
      const where = { id: scope.schoolId };
      const before = await scope.tx.school.findUniqueOrThrow({ where, select: { logoKey: true } });
      if (!before.logoKey) return null;
      await scope.tx.school.update({ where, data: { logoKey: null, logoContentType: null } });
      await auditConfigChange(this.audit, scope, actor, 'school.logo.removed', {
        type: 'school',
        id: scope.schoolId,
      });
      return before.logoKey;
    });
    await this.storage.remove(previous);
  }

  getSettings(principal: Principal, schoolId: string | undefined): Promise<SchoolPolicies> {
    return this.scopes.run(principal, schoolId, (scope) => loadPolicies(scope));
  }

  /** Policies take effect the next time results are compiled; compiled results keep theirs. */
  updateSettings(
    actor: Actor,
    schoolId: string | undefined,
    dto: UpdateSchoolSettingsDto,
  ): Promise<SchoolPolicies> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const before = await loadPolicies(scope);
      await scope.tx.schoolSettings.upsert({
        where: { schoolId: scope.schoolId },
        create: { schoolId: scope.schoolId, tenantId: scope.tenantId, ...dto },
        update: dto,
      });
      const after = await loadPolicies(scope);
      await auditConfigChange(
        this.audit,
        scope,
        actor,
        'school.settings.updated',
        { type: 'school', id: scope.schoolId },
        { before: { ...before }, after: { ...after } },
      );
      return after;
    });
  }
}
