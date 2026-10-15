import { Injectable, NotFoundException } from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import type { SchoolScope } from '../../common/school/school-scope.service.js';

export interface PortalChild {
  id: string;
  name: string;
  admissionNumber: string;
  class: string | null;
  stream: string | null;
  status: string;
  /** How the signed-in person is related; `SELF` for a student's own record. */
  relationship: string;
}

const STUDENT_SELECT = {
  id: true,
  firstName: true,
  middleName: true,
  lastName: true,
  admissionNumber: true,
  status: true,
  currentClass: { select: { name: true } },
  currentStream: { select: { name: true } },
} as const;

const toChild = (
  student: {
    id: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    admissionNumber: string;
    status: string;
    currentClass: { name: string } | null;
    currentStream: { name: string } | null;
  },
  relationship: string,
): PortalChild => ({
  id: student.id,
  name: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' '),
  admissionNumber: student.admissionNumber,
  class: student.currentClass?.name ?? null,
  stream: student.currentStream?.name ?? null,
  status: student.status,
  relationship,
});

/**
 * The one place that decides whose records a portal user may see: a parent,
 * the learners their guardian record is linked to; a student, their own.
 *
 * Every portal read goes through `requireChild`, which answers from the
 * database on each request. A learner who is not the caller's is reported as
 * not found — the same answer as for one that does not exist — so the portal
 * cannot be used to discover who is enrolled.
 */
@Injectable()
export class PortalAccessService {
  async children(scope: SchoolScope, principal: Principal): Promise<PortalChild[]> {
    const children = new Map<string, PortalChild>();

    if (principal.permissions.has('portal:parent')) {
      const links = await scope.tx.studentGuardian.findMany({
        where: { guardian: { userId: principal.userId, schoolId: scope.schoolId } },
        select: { relationship: true, student: { select: STUDENT_SELECT } },
        orderBy: { student: { firstName: 'asc' } },
      });
      for (const link of links)
        children.set(link.student.id, toChild(link.student, link.relationship));
    }
    if (principal.permissions.has('portal:student')) {
      const own = await scope.tx.student.findFirst({
        where: { userId: principal.userId, schoolId: scope.schoolId },
        select: STUDENT_SELECT,
      });
      if (own) children.set(own.id, toChild(own, 'SELF'));
    }
    return [...children.values()];
  }

  async requireChild(
    scope: SchoolScope,
    principal: Principal,
    studentId: string,
  ): Promise<PortalChild> {
    const child = (await this.children(scope, principal)).find((entry) => entry.id === studentId);
    if (!child)
      throw new NotFoundException({ code: 'STUDENT_NOT_FOUND', message: 'Student not found.' });
    return child;
  }
}
