import type { AcademicYearView, TermView } from '../src/modules/academics/academics.service.js';
import type { ClassView } from '../src/modules/classes/classes.service.js';
import type { ExaminationDetail } from '../src/modules/examinations/examinations.service.js';
import type {
  ResultsAnalytics,
  ResultsOverview,
  StudentResultView,
} from '../src/modules/examinations/results.service.js';
import type { SchoolPolicies } from '../src/common/school/school-settings.js';
import type { ReportCardData } from '../src/modules/report-cards/report-card.pdf.js';
import type { ReportCardList } from '../src/modules/report-cards/report-cards.service.js';
import type { StudentDetail } from '../src/modules/students/students.service.js';
import type { SubjectView } from '../src/modules/subjects/subjects.service.js';
import type { TeacherDetail } from '../src/modules/teachers/teachers.service.js';
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
type Name = 'amina' | 'brian' | 'chege' | 'dalia' | 'eve';

describe('Results and analytics (e2e)', () => {
  let ctx: TestContext;
  let alpha: SeededTenant;
  let beta: SeededTenant;
  let admin: SignedIn;
  let betaAdmin: SignedIn;
  let teacher: SignedIn;
  let accountant: SignedIn;
  let westTeacher: SignedIn;

  let term: TermView;
  let grade7: ClassView;
  let grade8: ClassView;
  let maths: SubjectView;
  let english: SubjectView;
  let students: Record<Name, StudentDetail>;
  let midTerm: ExaminationDetail;
  let endTerm: ExaminationDetail;

  const call = (actor: SignedIn, method: Method, path: string) =>
    ctx.http()[method](`/api/v1${path}`).set('Authorization', actor.bearer);
  const asAdmin = (method: Method, path: string) => call(admin, method, path);
  const streamId = (name: string) => grade7.streams.find((s) => s.name === name)?.id as string;
  const overview = async (actor: SignedIn, query: string) =>
    dataOf<ResultsOverview>(await call(actor, 'get', `/results?${query}`).expect(200));
  const analytics = async (actor: SignedIn, query: string) =>
    dataOf<ResultsAnalytics>(await call(actor, 'get', `/results/analytics?${query}`).expect(200));

  let admission = 0;
  async function admit(firstName: string, classId: string, stream: string | null) {
    return dataOf<StudentDetail>(
      await asAdmin('post', '/students')
        .send({
          admissionNumber: `R-${String((admission += 1)).padStart(3, '0')}`,
          firstName,
          lastName: 'Learner',
          dateOfBirth: '2013-04-17',
          gender: 'FEMALE',
          admissionDate: '2026-01-05',
          classId,
          streamId: stream,
        })
        .expect(201),
    );
  }
  async function createClass(name: string, level: number, streams: string[]) {
    const created = dataOf<ClassView>(
      await asAdmin('post', '/classes').send({ name, level }).expect(201),
    );
    for (const stream of streams) {
      await asAdmin('post', `/classes/${created.id}/streams`).send({ name: stream }).expect(201);
    }
    await asAdmin('put', `/classes/${created.id}/subjects`)
      .send({
        subjects: [maths, english].map((subject) => ({
          subjectId: subject.id,
          isCompulsory: true,
        })),
      })
      .expect(200);
    return dataOf<ClassView[]>(await asAdmin('get', '/classes').expect(200)).find(
      (c) => c.id === created.id,
    ) as ClassView;
  }
  /** Creates, opens, marks and compiles an examination. `null` marks an absence. */
  async function sit(
    name: string,
    startDate: string,
    marks: Record<Name, [number | null, number | null]>,
  ): Promise<ExaminationDetail> {
    const exam = dataOf<ExaminationDetail>(
      await asAdmin('post', '/examinations')
        .send({
          name,
          type: 'END_TERM',
          termId: term.id,
          startDate,
          endDate: startDate,
          classIds: [grade7.id, grade8.id],
        })
        .expect(201),
    );
    await asAdmin('post', `/examinations/${exam.id}/open`).expect(200);
    for (const schoolClass of [grade7, grade8]) {
      const names = (Object.keys(marks) as Name[]).filter((key) =>
        schoolClass.id === grade8.id ? key === 'eve' : key !== 'eve',
      );
      await asAdmin('put', `/examinations/${exam.id}/marks`)
        .send({
          classId: schoolClass.id,
          entries: names.flatMap((key) =>
            [maths, english].map((subject, index) => {
              const score = marks[key][index];
              return {
                studentId: students[key].id,
                subjectId: subject.id,
                version: 0,
                ...(score === null ? { isAbsent: true } : { score }),
              };
            }),
          ),
        })
        .expect(200);
    }
    return dataOf<ExaminationDetail>(
      await asAdmin('post', `/examinations/${exam.id}/compile`).expect(200),
    );
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    [alpha, beta] = await Promise.all([seedTenant(ctx), seedTenant(ctx)]);
    const [teacherUser, accountantUser, westUser] = await Promise.all([
      seedUser(ctx, { tenantId: alpha.id, roles: ['TEACHER'] }),
      seedUser(ctx, { tenantId: alpha.id, roles: ['ACCOUNTANT'] }),
      seedUser(ctx, { tenantId: alpha.id, roles: ['TEACHER'] }),
    ]);
    [admin, betaAdmin, teacher, accountant, westTeacher] = await Promise.all([
      signIn(ctx, alpha.admin),
      signIn(ctx, beta.admin),
      signIn(ctx, teacherUser),
      signIn(ctx, accountantUser),
      signIn(ctx, westUser),
    ]);

    const year = dataOf<AcademicYearView>(
      await asAdmin('post', '/academic-years')
        .send({ name: '2026', startDate: '2026-01-05', endDate: '2026-11-20' })
        .expect(201),
    );
    term = dataOf<TermView>(
      await asAdmin('post', `/academic-years/${year.id}/terms`)
        .send({ name: 'Term 2', sequence: 2, startDate: '2026-05-04', endDate: '2026-08-07' })
        .expect(201),
    );
    await asAdmin('post', '/grading-schemes')
      .send({
        name: 'Percentage',
        type: 'PERCENTAGE',
        boundaries: [
          { label: 'A', minScore: 80, points: 12 },
          { label: 'B', minScore: 65, points: 9 },
          { label: 'C', minScore: 50, points: 6 },
          { label: 'D', minScore: 30, points: 3 },
          { label: 'E', minScore: 0, points: 1 },
        ],
      })
      .expect(201);
    const make = async (name: string, code: string) =>
      dataOf<SubjectView>(await asAdmin('post', '/subjects').send({ name, code }).expect(201));
    maths = await make('Mathematics', 'MAT');
    english = await make('English', 'ENG');
    grade7 = await createClass('Grade 7', 7, ['East', 'West']);
    grade8 = await createClass('Grade 8', 8, []);

    students = {
      amina: await admit('Amina', grade7.id, streamId('East')),
      brian: await admit('Brian', grade7.id, streamId('East')),
      chege: await admit('Chege', grade7.id, streamId('West')),
      dalia: await admit('Dalia', grade7.id, streamId('West')),
      eve: await admit('Eve', grade8.id, null),
    };

    const profile = dataOf<TeacherDetail>(
      await asAdmin('post', '/teachers')
        .send({
          staffNumber: unique('T'),
          firstName: 'Tom',
          lastName: 'Mutua',
          userId: teacherUser.id,
        })
        .expect(201),
    );
    await asAdmin('post', `/teachers/${profile.id}/assignments`)
      .send({
        kind: 'SUBJECT_TEACHER',
        classId: grade7.id,
        streamId: streamId('East'),
        subjectId: maths.id,
      })
      .expect(201);

    // The same teacher is also class teacher of Grade 7 East; a colleague
    // teaches English to Grade 7 West without being its class teacher.
    await asAdmin('post', `/teachers/${profile.id}/assignments`)
      .send({ kind: 'CLASS_TEACHER', classId: grade7.id, streamId: streamId('East') })
      .expect(201);
    const west = dataOf<TeacherDetail>(
      await asAdmin('post', '/teachers')
        .send({
          staffNumber: unique('T'),
          firstName: 'Wendy',
          lastName: 'Odera',
          userId: westUser.id,
        })
        .expect(201),
    );
    await asAdmin('post', `/teachers/${west.id}/assignments`)
      .send({
        kind: 'SUBJECT_TEACHER',
        classId: grade7.id,
        streamId: streamId('West'),
        subjectId: english.id,
      })
      .expect(201);

    midTerm = await sit('Mid-term', '2026-06-01', {
      amina: [70, 70],
      brian: [60, 50],
      chege: [40, 40],
      dalia: [80, 90],
      eve: [50, 50],
    });
    endTerm = await sit('End-term', '2026-07-20', {
      amina: [90, 80],
      brian: [50, 40],
      chege: [40, 40],
      dalia: [null, null],
      eve: [60, 70],
    });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('school policies', () => {
    it('returns the defaults until a school sets its own', async () => {
      const settings = dataOf<SchoolPolicies>(await asAdmin('get', '/school/settings').expect(200));
      expect(settings).toEqual({
        passMark: 50,
        rankingPolicy: 'COMPETITION',
        showClassPosition: true,
        showStreamPosition: true,
        currency: 'KES',
      });
    });

    it('validates changes and keeps them to those who manage settings', async () => {
      const invalid = await asAdmin('put', '/school/settings')
        .send({ passMark: 120, rankingPolicy: 'RANDOM' })
        .expect(400);
      expect(errorOf(invalid).code).toBe('BAD_REQUEST');
      await call(teacher, 'put', '/school/settings').send({ passMark: 10 }).expect(403);
    });
  });

  describe('overview and merit list', () => {
    it('summarises a compiled examination from the stored results', async () => {
      const result = await overview(admin, `examinationId=${endTerm.id}`);
      expect(result.examination).toMatchObject({
        name: 'End-term',
        status: 'COMPILED',
        term: 'Term 2',
      });
      // Amina 85, Eve 65, Brian 45, Chege 40; Dalia sat nothing.
      expect(result.stats).toEqual({
        studentsExamined: 4,
        meanScore: 58.75,
        highestScore: 85,
        lowestScore: 40,
        passPercentage: 50,
      });
      expect(
        result.meritList.map((row) => [
          row.student.name,
          row.rank,
          row.average,
          row.grade,
          row.passed,
        ]),
      ).toEqual([
        ['Amina Learner', 1, 85, 'A', true],
        ['Eve Learner', 2, 65, 'B', true],
        ['Brian Learner', 3, 45, 'D', false],
        ['Chege Learner', 4, 40, 'D', false],
        ['Dalia Learner', null, 0, null, null],
      ]);
    });

    it('shows each learner’s movement since their previous examination', async () => {
      const result = await overview(admin, `examinationId=${endTerm.id}`);
      const trend = Object.fromEntries(
        result.meritList.map((row) => [row.student.name, row.trend]),
      );
      expect(trend).toEqual({
        'Amina Learner': { direction: 'up', change: 15 },
        'Eve Learner': { direction: 'up', change: 15 },
        'Brian Learner': { direction: 'down', change: -10 },
        'Chege Learner': { direction: 'same', change: 0 },
        'Dalia Learner': null,
      });
      // Nothing came before the first examination.
      const first = await overview(admin, `examinationId=${midTerm.id}`);
      expect(first.meritList.every((row) => row.trend === null)).toBe(true);
    });

    it('filters by class and stream, ranking within the filter', async () => {
      const west = await overview(
        admin,
        `examinationId=${endTerm.id}&classId=${grade7.id}&stream=West`,
      );
      expect(west.meritList.map((row) => [row.student.name, row.rank])).toEqual([
        ['Chege Learner', 1],
        ['Dalia Learner', null],
      ]);
      expect(west.stats).toMatchObject({ studentsExamined: 1, meanScore: 40, passPercentage: 0 });

      const eight = await overview(admin, `examinationId=${endTerm.id}&classId=${grade8.id}`);
      expect(eight.stats).toMatchObject({
        studentsExamined: 1,
        meanScore: 65,
        passPercentage: 100,
      });
    });
  });

  describe('analytics', () => {
    it('reports subject performance, grades and comparisons', async () => {
      const result = await analytics(admin, `examinationId=${endTerm.id}`);
      expect(result.subjectPerformance).toEqual([
        { subject: 'English', code: 'ENG', mean: 57.5, highest: 80, lowest: 40, entries: 4 },
        { subject: 'Mathematics', code: 'MAT', mean: 60, highest: 90, lowest: 40, entries: 4 },
      ]);
      expect(result.gradeDistribution).toEqual([
        { grade: 'A', count: 1 },
        { grade: 'B', count: 1 },
        { grade: 'D', count: 2 },
      ]);
      expect(result.classComparison).toEqual([
        { class: 'Grade 7', mean: 56.67, passPercentage: 33.33, students: 3 },
        { class: 'Grade 8', mean: 65, passPercentage: 100, students: 1 },
      ]);
      expect(result.streamComparison).toEqual([
        { class: 'Grade 7', stream: 'East', mean: 65, students: 2 },
        { class: 'Grade 7', stream: 'West', mean: 40, students: 1 },
      ]);
    });

    it('traces the trend across the year’s compiled examinations', async () => {
      const result = await analytics(admin, `examinationId=${endTerm.id}`);
      expect(result.trend).toEqual([
        {
          examinationId: midTerm.id,
          examination: 'Mid-term',
          date: '2026-06-01',
          mean: 60,
          passPercentage: 80,
        },
        {
          examinationId: endTerm.id,
          examination: 'End-term',
          date: '2026-07-20',
          mean: 58.75,
          passPercentage: 50,
        },
      ]);
    });
  });

  describe('one learner', () => {
    it('compares each subject with the class mean and lists their history', async () => {
      const result = dataOf<StudentResultView>(
        await asAdmin(
          'get',
          `/results/students/${students.amina.id}?examinationId=${endTerm.id}`,
        ).expect(200),
      );
      expect(result).toMatchObject({
        student: { name: 'Amina Learner' },
        class: 'Grade 7',
        stream: 'East',
        average: 85,
        grade: 'A',
        classPosition: 1,
      });
      expect(result.subjects).toEqual([
        {
          subject: 'English',
          code: 'ENG',
          score: 80,
          maxMarks: 100,
          value: 80,
          grade: 'A',
          isAbsent: false,
          classMean: 53.33,
        },
        {
          subject: 'Mathematics',
          code: 'MAT',
          score: 90,
          maxMarks: 100,
          value: 90,
          grade: 'A',
          isAbsent: false,
          classMean: 60,
        },
      ]);
      expect(result.history).toEqual([
        { examination: 'Mid-term', date: '2026-06-01', average: 70, grade: 'B' },
        { examination: 'End-term', date: '2026-07-20', average: 85, grade: 'A' },
      ]);
    });
  });

  describe('access', () => {
    it('limits a teacher to the learners they teach', async () => {
      const result = await overview(teacher, `examinationId=${endTerm.id}`);
      expect(result.meritList.map((row) => row.student.name)).toEqual([
        'Amina Learner',
        'Brian Learner',
      ]);
      expect(result.stats).toMatchObject({ studentsExamined: 2, meanScore: 65 });

      const charts = await analytics(teacher, `examinationId=${endTerm.id}`);
      expect(charts.classComparison).toEqual([
        { class: 'Grade 7', mean: 65, passPercentage: 50, students: 2 },
      ]);
      expect(charts.streamComparison.map((row) => row.stream)).toEqual(['East']);

      const other = await call(
        teacher,
        'get',
        `/results/students/${students.chege.id}?examinationId=${endTerm.id}`,
      ).expect(404);
      expect(errorOf(other).code).toBe('RESULT_NOT_FOUND');
    });

    it('requires permission, a valid query and a compiled examination', async () => {
      await call(accountant, 'get', `/results?examinationId=${endTerm.id}`).expect(403);
      await ctx.http().get(`/api/v1/results?examinationId=${endTerm.id}`).expect(401);
      await asAdmin('get', '/results').expect(400);
      await asAdmin('get', `/results?examinationId=${endTerm.id}&sort=asc`).expect(400);

      const draft = dataOf<ExaminationDetail>(
        await asAdmin('post', '/examinations')
          .send({
            name: 'Draft',
            type: 'MID_TERM',
            termId: term.id,
            startDate: '2026-08-03',
            endDate: '2026-08-03',
            classIds: [grade8.id],
          })
          .expect(201),
      );
      const early = await asAdmin('get', `/results?examinationId=${draft.id}`).expect(409);
      expect(errorOf(early).code).toBe('RESULTS_NOT_COMPILED');
    });

    it('hides another tenant’s results', async () => {
      await call(betaAdmin, 'get', `/results?examinationId=${endTerm.id}`).expect(404);
      await call(betaAdmin, 'get', `/results/analytics?examinationId=${endTerm.id}`).expect(404);
      await call(
        betaAdmin,
        'get',
        `/results/students/${students.amina.id}?examinationId=${endTerm.id}`,
      ).expect(404);
    });
  });

  describe('report cards', () => {
    const base = () => `/examinations/${endTerm.id}/report-cards`;
    const download = (actor: SignedIn, path: string) =>
      call(actor, 'get', path)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });
    const pagesOf = (pdf: Buffer) =>
      (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    const remarks = (actor: SignedIn, student: StudentDetail, body: Record<string, unknown>) =>
      call(actor, 'put', `${base()}/students/${student.id}/remarks`).send(body);

    it('lists the learners a caller may see and what they may write', async () => {
      const all = dataOf<ReportCardList>(await asAdmin('get', base()).expect(200));
      expect(all.rows).toHaveLength(5);
      expect(all.canEdit).toEqual({ classTeacherRemarks: true, principalRemarks: true });

      const mine = dataOf<ReportCardList>(await call(teacher, 'get', base()).expect(200));
      expect(mine.rows.map((row) => row.student.name)).toEqual(['Amina Learner', 'Brian Learner']);
      expect(mine.canEdit).toEqual({ classTeacherRemarks: true, principalRemarks: false });

      const west = dataOf<ReportCardList>(
        await call(westTeacher, 'get', `${base()}?classId=${grade7.id}&stream=West`).expect(200),
      );
      expect(west.rows).toHaveLength(2);
      expect(west.canEdit).toEqual({ classTeacherRemarks: false, principalRemarks: false });
    });

    it('presents a learner’s compiled result as a report card', async () => {
      const card = dataOf<ReportCardData>(
        await asAdmin('get', `${base()}/students/${students.amina.id}`).expect(200),
      );
      expect(card).toMatchObject({
        school: { name: `${alpha.name} School` },
        examination: { name: 'End-term', term: 'Term 2', academicYear: '2026' },
        student: { name: 'Amina Learner', class: 'Grade 7', stream: 'East' },
        levelBased: false,
        isPublished: false,
        summary: {
          total: 170,
          maxTotal: 200,
          average: 85,
          grade: 'A',
          classPosition: { position: 1, outOf: 3 },
          streamPosition: { position: 1, outOf: 2 },
        },
      });
      expect(card.subjects.map((s) => [s.subject, s.score, s.grade])).toEqual([
        ['English', 80, 'A'],
        ['Mathematics', 90, 'A'],
      ]);
      expect(card.gradingKey.map((entry) => [entry.label, entry.range])).toEqual([
        ['A', '80-100'],
        ['B', '65-<80'],
        ['C', '50-<65'],
        ['D', '30-<50'],
        ['E', '0-<30'],
      ]);
    });

    it('lets the class teacher and those who approve results write their own remarks', async () => {
      const byTeacher = dataOf<ReportCardData>(
        await remarks(teacher, students.amina, {
          classTeacherRemarks: '  A focused learner.  ',
        }).expect(200),
      );
      expect(byTeacher.remarks).toEqual({ classTeacher: 'A focused learner.', principal: null });

      const byAdmin = dataOf<ReportCardData>(
        await remarks(admin, students.amina, { principalRemarks: 'Keep it up.' }).expect(200),
      );
      expect(byAdmin.remarks).toEqual({
        classTeacher: 'A focused learner.',
        principal: 'Keep it up.',
      });

      const logged = await ctx.prisma.auditLog.count({
        where: { tenantId: alpha.id, action: 'results.remarks.updated' },
      });
      expect(logged).toBe(2);
    });

    it('refuses remarks from anyone else', async () => {
      // A class teacher cannot write the principal's remarks.
      await remarks(teacher, students.amina, { principalRemarks: 'Promoted.' }).expect(403);
      // A subject teacher is not the class teacher.
      await remarks(westTeacher, students.chege, { classTeacherRemarks: 'Good.' }).expect(403);
      // A learner outside the teacher's classes does not exist for them.
      await remarks(teacher, students.chege, { classTeacherRemarks: 'Good.' }).expect(404);
      await remarks(admin, students.amina, { classTeacherRemarks: 'x'.repeat(501) }).expect(400);
      await remarks(admin, students.amina, { grade: 'A' }).expect(400);

      const card = dataOf<ReportCardData>(
        await asAdmin('get', `${base()}/students/${students.chege.id}`).expect(200),
      );
      expect(card.remarks).toEqual({ classTeacher: null, principal: null });
    });

    it('produces a private PDF for one learner', async () => {
      const response = await download(admin, `${base()}/students/${students.amina.id}/pdf`).expect(
        200,
      );
      const pdf = response.body as Buffer;
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['content-disposition']).toMatch(
        /^inline; filename=".*End-term\.pdf"/,
      );
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pagesOf(pdf)).toBe(1);
    });

    it('produces a class’s report cards as one document and records the download', async () => {
      const response = await download(admin, `${base()}/pdf?classId=${grade7.id}`).expect(200);
      expect(response.headers['content-disposition']).toMatch(
        /^attachment; filename="report-cards-End-term-Grade-7\.pdf"/,
      );
      expect(pagesOf(response.body as Buffer)).toBe(4);

      // A teacher's bulk download holds only their own learners.
      const own = await download(teacher, `${base()}/pdf`).expect(200);
      expect(pagesOf(own.body as Buffer)).toBe(2);

      const logged = await ctx.prisma.auditLog.findMany({
        where: { tenantId: alpha.id, action: 'report_cards.generated' },
        orderBy: { createdAt: 'asc' },
      });
      expect(logged.map((entry) => (entry.metadata as { count: number }).count)).toEqual([1, 4, 2]);
    });

    it('shows positions only where the school’s policy allows', async () => {
      await asAdmin('put', '/school/settings').send({ showStreamPosition: false }).expect(200);
      const card = dataOf<ReportCardData>(
        await asAdmin('get', `${base()}/students/${students.amina.id}`).expect(200),
      );
      expect(card.summary.classPosition).toEqual({ position: 1, outOf: 3 });
      expect(card.summary.streamPosition).toBeNull();
      await asAdmin('put', '/school/settings').send({ showStreamPosition: true }).expect(200);
    });

    it('is closed to the unauthorised, to other tenants and before compilation', async () => {
      await call(accountant, 'get', base()).expect(403);
      await call(accountant, 'get', `${base()}/students/${students.amina.id}/pdf`).expect(403);
      await ctx.http().get(`/api/v1${base()}/pdf`).expect(401);
      await call(betaAdmin, 'get', base()).expect(404);
      await call(betaAdmin, 'get', `${base()}/students/${students.amina.id}/pdf`).expect(404);
      await call(teacher, 'get', `${base()}/students/${students.chege.id}/pdf`).expect(404);
      await call(teacher, 'get', `${base()}/pdf?classId=${grade8.id}`).expect(404);
    });

    it('locks remarks once results are published', async () => {
      await asAdmin('post', `/examinations/${midTerm.id}/approve`).expect(200);
      await asAdmin('post', `/examinations/${midTerm.id}/publish`).expect(200);
      const path = `/examinations/${midTerm.id}/report-cards`;

      const locked = await call(admin, 'put', `${path}/students/${students.amina.id}/remarks`)
        .send({ principalRemarks: 'Too late.' })
        .expect(409);
      expect(errorOf(locked).code).toBe('RESULTS_LOCKED');

      const list = dataOf<ReportCardList>(await asAdmin('get', path).expect(200));
      expect(list.canEdit).toEqual({ classTeacherRemarks: false, principalRemarks: false });
      const card = dataOf<ReportCardData>(
        await asAdmin('get', `${path}/students/${students.amina.id}`).expect(200),
      );
      expect(card.isPublished).toBe(true);
    });
  });

  // Last: recompiling changes the figures the earlier tests rely on.
  describe('policies applied at compilation', () => {
    it('uses the school’s pass mark the next time results are compiled', async () => {
      const updated = dataOf<SchoolPolicies>(
        await asAdmin('put', '/school/settings')
          .send({ passMark: 45, rankingPolicy: 'DENSE' })
          .expect(200),
      );
      expect(updated).toMatchObject({ passMark: 45, rankingPolicy: 'DENSE' });

      // Already compiled results keep the policy they were compiled under.
      expect((await overview(admin, `examinationId=${endTerm.id}`)).stats.passPercentage).toBe(50);

      await asAdmin('post', `/examinations/${endTerm.id}/reopen`).expect(200);
      // A reopened examination has no current results to show.
      await asAdmin('get', `/results?examinationId=${endTerm.id}`).expect(409);
      await asAdmin('post', `/examinations/${endTerm.id}/compile`).expect(200);
      expect((await overview(admin, `examinationId=${endTerm.id}`)).stats.passPercentage).toBe(75);

      // Remarks written before the recompilation are carried over.
      const card = dataOf<ReportCardData>(
        await asAdmin(
          'get',
          `/examinations/${endTerm.id}/report-cards/students/${students.amina.id}`,
        ).expect(200),
      );
      expect(card.remarks.classTeacher).toBe('A focused learner.');

      const logged = await ctx.prisma.auditLog.findFirst({
        where: { tenantId: alpha.id, action: 'school.settings.updated' },
      });
      expect(logged).not.toBeNull();
    });
  });
});
