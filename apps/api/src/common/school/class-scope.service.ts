import { Injectable } from '@nestjs/common';
import type { Principal } from '../auth/principal.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { SchoolScope } from './school-scope.service.js';

export interface Placement {
  classId: string;
  /** Null means every stream of the class. */
  streamId: string | null;
}

/**
 * Which classes a caller may work with. Staff holding `records:all_classes`
 * are unrestricted; everyone else is limited to what they are assigned to
 * teach in the current academic year.
 */
export type ClassScope = { all: true } | { all: false; placements: Placement[] };

/** Matches nothing: used when a caller has no assignments at all. */
const NOTHING: Prisma.StudentWhereInput = { id: { in: [] } };

@Injectable()
export class ClassScopeService {
  async resolve(scope: SchoolScope, principal: Principal): Promise<ClassScope> {
    if (principal.permissions.has('records:all_classes')) return { all: true };

    const assignments = await scope.tx.teacherAssignment.findMany({
      where: {
        schoolId: scope.schoolId,
        academicYear: { isCurrent: true },
        teacher: { userId: principal.userId, status: 'ACTIVE' },
      },
      select: { classId: true, streamId: true },
    });
    return { all: false, placements: narrow(assignments) };
  }

  /** A filter that restricts a student query to the caller's classes. */
  studentFilter(classScope: ClassScope): Prisma.StudentWhereInput {
    if (classScope.all) return {};
    if (classScope.placements.length === 0) return NOTHING;
    return {
      OR: classScope.placements.map(({ classId, streamId }) =>
        streamId
          ? { currentClassId: classId, currentStreamId: streamId }
          : { currentClassId: classId },
      ),
    };
  }

  /** Whether a placement falls inside the caller's classes. */
  covers(classScope: ClassScope, target: Placement): boolean {
    if (classScope.all) return true;
    return classScope.placements.some(
      (held) =>
        held.classId === target.classId &&
        (held.streamId === null || held.streamId === target.streamId),
    );
  }
}

/**
 * Removes redundancy: an assignment to a whole class already includes every
 * stream of it, and duplicates (several subjects, same class) collapse.
 */
export function narrow(assignments: readonly Placement[]): Placement[] {
  const wholeClasses = new Set(
    assignments.filter((a) => a.streamId === null).map((a) => a.classId),
  );
  const seen = new Set<string>();
  const result: Placement[] = [];

  for (const { classId, streamId } of assignments) {
    const effectiveStream = wholeClasses.has(classId) ? null : streamId;
    const key = `${classId}:${effectiveStream ?? '*'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ classId, streamId: effectiveStream });
  }
  return result;
}
