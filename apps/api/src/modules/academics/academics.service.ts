import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Principal } from '../../common/auth/principal.js';
import {
  formatCalendarDate,
  parseCalendarDate,
  rangeContains,
  rangesOverlap,
  type DateRange,
} from '../../common/http/dates.js';
import { rethrowConflict } from '../../common/http/prisma-errors.js';
import { auditConfigChange, type Actor } from '../../common/school/config-audit.js';
import { SchoolScopeService, type SchoolScope } from '../../common/school/school-scope.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type {
  CreateAcademicYearDto,
  CreateTermDto,
  UpdateAcademicYearDto,
  UpdateTermDto,
} from './academics.dto.js';

export interface TermView {
  id: string;
  academicYearId: string;
  name: string;
  sequence: number;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

export interface AcademicYearView {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  terms: TermView[];
}

const TERM_SELECT = {
  id: true,
  academicYearId: true,
  name: true,
  sequence: true,
  startDate: true,
  endDate: true,
  isCurrent: true,
} satisfies Prisma.TermSelect;

const YEAR_SELECT = {
  id: true,
  name: true,
  startDate: true,
  endDate: true,
  isCurrent: true,
  terms: { select: TERM_SELECT, orderBy: { sequence: 'asc' } },
} satisfies Prisma.AcademicYearSelect;

type TermRow = Prisma.TermGetPayload<{ select: typeof TERM_SELECT }>;
type YearRow = Prisma.AcademicYearGetPayload<{ select: typeof YEAR_SELECT }>;

const toTermView = (term: TermRow): TermView => ({
  ...term,
  startDate: formatCalendarDate(term.startDate),
  endDate: formatCalendarDate(term.endDate),
});

const toYearView = (year: YearRow): AcademicYearView => ({
  ...year,
  startDate: formatCalendarDate(year.startDate),
  endDate: formatCalendarDate(year.endDate),
  terms: year.terms.map(toTermView),
});

const invalid = (code: string, message: string) => new BadRequestException({ code, message });
const conflict = (code: string, message: string) => new ConflictException({ code, message });

function toRange(startDate: string, endDate: string): DateRange {
  const range = { startDate: parseCalendarDate(startDate), endDate: parseCalendarDate(endDate) };
  if (range.startDate >= range.endDate) {
    throw invalid('INVALID_DATE_RANGE', 'The end date must be after the start date.');
  }
  return range;
}

@Injectable()
export class AcademicsService {
  constructor(
    private readonly scopes: SchoolScopeService,
    private readonly audit: AuditService,
  ) {}

  listYears(principal: Principal, schoolId: string | undefined): Promise<AcademicYearView[]> {
    return this.scopes.run(principal, schoolId, async ({ tx, schoolId: id }) => {
      const years = await tx.academicYear.findMany({
        where: { schoolId: id },
        select: YEAR_SELECT,
        orderBy: { startDate: 'desc' },
      });
      return years.map(toYearView);
    });
  }

  async createYear(
    actor: Actor,
    schoolId: string | undefined,
    dto: CreateAcademicYearDto,
  ): Promise<AcademicYearView> {
    const range = toRange(dto.startDate, dto.endDate);
    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        await this.assertYearDoesNotOverlap(scope, range, null);
        // The first year a school creates is the one it is working in.
        const isCurrent =
          (await scope.tx.academicYear.count({ where: { schoolId: scope.schoolId } })) === 0;

        const year = await scope.tx.academicYear.create({
          data: {
            tenantId: scope.tenantId,
            schoolId: scope.schoolId,
            name: dto.name,
            ...range,
            isCurrent,
          },
          select: YEAR_SELECT,
        });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'academic_year.created',
          { type: 'academic_year', id: year.id },
          { name: year.name, startDate: dto.startDate, endDate: dto.endDate },
        );
        return toYearView(year);
      });
    } catch (error) {
      rethrowConflict(error, { duplicate: 'An academic year with this name already exists.' });
    }
  }

  async updateYear(
    actor: Actor,
    schoolId: string | undefined,
    yearId: string,
    dto: UpdateAcademicYearDto,
  ): Promise<AcademicYearView> {
    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const before = await this.findYear(scope, yearId);
        const range = toRange(
          dto.startDate ?? formatCalendarDate(before.startDate),
          dto.endDate ?? formatCalendarDate(before.endDate),
        );
        await this.assertYearDoesNotOverlap(scope, range, yearId);
        if (before.terms.some((term) => !rangeContains(range, term))) {
          throw conflict(
            'TERMS_OUTSIDE_YEAR',
            'These dates would leave one or more terms outside the academic year. Adjust the terms first.',
          );
        }

        const year = await scope.tx.academicYear.update({
          where: { id: yearId },
          data: { name: dto.name, ...range },
          select: YEAR_SELECT,
        });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'academic_year.updated',
          { type: 'academic_year', id: yearId },
          {
            before: { name: before.name, ...this.dates(before) },
            after: { name: year.name, ...this.dates(year) },
          },
        );
        return toYearView(year);
      });
    } catch (error) {
      rethrowConflict(error, { duplicate: 'An academic year with this name already exists.' });
    }
  }

  /** Makes a year current. Any current term from another year is cleared. */
  setCurrentYear(
    actor: Actor,
    schoolId: string | undefined,
    yearId: string,
  ): Promise<AcademicYearView> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const year = await this.findYear(scope, yearId);
      if (!year.isCurrent) {
        await this.makeYearCurrent(scope, yearId);
        await scope.tx.term.updateMany({
          where: { schoolId: scope.schoolId, isCurrent: true, academicYearId: { not: yearId } },
          data: { isCurrent: false },
        });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'academic_year.set_current',
          { type: 'academic_year', id: yearId },
          { name: year.name },
        );
      }
      return toYearView(await this.findYear(scope, yearId));
    });
  }

  async deleteYear(actor: Actor, schoolId: string | undefined, yearId: string): Promise<void> {
    try {
      await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const year = await this.findYear(scope, yearId);
        await scope.tx.academicYear.delete({ where: { id: yearId } });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'academic_year.deleted',
          { type: 'academic_year', id: yearId },
          { name: year.name },
        );
      });
    } catch (error) {
      rethrowConflict(error, {
        inUse: 'This academic year has terms or other records and cannot be deleted.',
      });
    }
  }

  async createTerm(
    actor: Actor,
    schoolId: string | undefined,
    yearId: string,
    dto: CreateTermDto,
  ): Promise<TermView> {
    const range = toRange(dto.startDate, dto.endDate);
    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const year = await this.findYear(scope, yearId);
        this.assertTermFits(year, range, null);

        const term = await scope.tx.term.create({
          data: {
            tenantId: scope.tenantId,
            schoolId: scope.schoolId,
            academicYearId: yearId,
            name: dto.name,
            sequence: dto.sequence,
            ...range,
          },
          select: TERM_SELECT,
        });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'term.created',
          { type: 'term', id: term.id },
          { year: year.name, name: term.name, startDate: dto.startDate, endDate: dto.endDate },
        );
        return toTermView(term);
      });
    } catch (error) {
      rethrowConflict(error, {
        duplicate: 'This academic year already has a term with that name or position.',
      });
    }
  }

  async updateTerm(
    actor: Actor,
    schoolId: string | undefined,
    termId: string,
    dto: UpdateTermDto,
  ): Promise<TermView> {
    try {
      return await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const before = await this.findTerm(scope, termId);
        const year = await this.findYear(scope, before.academicYearId);
        const range = toRange(
          dto.startDate ?? formatCalendarDate(before.startDate),
          dto.endDate ?? formatCalendarDate(before.endDate),
        );
        this.assertTermFits(year, range, termId);

        const term = await scope.tx.term.update({
          where: { id: termId },
          data: { name: dto.name, sequence: dto.sequence, ...range },
          select: TERM_SELECT,
        });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'term.updated',
          { type: 'term', id: termId },
          {
            before: { name: before.name, sequence: before.sequence, ...this.dates(before) },
            after: { name: term.name, sequence: term.sequence, ...this.dates(term) },
          },
        );
        return toTermView(term);
      });
    } catch (error) {
      rethrowConflict(error, {
        duplicate: 'This academic year already has a term with that name or position.',
      });
    }
  }

  /** Makes a term current, along with the academic year it belongs to. */
  setCurrentTerm(actor: Actor, schoolId: string | undefined, termId: string): Promise<TermView> {
    return this.scopes.run(actor.principal, schoolId, async (scope) => {
      const term = await this.findTerm(scope, termId);
      if (!term.isCurrent) {
        await scope.tx.term.updateMany({
          where: { schoolId: scope.schoolId, isCurrent: true },
          data: { isCurrent: false },
        });
        await scope.tx.term.update({ where: { id: termId }, data: { isCurrent: true } });
        await this.makeYearCurrent(scope, term.academicYearId);
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'term.set_current',
          { type: 'term', id: termId },
          { name: term.name },
        );
      }
      return toTermView(await this.findTerm(scope, termId));
    });
  }

  async deleteTerm(actor: Actor, schoolId: string | undefined, termId: string): Promise<void> {
    try {
      await this.scopes.run(actor.principal, schoolId, async (scope) => {
        const term = await this.findTerm(scope, termId);
        await scope.tx.term.delete({ where: { id: termId } });
        await auditConfigChange(
          this.audit,
          scope,
          actor,
          'term.deleted',
          { type: 'term', id: termId },
          { name: term.name },
        );
      });
    } catch (error) {
      rethrowConflict(error, {
        inUse: 'This term has records attached to it and cannot be deleted.',
      });
    }
  }

  private dates(range: DateRange): { startDate: string; endDate: string } {
    return {
      startDate: formatCalendarDate(range.startDate),
      endDate: formatCalendarDate(range.endDate),
    };
  }

  private async findYear(scope: SchoolScope, yearId: string): Promise<YearRow> {
    const year = await scope.tx.academicYear.findFirst({
      where: { id: yearId, schoolId: scope.schoolId },
      select: YEAR_SELECT,
    });
    if (!year) {
      throw new NotFoundException({
        code: 'ACADEMIC_YEAR_NOT_FOUND',
        message: 'Academic year not found.',
      });
    }
    return year;
  }

  private async findTerm(scope: SchoolScope, termId: string): Promise<TermRow> {
    const term = await scope.tx.term.findFirst({
      where: { id: termId, schoolId: scope.schoolId },
      select: TERM_SELECT,
    });
    if (!term) throw new NotFoundException({ code: 'TERM_NOT_FOUND', message: 'Term not found.' });
    return term;
  }

  private async makeYearCurrent(scope: SchoolScope, yearId: string): Promise<void> {
    // Clear first: a partial unique index allows one current year per school.
    await scope.tx.academicYear.updateMany({
      where: { schoolId: scope.schoolId, isCurrent: true, id: { not: yearId } },
      data: { isCurrent: false },
    });
    await scope.tx.academicYear.update({ where: { id: yearId }, data: { isCurrent: true } });
  }

  private async assertYearDoesNotOverlap(
    scope: SchoolScope,
    range: DateRange,
    exceptYearId: string | null,
  ): Promise<void> {
    const clash = await scope.tx.academicYear.findFirst({
      where: {
        schoolId: scope.schoolId,
        ...(exceptYearId ? { id: { not: exceptYearId } } : {}),
        startDate: { lte: range.endDate },
        endDate: { gte: range.startDate },
      },
      select: { name: true },
    });
    if (clash) {
      throw conflict(
        'ACADEMIC_YEAR_OVERLAP',
        `These dates overlap with the academic year "${clash.name}".`,
      );
    }
  }

  private assertTermFits(year: YearRow, range: DateRange, exceptTermId: string | null): void {
    if (!rangeContains(year, range)) {
      throw invalid(
        'TERM_OUTSIDE_YEAR',
        `The term must fall within the academic year (${formatCalendarDate(year.startDate)} to ${formatCalendarDate(year.endDate)}).`,
      );
    }
    const clash = year.terms.find((term) => term.id !== exceptTermId && rangesOverlap(term, range));
    if (clash) {
      throw conflict('TERM_OVERLAP', `These dates overlap with "${clash.name}".`);
    }
  }
}
