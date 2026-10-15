import type { Principal, RequestMeta } from '../auth/principal.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AuditAction, AuditService } from '../../modules/audit/audit.service.js';
import type { SchoolScope } from './school-scope.service.js';

/** Who is making a change, and from where. */
export interface Actor {
  principal: Principal;
  meta: RequestMeta;
}

/** Records a school-configuration change in the same transaction as the change. */
export function auditConfigChange(
  audit: AuditService,
  scope: SchoolScope,
  actor: Actor,
  action: AuditAction,
  resource: { type: string; id: string },
  details?: Prisma.InputJsonObject,
): Promise<void> {
  return audit.record(
    {
      action,
      resourceType: resource.type,
      resourceId: resource.id,
      tenantId: scope.tenantId,
      schoolId: scope.schoolId,
      actorId: actor.principal.userId,
      meta: actor.meta,
      details,
    },
    scope.tx,
  );
}
