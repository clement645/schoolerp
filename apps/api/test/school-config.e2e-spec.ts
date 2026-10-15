import type { AcademicYearView, TermView } from '../src/modules/academics/academics.service.js';
import type { ClassView, StreamView } from '../src/modules/classes/classes.service.js';
import type { GradingSchemeView } from '../src/modules/grading/grading.service.js';
import type { SchoolView } from '../src/modules/schools/schools.service.js';
import type { SubjectView } from '../src/modules/subjects/subjects.service.js';
import {
  createTestApp,
  dataOf,
  errorOf,
  seedTenant,
  seedUser,
  signIn,
  unique,
  type SeededTenant,
  type SignedIn,
  type TestContext,
} from './support/app.js';

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

const PERCENTAGE_SCHEME = {
  name: 'Percentage scale',
  type: 'PERCENTAGE',
  boundaries: [
    { label: 'E', descriptor: 'Poor', minScore: 0, points: 1 },
    { label: 'A', descriptor: 'Excellent', minScore: 80, points: 12 },
    { label: 'C', descriptor: 'Average', minScore: 50, points: 6 },
    { label: 'B', descriptor: 'Good', minScore: 65, points: 9 },
  ],
};

const COMPETENCY_SCHEME = {
  name: 'Competency levels',
  type: 'COMPETENCY',
  boundaries: [
    { label: 'EE', descriptor: 'Exceeding Expectation', points: 4 },
    { label: 'ME', descriptor: 'Meeting Expectation', points: 3 },
    { label: 'AE', descriptor: 'Approaching Expectation', points: 2 },
    { label: 'BE', descriptor: 'Below Expectation', points: 1 },
  ],
};

describe('School configuration (e2e)', () => {
  let ctx: TestContext;
  let alpha: SeededTenant;
  let beta: SeededTenant;
  let admin: SignedIn;
  let teacher: SignedIn;
  let accountant: SignedIn;
  let betaAdmin: SignedIn;

  /** Sends a request as `actor`, optionally for a specific school. */
  const call = (actor: SignedIn, method: Method, path: string, schoolId?: string) => {
    const request = ctx.http()[method](`/api/v1${path}`).set('Authorization', actor.bearer);
    return schoolId ? request.set('X-School-Id', schoolId) : request;
  };
  const asAdmin = (method: Method, path: string) => call(admin, method, path);

  beforeAll(async () => {
    ctx = await createTestApp();
    [alpha, beta] = await Promise.all([seedTenant(ctx), seedTenant(ctx)]);
    const [teacherUser, accountantUser] = await Promise.all([
      seedUser(ctx, { tenantId: alpha.id, roles: ['TEACHER'] }),
      seedUser(ctx, { tenantId: alpha.id, roles: ['ACCOUNTANT'] }),
    ]);
    [admin, teacher, accountant, betaAdmin] = await Promise.all([
      signIn(ctx, alpha.admin),
      signIn(ctx, teacherUser),
      signIn(ctx, accountantUser),
      signIn(ctx, beta.admin),
    ]);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('school profile', () => {
    it('updates the profile, clears optional fields and audits the change', async () => {
      const updated = dataOf<SchoolView>(
        await asAdmin('patch', '/school')
          .send({
            motto: '  Strive to excel ',
            city: 'Nakuru',
            country: 'Kenya',
            phone: '+254 700 000 000',
            email: 'office@school.example',
            website: 'https://school.example',
          })
          .expect(200),
      );
      expect(updated).toMatchObject({
        id: alpha.schoolId,
        motto: 'Strive to excel',
        city: 'Nakuru',
        phone: '+254 700 000 000',
      });

      const cleared = dataOf<SchoolView>(
        await asAdmin('patch', '/school').send({ motto: '', website: null }).expect(200),
      );
      expect(cleared).toMatchObject({ motto: null, website: null, city: 'Nakuru' });

      const read = dataOf<SchoolView>(await call(teacher, 'get', '/school').expect(200));
      expect(read.email).toBe('office@school.example');

      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'school.updated', resourceId: alpha.schoolId },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit).toMatchObject({ schoolId: alpha.schoolId, actorId: alpha.admin.id });
      expect(audit.metadata).toMatchObject({ before: { city: null }, after: { city: 'Nakuru' } });
    });

    it('rejects invalid contact details and unauthorised edits', async () => {
      await asAdmin('patch', '/school').send({ email: 'not-an-email' }).expect(400);
      await asAdmin('patch', '/school').send({ website: 'javascript:alert(1)' }).expect(400);
      await asAdmin('patch', '/school').send({ phone: 'call me' }).expect(400);
      await asAdmin('patch', '/school').send({ tenantId: beta.id }).expect(400);
      await call(teacher, 'patch', '/school').send({ city: 'Elsewhere' }).expect(403);
    });
  });

  describe('academic years and terms', () => {
    let year2026: AcademicYearView;
    let term1: TermView;
    let term2: TermView;

    const years = async () =>
      dataOf<AcademicYearView[]>(await asAdmin('get', '/academic-years').expect(200));

    it('makes the first academic year current automatically', async () => {
      year2026 = dataOf<AcademicYearView>(
        await asAdmin('post', '/academic-years')
          .send({ name: '2026', startDate: '2026-01-05', endDate: '2026-11-20' })
          .expect(201),
      );

      expect(year2026).toMatchObject({
        name: '2026',
        startDate: '2026-01-05',
        endDate: '2026-11-20',
        isCurrent: true,
        terms: [],
      });
    });

    it('rejects impossible, reversed, duplicate and overlapping years', async () => {
      const post = (body: Record<string, unknown>) => asAdmin('post', '/academic-years').send(body);

      await post({ name: 'Bad', startDate: '2027-02-30', endDate: '2027-11-20' }).expect(400);
      await post({ name: 'Bad', startDate: '05/01/2027', endDate: '2027-11-20' }).expect(400);
      const reversed = await post({ name: 'Bad', startDate: '2027-11-20', endDate: '2027-01-05' });
      const duplicate = await post({
        name: '2026',
        startDate: '2028-01-05',
        endDate: '2028-11-20',
      });
      const overlapping = await post({
        name: '2026/27',
        startDate: '2026-11-20',
        endDate: '2027-08-01',
      });

      expect(errorOf(reversed).code).toBe('INVALID_DATE_RANGE');
      expect(duplicate.status).toBe(409);
      expect(errorOf(duplicate).code).toBe('DUPLICATE');
      expect(overlapping.status).toBe(409);
      expect(errorOf(overlapping)).toMatchObject({
        code: 'ACADEMIC_YEAR_OVERLAP',
        message: 'These dates overlap with the academic year "2026".',
      });
    });

    it('adds terms inside the year and keeps them in sequence', async () => {
      const addTerm = (body: Record<string, unknown>) =>
        asAdmin('post', `/academic-years/${year2026.id}/terms`).send(body);

      term2 = dataOf<TermView>(
        await addTerm({
          name: 'Term 2',
          sequence: 2,
          startDate: '2026-05-04',
          endDate: '2026-08-07',
        }).expect(201),
      );
      term1 = dataOf<TermView>(
        await addTerm({
          name: 'Term 1',
          sequence: 1,
          startDate: '2026-01-05',
          endDate: '2026-04-03',
        }).expect(201),
      );

      const [year] = await years();
      expect(year?.terms.map((term) => term.name)).toEqual(['Term 1', 'Term 2']);
      expect(term1).toMatchObject({ academicYearId: year2026.id, isCurrent: false });
    });

    it('rejects terms outside the year, overlapping terms and duplicates', async () => {
      const addTerm = (body: Record<string, unknown>) =>
        asAdmin('post', `/academic-years/${year2026.id}/terms`).send(body);
      const term3 = { name: 'Term 3', sequence: 3, startDate: '2026-08-31', endDate: '2026-11-20' };

      const outside = await addTerm({ ...term3, endDate: '2026-11-21' });
      const overlapping = await addTerm({ ...term3, startDate: '2026-08-07' });
      const sameSequence = await addTerm({ ...term3, sequence: 2 });
      const sameName = await addTerm({ ...term3, name: 'Term 1' });

      expect(outside.status).toBe(400);
      expect(errorOf(outside).code).toBe('TERM_OUTSIDE_YEAR');
      expect(overlapping.status).toBe(409);
      expect(errorOf(overlapping)).toMatchObject({
        code: 'TERM_OVERLAP',
        message: 'These dates overlap with "Term 2".',
      });
      expect(sameSequence.status).toBe(409);
      expect(sameName.status).toBe(409);
    });

    it('lets a term be moved, but not onto another term', async () => {
      const moved = await asAdmin('patch', `/terms/${term1.id}`).send({ endDate: '2026-04-10' });
      const collided = await asAdmin('patch', `/terms/${term1.id}`).send({ endDate: '2026-05-04' });

      expect(dataOf<TermView>(moved).endDate).toBe('2026-04-10');
      expect(collided.status).toBe(409);
    });

    it('refuses to shrink a year so that a term falls outside it', async () => {
      const response = await asAdmin('patch', `/academic-years/${year2026.id}`).send({
        endDate: '2026-06-30',
      });

      expect(response.status).toBe(409);
      expect(errorOf(response).code).toBe('TERMS_OUTSIDE_YEAR');
    });

    it('keeps exactly one current year and one current term', async () => {
      const year2027 = dataOf<AcademicYearView>(
        await asAdmin('post', '/academic-years')
          .send({ name: '2027', startDate: '2027-01-04', endDate: '2027-11-19' })
          .expect(201),
      );
      const term2027 = dataOf<TermView>(
        await asAdmin('post', `/academic-years/${year2027.id}/terms`)
          .send({ name: 'Term 1', sequence: 1, startDate: '2027-01-04', endDate: '2027-04-02' })
          .expect(201),
      );
      expect(year2027.isCurrent).toBe(false);
      const current = async () => {
        const all = await years();
        return {
          years: all.filter((year) => year.isCurrent).map((year) => year.name),
          terms: all.flatMap((year) =>
            year.terms.filter((term) => term.isCurrent).map((term) => `${year.name} ${term.name}`),
          ),
        };
      };

      await asAdmin('post', `/terms/${term2.id}/set-current`).expect(200);
      expect(await current()).toEqual({ years: ['2026'], terms: ['2026 Term 2'] });

      // Choosing a term in another year moves the current year with it.
      await asAdmin('post', `/terms/${term2027.id}/set-current`).expect(200);
      expect(await current()).toEqual({ years: ['2027'], terms: ['2027 Term 1'] });

      // Choosing a year clears a current term that belongs to a different year.
      await asAdmin('post', `/academic-years/${year2026.id}/set-current`).expect(200);
      expect(await current()).toEqual({ years: ['2026'], terms: [] });
    });

    it('only deletes years and terms that nothing depends on', async () => {
      const blocked = await asAdmin('delete', `/academic-years/${year2026.id}`);
      expect(blocked.status).toBe(409);
      expect(errorOf(blocked).code).toBe('IN_USE');

      await asAdmin('delete', `/terms/${term1.id}`).expect(204);
      await asAdmin('delete', `/terms/${term2.id}`).expect(204);
      await asAdmin('delete', `/academic-years/${year2026.id}`).expect(204);
      expect((await years()).map((year) => year.name)).toEqual(['2027']);
    });
  });

  describe('subjects', () => {
    it('creates subjects with normalised codes and rejects duplicates', async () => {
      const maths = dataOf<SubjectView>(
        await asAdmin('post', '/subjects').send({ name: ' Mathematics ', code: 'mat' }).expect(201),
      );
      const sameCode = await asAdmin('post', '/subjects').send({ name: 'Maths B', code: 'MAT' });
      const sameName = await asAdmin('post', '/subjects').send({
        name: 'Mathematics',
        code: 'MTH',
      });

      expect(maths).toMatchObject({
        name: 'Mathematics',
        code: 'MAT',
        isActive: true,
        classCount: 0,
      });
      expect(sameCode.status).toBe(409);
      expect(sameName.status).toBe(409);
      await asAdmin('post', '/subjects').send({ name: 'Bad', code: 'has space' }).expect(400);
      await asAdmin('post', '/subjects')
        .send({ name: 'Bad', code: 'WAY-TOO-LONG-CODE' })
        .expect(400);
    });

    it('updates and deletes an unused subject', async () => {
      const art = dataOf<SubjectView>(
        await asAdmin('post', '/subjects').send({ name: 'Art', code: 'ART' }).expect(201),
      );

      const renamed = await asAdmin('patch', `/subjects/${art.id}`).send({
        name: 'Art & Craft',
        isActive: false,
      });
      expect(dataOf<SubjectView>(renamed)).toMatchObject({ name: 'Art & Craft', isActive: false });

      await asAdmin('delete', `/subjects/${art.id}`).expect(204);
      await asAdmin('delete', `/subjects/${art.id}`).expect(404);
    });
  });

  describe('grading schemes', () => {
    let percentage: GradingSchemeView;
    let competency: GradingSchemeView;

    it('creates a percentage scheme, ordered best to worst with implied upper limits', async () => {
      percentage = dataOf<GradingSchemeView>(
        await asAdmin('post', '/grading-schemes').send(PERCENTAGE_SCHEME).expect(201),
      );

      expect(percentage).toMatchObject({ type: 'PERCENTAGE', isDefault: true, classCount: 0 });
      expect(
        percentage.boundaries.map(({ label, minScore, upperLimit, points }) => ({
          label,
          minScore,
          upperLimit,
          points,
        })),
      ).toEqual([
        { label: 'A', minScore: 80, upperLimit: null, points: 12 },
        { label: 'B', minScore: 65, upperLimit: 80, points: 9 },
        { label: 'C', minScore: 50, upperLimit: 65, points: 6 },
        { label: 'E', minScore: 0, upperLimit: 50, points: 1 },
      ]);
    });

    it('creates a competency scheme whose levels have no score ranges', async () => {
      competency = dataOf<GradingSchemeView>(
        await asAdmin('post', '/grading-schemes').send(COMPETENCY_SCHEME).expect(201),
      );

      expect(competency).toMatchObject({ type: 'COMPETENCY', isDefault: false });
      expect(competency.boundaries.map((b) => [b.label, b.descriptor, b.minScore])).toEqual([
        ['EE', 'Exceeding Expectation', null],
        ['ME', 'Meeting Expectation', null],
        ['AE', 'Approaching Expectation', null],
        ['BE', 'Below Expectation', null],
      ]);
    });

    it('rejects schemes that would leave scores ungraded or ambiguous', async () => {
      const post = (boundaries: unknown[], type = 'PERCENTAGE') =>
        asAdmin('post', '/grading-schemes').send({ name: unique('Scheme'), type, boundaries });

      const noZero = await post([
        { label: 'A', minScore: 80 },
        { label: 'B', minScore: 40 },
      ]);
      const sameStart = await post([
        { label: 'A', minScore: 50 },
        { label: 'B', minScore: 50 },
        { label: 'E', minScore: 0 },
      ]);
      const missingScore = await post([{ label: 'A', minScore: 50 }, { label: 'E' }]);
      const partlyScored = await post(
        [{ label: 'EE', minScore: 80 }, { label: 'ME' }],
        'COMPETENCY',
      );

      for (const response of [noZero, sameStart, missingScore, partlyScored]) {
        expect(response.status).toBe(400);
        expect(errorOf(response).code).toBe('INVALID_GRADING_SCHEME');
      }
      expect(errorOf(noZero).details).toEqual([
        'The lowest grade must start at 0 so that every score has a grade.',
      ]);
      await post([
        { label: 'A', minScore: 101 },
        { label: 'E', minScore: 0 },
      ]).expect(400);
      await post([{ label: 'Only', minScore: 0 }]).expect(400);
      await asAdmin('post', '/grading-schemes')
        .send({ ...PERCENTAGE_SCHEME, name: 'Other', type: 'LETTERS' })
        .expect(400);
    });

    it('replaces a scheme and all of its grades', async () => {
      const response = await asAdmin('put', `/grading-schemes/${percentage.id}`).send({
        name: 'Percentage scale (revised)',
        type: 'PERCENTAGE',
        boundaries: [
          { label: 'Pass', minScore: 40 },
          { label: 'Fail', minScore: 0 },
        ],
      });

      const revised = dataOf<GradingSchemeView>(response);
      expect(revised.name).toBe('Percentage scale (revised)');
      expect(revised.isDefault).toBe(true);
      expect(revised.boundaries.map((b) => b.label)).toEqual(['Pass', 'Fail']);
      expect(
        await ctx.prisma.gradeBoundary.count({ where: { gradingSchemeId: percentage.id } }),
      ).toBe(2);
    });

    it('keeps a single default and protects it from deletion', async () => {
      await asAdmin('post', `/grading-schemes/${competency.id}/set-default`).expect(200);
      const schemes = dataOf<GradingSchemeView[]>(
        await asAdmin('get', '/grading-schemes').expect(200),
      );

      expect(schemes.filter((scheme) => scheme.isDefault).map((scheme) => scheme.id)).toEqual([
        competency.id,
      ]);
      expect(schemes[0]?.id).toBe(competency.id);

      const blocked = await asAdmin('delete', `/grading-schemes/${competency.id}`);
      expect(blocked.status).toBe(400);
      expect(errorOf(blocked).code).toBe('DEFAULT_SCHEME');
    });
  });

  describe('classes, streams and class subjects', () => {
    let grade7: ClassView;
    let east: StreamView;
    let maths: SubjectView;
    let scheme: GradingSchemeView;

    beforeAll(async () => {
      const subjects = dataOf<SubjectView[]>(await asAdmin('get', '/subjects').expect(200));
      maths = subjects.find((subject) => subject.code === 'MAT') as SubjectView;
      const schemes = dataOf<GradingSchemeView[]>(
        await asAdmin('get', '/grading-schemes').expect(200),
      );
      scheme = schemes.find((entry) => entry.type === 'PERCENTAGE') as GradingSchemeView;
    });

    it('creates classes and lists them from youngest to oldest', async () => {
      await asAdmin('post', '/classes').send({ name: 'Grade 8', level: 8 }).expect(201);
      grade7 = dataOf<ClassView>(
        await asAdmin('post', '/classes')
          .send({ name: 'Grade 7', level: 7, gradingSchemeId: scheme.id })
          .expect(201),
      );
      await asAdmin('post', '/classes').send({ name: 'PP1', level: 0 }).expect(201);

      const classes = dataOf<ClassView[]>(await asAdmin('get', '/classes').expect(200));

      expect(classes.map((entry) => entry.name)).toEqual(['PP1', 'Grade 7', 'Grade 8']);
      expect(grade7).toMatchObject({
        isActive: true,
        gradingScheme: { id: scheme.id },
        streams: [],
        subjects: [],
      });
      expect(classes[2]?.gradingScheme).toBeNull();
    });

    it('rejects duplicate names and unknown grading schemes', async () => {
      const duplicate = await asAdmin('post', '/classes').send({ name: 'Grade 7', level: 7 });
      const unknownScheme = await asAdmin('post', '/classes').send({
        name: 'Grade 9',
        level: 9,
        gradingSchemeId: '00000000-0000-7000-8000-000000000000',
      });

      expect(duplicate.status).toBe(409);
      expect(errorOf(unknownScheme).code).toBe('UNKNOWN_GRADING_SCHEME');
      await asAdmin('post', '/classes').send({ name: 'Grade 9', level: -1 }).expect(400);
    });

    it('reverts a class to the school default scheme with null', async () => {
      const cleared = await asAdmin('patch', `/classes/${grade7.id}`).send({
        gradingSchemeId: null,
      });
      expect(dataOf<ClassView>(cleared).gradingScheme).toBeNull();

      const untouched = await asAdmin('patch', `/classes/${grade7.id}`).send({ name: 'Grade 7' });
      expect(dataOf<ClassView>(untouched).gradingScheme).toBeNull();

      const restored = await asAdmin('patch', `/classes/${grade7.id}`).send({
        gradingSchemeId: scheme.id,
      });
      expect(dataOf<ClassView>(restored).gradingScheme?.id).toBe(scheme.id);
    });

    it('will not delete a grading scheme that a class uses', async () => {
      const response = await asAdmin('delete', `/grading-schemes/${scheme.id}`);

      expect(response.status).toBe(409);
      expect(errorOf(response).code).toBe('IN_USE');
    });

    it('manages streams within a class', async () => {
      east = dataOf<StreamView>(
        await asAdmin('post', `/classes/${grade7.id}/streams`)
          .send({ name: 'East', capacity: 45 })
          .expect(201),
      );
      await asAdmin('post', `/classes/${grade7.id}/streams`).send({ name: 'West' }).expect(201);
      const duplicate = await asAdmin('post', `/classes/${grade7.id}/streams`).send({
        name: 'East',
      });
      const updated = await asAdmin('patch', `/streams/${east.id}`).send({
        name: 'East',
        capacity: null,
      });

      expect(east).toMatchObject({ classId: grade7.id, name: 'East', capacity: 45 });
      expect(duplicate.status).toBe(409);
      expect(dataOf<StreamView>(updated).capacity).toBeNull();
      await asAdmin('post', `/classes/${grade7.id}/streams`)
        .send({ name: 'Zero', capacity: 0 })
        .expect(400);

      const classes = dataOf<ClassView[]>(await asAdmin('get', '/classes').expect(200));
      const listed = classes.find((entry) => entry.id === grade7.id);
      expect(listed?.streams.map((stream) => stream.name)).toEqual(['East', 'West']);
    });

    it('will not delete a class that still has streams', async () => {
      const response = await asAdmin('delete', `/classes/${grade7.id}`);

      expect(response.status).toBe(409);
      expect(errorOf(response).code).toBe('IN_USE');
    });

    it('assigns, replaces and removes the subjects of a class', async () => {
      const science = dataOf<SubjectView>(
        await asAdmin('post', '/subjects').send({ name: 'Science', code: 'SCI' }).expect(201),
      );
      const french = dataOf<SubjectView>(
        await asAdmin('post', '/subjects').send({ name: 'French', code: 'FRE' }).expect(201),
      );
      const setSubjects = (subjects: unknown[]) =>
        asAdmin('put', `/classes/${grade7.id}/subjects`).send({ subjects });

      const assigned = dataOf<ClassView>(
        await setSubjects([
          { subjectId: maths.id, isCompulsory: true },
          { subjectId: french.id, isCompulsory: false },
        ]).expect(200),
      );
      expect(assigned.subjects.map((s) => [s.code, s.isCompulsory])).toEqual([
        ['FRE', false],
        ['MAT', true],
      ]);

      const replaced = dataOf<ClassView>(
        await setSubjects([
          { subjectId: maths.id, isCompulsory: true },
          { subjectId: science.id, isCompulsory: true },
        ]).expect(200),
      );
      expect(replaced.subjects.map((s) => s.code)).toEqual(['MAT', 'SCI']);

      const inUse = await asAdmin('delete', `/subjects/${maths.id}`);
      expect(inUse.status).toBe(409);
      const subjects = dataOf<SubjectView[]>(await asAdmin('get', '/subjects').expect(200));
      expect(subjects.find((s) => s.id === maths.id)?.classCount).toBe(1);

      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'class.subjects.changed', resourceId: grade7.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit.metadata).toMatchObject({ before: ['FRE', 'MAT'], after: ['MAT', 'SCI'] });
    });

    it('rejects unknown, duplicated and newly added inactive subjects', async () => {
      const retired = dataOf<SubjectView>(
        await asAdmin('post', '/subjects').send({ name: 'Latin', code: 'LAT' }).expect(201),
      );
      await asAdmin('patch', `/subjects/${retired.id}`).send({ isActive: false }).expect(200);
      const setSubjects = (subjects: unknown[]) =>
        asAdmin('put', `/classes/${grade7.id}/subjects`).send({ subjects });

      const unknown = await setSubjects([
        { subjectId: '00000000-0000-7000-8000-000000000000', isCompulsory: true },
      ]);
      const inactive = await setSubjects([{ subjectId: retired.id, isCompulsory: true }]);
      const repeated = await setSubjects([
        { subjectId: maths.id, isCompulsory: true },
        { subjectId: maths.id, isCompulsory: false },
      ]);

      expect(errorOf(unknown).code).toBe('UNKNOWN_SUBJECT');
      expect(errorOf(inactive).code).toBe('INACTIVE_SUBJECT');
      expect(repeated.status).toBe(400);
      // A rejected request must leave the existing assignment untouched.
      const classes = dataOf<ClassView[]>(await asAdmin('get', '/classes').expect(200));
      expect(classes.find((c) => c.id === grade7.id)?.subjects.map((s) => s.code)).toEqual([
        'MAT',
        'SCI',
      ]);
    });
  });

  describe('permissions', () => {
    it('lets teachers read the configuration but not change it', async () => {
      for (const path of [
        '/school',
        '/academic-years',
        '/classes',
        '/subjects',
        '/grading-schemes',
      ]) {
        expect((await call(teacher, 'get', path)).status, path).toBe(200);
      }

      const attempts = [
        call(teacher, 'post', '/academic-years').send({
          name: '2030',
          startDate: '2030-01-07',
          endDate: '2030-11-22',
        }),
        call(teacher, 'post', '/classes').send({ name: 'Grade 1', level: 1 }),
        call(teacher, 'post', '/subjects').send({ name: 'Music', code: 'MUS' }),
        call(teacher, 'post', '/grading-schemes').send({ ...PERCENTAGE_SCHEME, name: 'Mine' }),
      ];
      for (const response of await Promise.all(attempts)) {
        expect(response.status).toBe(403);
      }
    });

    it('withholds sections a role has no permission for', async () => {
      await call(accountant, 'get', '/classes').expect(200);
      await call(accountant, 'get', '/subjects').expect(403);
      await call(accountant, 'post', '/subjects').send({ name: 'Music', code: 'MUS' }).expect(403);
    });
  });

  describe('isolation between tenants and schools', () => {
    it("never shows or accepts another tenant's configuration", async () => {
      const [classes, subjects, schemes] = await Promise.all([
        asAdmin('get', '/classes'),
        asAdmin('get', '/subjects'),
        asAdmin('get', '/grading-schemes'),
      ]);
      const alphaClass = dataOf<ClassView[]>(classes)[0] as ClassView;
      const alphaSubject = dataOf<SubjectView[]>(subjects)[0] as SubjectView;
      const alphaScheme = dataOf<GradingSchemeView[]>(schemes)[0] as GradingSchemeView;

      for (const path of ['/classes', '/subjects', '/grading-schemes', '/academic-years']) {
        expect(dataOf<unknown[]>(await call(betaAdmin, 'get', path).expect(200)), path).toEqual([]);
      }

      await call(betaAdmin, 'patch', `/classes/${alphaClass.id}`)
        .send({ name: 'Taken' })
        .expect(404);
      await call(betaAdmin, 'delete', `/subjects/${alphaSubject.id}`).expect(404);
      await call(betaAdmin, 'put', `/grading-schemes/${alphaScheme.id}`)
        .send(PERCENTAGE_SCHEME)
        .expect(404);
      await call(betaAdmin, 'post', `/classes/${alphaClass.id}/streams`)
        .send({ name: 'X' })
        .expect(404);

      const betaClass = dataOf<ClassView>(
        await call(betaAdmin, 'post', '/classes').send({ name: 'Form 1', level: 9 }).expect(201),
      );
      const borrowSubject = await call(betaAdmin, 'put', `/classes/${betaClass.id}/subjects`).send({
        subjects: [{ subjectId: alphaSubject.id, isCompulsory: true }],
      });
      const borrowScheme = await call(betaAdmin, 'patch', `/classes/${betaClass.id}`).send({
        gradingSchemeId: alphaScheme.id,
      });

      expect(errorOf(borrowSubject).code).toBe('UNKNOWN_SUBJECT');
      expect(errorOf(borrowScheme).code).toBe('UNKNOWN_GRADING_SCHEME');
    });

    it("rejects another tenant's school id and malformed school headers", async () => {
      const foreign = await call(betaAdmin, 'get', '/classes', alpha.schoolId);
      const malformed = await call(betaAdmin, 'get', '/classes', 'not-a-uuid');

      expect(foreign.status).toBe(404);
      expect(errorOf(foreign).code).toBe('SCHOOL_NOT_FOUND');
      expect(malformed.status).toBe(400);
      expect(errorOf(malformed).code).toBe('INVALID_SCHOOL');
    });

    it('keeps the schools of one tenant separate', async () => {
      const second = await ctx.prisma.school.create({
        data: { tenantId: alpha.id, name: unique('Second Campus') },
        select: { id: true },
      });
      const firstCampusClass = dataOf<ClassView[]>(
        await call(admin, 'get', '/classes', alpha.schoolId).expect(200),
      ).find((entry) => entry.subjects.length > 0) as ClassView;

      // With more than one school the client has to say which it means.
      const ambiguous = await asAdmin('get', '/classes');
      expect(ambiguous.status).toBe(400);
      expect(errorOf(ambiguous).code).toBe('SCHOOL_REQUIRED');

      // The same class name is free in the other school…
      await call(admin, 'post', '/classes', second.id)
        .send({ name: firstCampusClass.name, level: firstCampusClass.level })
        .expect(201);
      const secondCampus = dataOf<ClassView[]>(
        await call(admin, 'get', '/classes', second.id).expect(200),
      );
      expect(secondCampus).toHaveLength(1);

      // …and one school's records cannot be reached through the other.
      await call(admin, 'patch', `/classes/${firstCampusClass.id}`, second.id)
        .send({ name: 'Crossed' })
        .expect(404);
      const crossSubject = await call(
        admin,
        'put',
        `/classes/${secondCampus[0]?.id}/subjects`,
        second.id,
      ).send({
        subjects: [{ subjectId: firstCampusClass.subjects[0]?.subjectId, isCompulsory: true }],
      });
      expect(errorOf(crossSubject).code).toBe('UNKNOWN_SUBJECT');
    });
  });
});
