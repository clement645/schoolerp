import ExcelJS from 'exceljs';
import type { AcademicYearView, TermView } from '../src/modules/academics/academics.service.js';
import type { ClassView } from '../src/modules/classes/classes.service.js';
import type {
  ExaminationDetail,
  ExaminationSummary,
} from '../src/modules/examinations/examinations.service.js';
import type {
  MarksConflict,
  MarksImportResult,
  MarksSheet,
} from '../src/modules/examinations/marks.service.js';
import type { GradingSchemeView } from '../src/modules/grading/grading.service.js';
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

const PERCENTAGE = {
  name: 'Percentage',
  type: 'PERCENTAGE',
  boundaries: [
    { label: 'A', minScore: 80, points: 12 },
    { label: 'B', minScore: 65, points: 9 },
    { label: 'C', minScore: 50, points: 6 },
    { label: 'D', minScore: 30, points: 3 },
    { label: 'E', minScore: 0, points: 1 },
  ],
};
const LEVELS = {
  name: 'Competency',
  type: 'COMPETENCY',
  boundaries: [
    { label: 'EE', descriptor: 'Exceeding Expectation', points: 4 },
    { label: 'ME', descriptor: 'Meeting Expectation', points: 3 },
    { label: 'AE', descriptor: 'Approaching Expectation', points: 2 },
    { label: 'BE', descriptor: 'Below Expectation', points: 1 },
  ],
};

describe('Examinations and marks (e2e)', () => {
  let ctx: TestContext;
  let alpha: SeededTenant;
  let beta: SeededTenant;
  let admin: SignedIn;
  let betaAdmin: SignedIn;
  let mathsTeacher: SignedIn;
  let principal: SignedIn;

  let term: TermView;
  let grade7: ClassView;
  let grade4: ClassView;
  let subjects: Record<'MAT' | 'ENG' | 'FRE', SubjectView>;
  let students: Record<'amina' | 'brian' | 'chege', StudentDetail>;
  let exam: ExaminationDetail;

  const call = (actor: SignedIn, method: Method, path: string) =>
    ctx.http()[method](`/api/v1${path}`).set('Authorization', actor.bearer);
  const asAdmin = (method: Method, path: string) => call(admin, method, path);
  const stream = (schoolClass: ClassView, name: string) =>
    schoolClass.streams.find((entry) => entry.name === name)?.id as string;

  const sheetOf = async (actor: SignedIn, examId: string, classId: string, query = '') =>
    dataOf<MarksSheet>(
      await call(actor, 'get', `/examinations/${examId}/marks?classId=${classId}${query}`).expect(
        200,
      ),
    );
  const save = (
    actor: SignedIn,
    examId: string,
    classId: string,
    entries: Record<string, unknown>[],
  ) => call(actor, 'put', `/examinations/${examId}/marks`).send({ classId, entries });
  const entry = (
    student: StudentDetail,
    subject: SubjectView,
    value: Record<string, unknown>,
    version = 0,
  ) => ({
    studentId: student.id,
    subjectId: subject.id,
    version,
    ...value,
  });
  const newExam = (overrides: Record<string, unknown> = {}) => ({
    name: unique('Exam'),
    type: 'END_TERM',
    termId: term.id,
    startDate: '2026-07-20',
    endDate: '2026-07-31',
    classIds: [grade7.id],
    ...overrides,
  });
  const step = (examId: string, action: string, actor = admin) =>
    call(actor, 'post', `/examinations/${examId}/${action}`);

  let admission = 0;
  async function admit(
    firstName: string,
    classId: string,
    streamId: string | null,
  ): Promise<StudentDetail> {
    return dataOf<StudentDetail>(
      await asAdmin('post', '/students')
        .send({
          admissionNumber: `E-${String((admission += 1)).padStart(3, '0')}`,
          firstName,
          lastName: 'Learner',
          dateOfBirth: '2013-04-17',
          gender: 'FEMALE',
          admissionDate: '2026-01-05',
          classId,
          streamId,
        })
        .expect(201),
    );
  }
  async function createClass(
    name: string,
    level: number,
    streams: string[],
    subjectList: { subject: SubjectView; compulsory?: boolean }[],
    gradingSchemeId?: string,
  ) {
    const created = dataOf<ClassView>(
      await asAdmin('post', '/classes').send({ name, level, gradingSchemeId }).expect(201),
    );
    for (const streamName of streams) {
      await asAdmin('post', `/classes/${created.id}/streams`)
        .send({ name: streamName })
        .expect(201);
    }
    return dataOf<ClassView>(
      await asAdmin('put', `/classes/${created.id}/subjects`)
        .send({
          subjects: subjectList.map(({ subject, compulsory }) => ({
            subjectId: subject.id,
            isCompulsory: compulsory ?? true,
          })),
        })
        .expect(200),
    );
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    [alpha, beta] = await Promise.all([seedTenant(ctx), seedTenant(ctx)]);
    const [teacherUser, principalUser] = await Promise.all([
      seedUser(ctx, { tenantId: alpha.id, roles: ['TEACHER'] }),
      seedUser(ctx, { tenantId: alpha.id, roles: ['PRINCIPAL'] }),
    ]);
    [admin, betaAdmin, mathsTeacher, principal] = await Promise.all([
      signIn(ctx, alpha.admin),
      signIn(ctx, beta.admin),
      signIn(ctx, teacherUser),
      signIn(ctx, principalUser),
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
    await asAdmin('post', '/grading-schemes').send(PERCENTAGE).expect(201);
    const levels = dataOf<GradingSchemeView>(
      await asAdmin('post', '/grading-schemes').send(LEVELS).expect(201),
    );

    const make = async (name: string, code: string) =>
      dataOf<SubjectView>(await asAdmin('post', '/subjects').send({ name, code }).expect(201));
    subjects = {
      MAT: await make('Mathematics', 'MAT'),
      ENG: await make('English', 'ENG'),
      FRE: await make('French', 'FRE'),
    };

    grade7 = await createClass(
      'Grade 7',
      7,
      ['East', 'West'],
      [
        { subject: subjects.MAT },
        { subject: subjects.ENG },
        { subject: subjects.FRE, compulsory: false },
      ],
    );
    grade4 = await createClass(
      'Grade 4',
      4,
      [],
      [{ subject: subjects.MAT }, { subject: subjects.ENG }],
      levels.id,
    );
    // Re-read so streams are included.
    grade7 = dataOf<ClassView[]>(await asAdmin('get', '/classes').expect(200)).find(
      (c) => c.id === grade7.id,
    ) as ClassView;

    students = {
      amina: await admit('Amina', grade7.id, stream(grade7, 'East')),
      brian: await admit('Brian', grade7.id, stream(grade7, 'East')),
      chege: await admit('Chege', grade7.id, stream(grade7, 'West')),
    };

    // The teacher teaches Mathematics to Grade 7 East only.
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
        streamId: stream(grade7, 'East'),
        subjectId: subjects.MAT.id,
      })
      .expect(201);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('creating an examination', () => {
    it('creates a draft with the subjects each class takes', async () => {
      exam = dataOf<ExaminationDetail>(
        await asAdmin('post', '/examinations')
          .send(newExam({ name: 'End Term Exam', maxMarks: 100 }))
          .expect(201),
      );

      expect(exam).toMatchObject({
        name: 'End Term Exam',
        type: 'END_TERM',
        status: 'DRAFT',
        term: { name: 'Term 2' },
        academicYear: { name: '2026' },
        classes: [{ id: grade7.id, name: 'Grade 7' }],
        // Two compulsory subjects for three learners.
        progress: { entered: 0, expected: 6 },
      });
      expect(
        exam.subjectsByClass[0]?.subjects.map((s) => [s.code, s.maxMarks, s.isCompulsory]),
      ).toEqual([
        ['ENG', 100, true],
        ['FRE', 100, false],
        ['MAT', 100, true],
      ]);
    });

    it('rejects duplicates, bad dates and classes that are not ready', async () => {
      const post = (overrides: Record<string, unknown>) =>
        asAdmin('post', '/examinations').send(newExam(overrides));
      const bare = dataOf<ClassView>(
        await asAdmin('post', '/classes').send({ name: 'Empty Class', level: 1 }).expect(201),
      );

      const duplicate = await post({ name: 'End Term Exam' });
      const outsideTerm = await post({ startDate: '2026-08-01', endDate: '2026-08-20' });
      const reversed = await post({ startDate: '2026-07-31', endDate: '2026-07-20' });
      const noSubjects = await post({ classIds: [bare.id] });
      const unknownTerm = await post({ termId: '00000000-0000-7000-8000-000000000000' });

      expect(duplicate.status).toBe(409);
      expect(errorOf(outsideTerm).code).toBe('OUTSIDE_TERM');
      expect(errorOf(reversed).code).toBe('INVALID_DATE_RANGE');
      expect(errorOf(noSubjects)).toMatchObject({
        code: 'CLASS_WITHOUT_SUBJECTS',
        message: expect.stringContaining('Empty Class') as string,
      });
      expect(errorOf(unknownTerm).code).toBe('UNKNOWN_TERM');
      await post({ type: 'POP_QUIZ' }).expect(400);
      await post({ classIds: [] }).expect(400);
    });

    it('changes a maximum mark and lists examinations', async () => {
      const french = exam.subjectsByClass[0]?.subjects.find((s) => s.code === 'FRE');

      const updated = dataOf<ExaminationDetail>(
        await asAdmin('put', `/examinations/${exam.id}/subjects/${french?.examSubjectId}`)
          .send({ maxMarks: 50 })
          .expect(200),
      );
      const listed = dataOf<ExaminationSummary[]>(
        await asAdmin('get', `/examinations?termId=${term.id}`).expect(200),
      );

      expect(updated.subjectsByClass[0]?.subjects.find((s) => s.code === 'FRE')?.maxMarks).toBe(50);
      expect(listed.map((e) => e.id)).toContain(exam.id);
      expect(
        dataOf<ExaminationSummary[]>(
          await asAdmin('get', '/examinations?status=PUBLISHED').expect(200),
        ),
      ).toEqual([]);
    });
  });

  describe('entering marks', () => {
    it('refuses marks until the examination is opened', async () => {
      const response = await save(admin, exam.id, grade7.id, [
        entry(students.amina, subjects.MAT, { score: 80 }),
      ]);

      expect(response.status).toBe(409);
      expect(errorOf(response)).toMatchObject({
        code: 'INVALID_EXAM_STATE',
        message: 'This examination is not open for marks entry yet.',
      });

      await step(exam.id, 'open').expect(200);
      await step(exam.id, 'open').expect(409);
    });

    it('saves marks and returns totals, averages and grades computed by the server', async () => {
      const response = await save(admin, exam.id, grade7.id, [
        entry(students.amina, subjects.MAT, { score: 92 }),
        entry(students.amina, subjects.ENG, { score: 78 }),
        entry(students.brian, subjects.MAT, { score: 55.5 }),
      ]).expect(200);
      const sheet = dataOf<MarksSheet>(response);
      const row = (student: StudentDetail) =>
        sheet.students.find((s) => s.studentId === student.id);

      expect(sheet.subjects.map((s) => s.code)).toEqual(['ENG', 'FRE', 'MAT']);
      expect(sheet.grading).toMatchObject({ name: 'Percentage', levelBased: false });
      expect(row(students.amina)).toMatchObject({
        total: 170,
        maxTotal: 200,
        average: 85,
        grade: 'A',
        isComplete: true,
      });
      expect(row(students.amina)?.marks[subjects.MAT.id]).toEqual({
        score: 92,
        level: null,
        isAbsent: false,
        version: 1,
      });
      // One of two compulsory subjects entered.
      expect(row(students.brian)).toMatchObject({
        total: 55.5,
        maxTotal: 100,
        average: 55.5,
        grade: 'C',
        isComplete: false,
      });
      expect(row(students.chege)).toMatchObject({ total: 0, average: 0, grade: null, marks: {} });
      expect(sheet.stats).toEqual({
        totalStudents: 3,
        marksEntered: 3,
        marksExpected: 6,
        completion: 50,
        pendingEntry: 3,
        awaitingApproval: 0,
      });
    });

    it('ignores totals a client sends and never trusts them', async () => {
      const response = await call(admin, 'put', `/examinations/${exam.id}/marks`).send({
        classId: grade7.id,
        entries: [
          { ...entry(students.chege, subjects.MAT, { score: 10 }), total: 999, grade: 'A' },
        ],
      });

      // Unknown properties are rejected outright.
      expect(response.status).toBe(400);
    });

    it('validates each mark against the subject maximum and the grading scheme', async () => {
      const attempt = (value: Record<string, unknown>, subject = subjects.MAT) =>
        save(admin, exam.id, grade7.id, [entry(students.chege, subject, value)]);

      const tooHigh = await attempt({ score: 101 });
      const overFrench = await attempt({ score: 51 }, subjects.FRE);
      const level = await attempt({ level: 'ME' });
      const both = await attempt({ score: 40, isAbsent: true });

      expect(errorOf(tooHigh)).toMatchObject({
        code: 'INVALID_MARK',
        message: 'Chege Learner, Mathematics: 101 is more than the maximum of 100.',
        details: { studentId: students.chege.id, subjectId: subjects.MAT.id },
      });
      expect(errorOf(overFrench).message).toContain('more than the maximum of 50');
      expect(errorOf(level).message).toContain('graded by score');
      expect(errorOf(both).message).toContain('only one');
      await attempt({ score: -1 }).expect(400);
      await attempt({ score: 55.555 }).expect(400);
      // Nothing was written by any of the rejected requests.
      expect(
        (await sheetOf(admin, exam.id, grade7.id)).students.find(
          (s) => s.studentId === students.chege.id,
        )?.marks,
      ).toEqual({});
    });

    it('saves a batch atomically: one invalid mark rejects all of them', async () => {
      const response = await save(admin, exam.id, grade7.id, [
        entry(students.chege, subjects.ENG, { score: 60 }),
        entry(students.chege, subjects.MAT, { score: 500 }),
      ]);

      expect(response.status).toBe(400);
      expect((await sheetOf(admin, exam.id, grade7.id)).stats.marksEntered).toBe(3);
    });

    it('records absences and clears marks', async () => {
      const absent = dataOf<MarksSheet>(
        await save(admin, exam.id, grade7.id, [
          entry(students.brian, subjects.ENG, { isAbsent: true }),
        ]).expect(200),
      );
      const brian = absent.students.find((s) => s.studentId === students.brian.id);
      expect(brian?.marks[subjects.ENG.id]).toEqual({
        score: null,
        level: null,
        isAbsent: true,
        version: 1,
      });
      expect(brian).toMatchObject({ isComplete: false, average: 55.5 });

      const cleared = dataOf<MarksSheet>(
        await save(admin, exam.id, grade7.id, [
          entry(students.brian, subjects.ENG, { score: null }, 1),
        ]).expect(200),
      );
      expect(
        cleared.students.find((s) => s.studentId === students.brian.id)?.marks[subjects.ENG.id],
      ).toEqual({
        score: null,
        level: null,
        isAbsent: false,
        version: 2,
      });
      expect(cleared.stats.marksEntered).toBe(3);
    });

    it('audits each save with the before and after of every mark', async () => {
      await save(admin, exam.id, grade7.id, [
        entry(students.amina, subjects.ENG, { score: 79 }, 1),
      ]).expect(200);

      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'marks.saved', resourceId: exam.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).toMatchObject({ actorId: alpha.admin.id, schoolId: alpha.schoolId });
      expect(audit.metadata).toMatchObject({
        examination: 'End Term Exam',
        class: 'Grade 7',
        count: 1,
        changes: [
          { student: students.amina.admissionNumber, subject: 'ENG', before: 78, after: 79 },
        ],
      });
    });
  });

  describe('two people editing the same marks', () => {
    it('refuses a save based on a stale version and reports the current value', async () => {
      // Both read Amina's English mark at version 2.
      const first = await save(admin, exam.id, grade7.id, [
        entry(students.amina, subjects.ENG, { score: 81 }, 2),
      ]);
      const second = await save(admin, exam.id, grade7.id, [
        entry(students.amina, subjects.ENG, { score: 60 }, 2),
      ]);

      expect(first.status).toBe(200);
      expect(second.status).toBe(409);
      const error = errorOf(second);
      expect(error.code).toBe('MARKS_CONFLICT');
      expect((error.details as { conflicts: MarksConflict[] }).conflicts).toEqual([
        {
          studentId: students.amina.id,
          subjectId: subjects.ENG.id,
          current: { score: 81, level: null, isAbsent: false, version: 3 },
          updatedBy: 'Test SCHOOL_ADMIN',
        },
      ]);
    });

    it('rejects the whole batch when any one mark conflicts', async () => {
      const response = await save(admin, exam.id, grade7.id, [
        entry(students.chege, subjects.ENG, { score: 44 }),
        entry(students.amina, subjects.ENG, { score: 10 }, 1),
      ]);

      expect(response.status).toBe(409);
      const chege = (await sheetOf(admin, exam.id, grade7.id)).students.find(
        (s) => s.studentId === students.chege.id,
      );
      expect(chege?.marks[subjects.ENG.id]).toBeUndefined();
    });

    it('lets only one of two simultaneous saves of the same cell win', async () => {
      const attempts = await Promise.all(
        [41, 42, 43].map((score) =>
          save(admin, exam.id, grade7.id, [entry(students.chege, subjects.MAT, { score })]),
        ),
      );
      const stored = (await sheetOf(admin, exam.id, grade7.id)).students.find(
        (s) => s.studentId === students.chege.id,
      )?.marks[subjects.MAT.id];

      expect(attempts.filter((r) => r.status === 200)).toHaveLength(1);
      expect(attempts.filter((r) => r.status === 409)).toHaveLength(2);
      expect(stored?.version).toBe(1);
      expect([41, 42, 43]).toContain(stored?.score);
    });

    it('does not bump the version when nothing actually changed', async () => {
      const before = (await sheetOf(admin, exam.id, grade7.id)).students.find(
        (s) => s.studentId === students.amina.id,
      )?.marks[subjects.MAT.id];

      await save(admin, exam.id, grade7.id, [
        entry(students.amina, subjects.MAT, { score: 92 }, before?.version),
      ]).expect(200);

      const after = (await sheetOf(admin, exam.id, grade7.id)).students.find(
        (s) => s.studentId === students.amina.id,
      )?.marks[subjects.MAT.id];
      expect(after?.version).toBe(before?.version);
    });
  });

  describe('who may enter which marks', () => {
    it('shows a teacher only their own learners and marks only their subject editable', async () => {
      const sheet = await sheetOf(mathsTeacher, exam.id, grade7.id);

      expect(sheet.students.map((s) => s.name)).toEqual(['Amina Learner', 'Brian Learner']);
      expect(sheet.editable).toBe(true);
      expect(sheet.subjects.map((s) => [s.code, s.canEdit])).toEqual([
        ['ENG', false],
        ['FRE', false],
        ['MAT', true],
      ]);
      expect(sheet.students.every((s) => s.editableSubjectIds?.join() === subjects.MAT.id)).toBe(
        true,
      );
    });

    it('lets the teacher change their own subject but nobody else’s', async () => {
      const current = (await sheetOf(mathsTeacher, exam.id, grade7.id)).students.find(
        (s) => s.studentId === students.brian.id,
      );

      await save(mathsTeacher, exam.id, grade7.id, [
        entry(
          students.brian,
          subjects.MAT,
          { score: 61 },
          current?.marks[subjects.MAT.id]?.version,
        ),
      ]).expect(200);
      const english = await save(mathsTeacher, exam.id, grade7.id, [
        entry(students.brian, subjects.ENG, { score: 99 }, 2),
      ]);
      const otherStream = await save(mathsTeacher, exam.id, grade7.id, [
        entry(students.chege, subjects.MAT, { score: 99 }, 1),
      ]);

      expect(errorOf(english)).toMatchObject({
        code: 'INVALID_MARK',
        message: expect.stringContaining('not assigned to teach') as string,
      });
      // A learner in a stream they do not teach is not on their sheet at all.
      expect(errorOf(otherStream).code).toBe('UNKNOWN_STUDENT');
    });

    it('lets a principal view the sheet but not enter marks', async () => {
      const sheet = await sheetOf(principal, exam.id, grade7.id);
      const attempt = await save(principal, exam.id, grade7.id, [
        entry(students.amina, subjects.MAT, { score: 1 }, 1),
      ]);

      expect(sheet.students).toHaveLength(3);
      expect(sheet.editable).toBe(false);
      expect(attempt.status).toBe(403);
    });

    it('keeps the workflow to those with the right permission', async () => {
      await asAdmin('post', '/examinations').send(newExam()).expect(201);
      await call(mathsTeacher, 'post', '/examinations').send(newExam()).expect(403);
      await step(exam.id, 'compile', mathsTeacher).expect(403);
      await step(exam.id, 'approve', mathsTeacher).expect(403);
      await step(exam.id, 'publish', mathsTeacher).expect(403);
    });
  });

  describe('Excel export and import', () => {
    const exportSheet = async (actor: SignedIn = admin) => {
      const response = await call(
        actor,
        'get',
        `/examinations/${exam.id}/marks/export?classId=${grade7.id}`,
      )
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body as ArrayBuffer);
      return { response, workbook, worksheet: workbook.worksheets[0] as ExcelJS.Worksheet };
    };
    const upload = (workbook: ExcelJS.Workbook, dryRun: boolean, actor = admin) =>
      workbook.xlsx
        .writeBuffer()
        .then((buffer) =>
          call(
            actor,
            'post',
            `/examinations/${exam.id}/marks/import?classId=${grade7.id}${dryRun ? '&dryRun=true' : ''}`,
          ).attach('file', Buffer.from(buffer), 'marks.xlsx'),
        );
    const rowOf = (worksheet: ExcelJS.Worksheet, admissionNumber: string) => {
      let found: ExcelJS.Row | undefined;
      worksheet.eachRow((row) => {
        if (row.getCell(1).value === admissionNumber) found = row;
      });
      return found as ExcelJS.Row;
    };

    it('exports the sheet with marks, totals and grades', async () => {
      const { response, worksheet } = await exportSheet();

      expect(response.headers['content-type']).toContain('spreadsheetml');
      expect(response.headers['content-disposition']).toContain('marks-End-Term-Exam-Grade-7.xlsx');
      expect(worksheet.getRow(1).values).toEqual([
        undefined,
        'Adm No',
        'Student',
        'Stream',
        'ENG (/100)',
        'FRE (/50)',
        'MAT (/100)',
        'Total',
        'Average',
        'Grade',
      ]);
      const amina = rowOf(worksheet, students.amina.admissionNumber);
      expect([
        amina.getCell(4).value,
        amina.getCell(6).value,
        amina.getCell(7).value,
        amina.getCell(9).value,
      ]).toEqual([81, 92, 173, 'A']);
    });

    it('previews an import, then applies it, leaving blank cells alone', async () => {
      const { workbook, worksheet } = await exportSheet();
      rowOf(worksheet, students.chege.admissionNumber).getCell(4).value = 66; // ENG, was empty
      rowOf(worksheet, students.amina.admissionNumber).getCell(4).value = 85; // ENG, was 81
      rowOf(worksheet, students.brian.admissionNumber).getCell(4).value = 'ABS'; // ENG, cleared earlier

      const preview = dataOf<MarksImportResult>(await upload(workbook, true));
      expect(preview).toEqual({
        imported: false,
        changes: 3,
        overwrites: 1,
        problems: [],
        problemsTruncated: false,
      });
      expect(
        (await sheetOf(admin, exam.id, grade7.id)).students.find(
          (s) => s.studentId === students.amina.id,
        )?.marks[subjects.ENG.id]?.score,
      ).toBe(81);

      const applied = dataOf<MarksImportResult>(await upload(workbook, false));
      const sheet = await sheetOf(admin, exam.id, grade7.id);
      const cell = (student: StudentDetail, subject: SubjectView) =>
        sheet.students.find((s) => s.studentId === student.id)?.marks[subject.id];

      expect(applied).toMatchObject({ imported: true, changes: 3 });
      expect(cell(students.chege, subjects.ENG)?.score).toBe(66);
      expect(cell(students.amina, subjects.ENG)?.score).toBe(85);
      expect(cell(students.brian, subjects.ENG)?.isAbsent).toBe(true);
      // Mathematics was not touched: same value, same version.
      expect(cell(students.amina, subjects.MAT)).toMatchObject({ score: 92, version: 1 });
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'marks.imported', resourceId: exam.id },
      });
      expect(audit.metadata).toMatchObject({ count: 3 });
    });

    it('imports nothing when any cell is invalid, reporting each by row', async () => {
      const { workbook, worksheet } = await exportSheet();
      rowOf(worksheet, students.amina.admissionNumber).getCell(6).value = 250; // MAT above maximum
      rowOf(worksheet, students.brian.admissionNumber).getCell(6).value = 'ninety'; // not a score
      worksheet.addRow(['NO-SUCH', 'Ghost', '', 50]);

      const result = dataOf<MarksImportResult>(await upload(workbook, false));

      expect(result.imported).toBe(false);
      expect(result.problems.map((p) => p.message)).toEqual([
        'MAT: 250 is more than the maximum of 100.',
        'MAT: this class is graded by score; enter a number.',
        'No student with admission number "NO-SUCH" is in this class.',
      ]);
      expect(
        (await sheetOf(admin, exam.id, grade7.id)).students.find(
          (s) => s.studentId === students.amina.id,
        )?.marks[subjects.MAT.id]?.score,
      ).toBe(92);
    });

    it('rejects files that are not Excel workbooks and unauthorised imports', async () => {
      const path = `/examinations/${exam.id}/marks/import?classId=${grade7.id}`;

      const csv = await asAdmin('post', path).attach('file', Buffer.from('a,b,c'), 'marks.csv');
      const fake = await asAdmin('post', path).attach(
        'file',
        Buffer.from('not a zip archive'),
        'marks.xlsx',
      );
      const none = await asAdmin('post', path);

      expect(errorOf(csv).code).toBe('UNSUPPORTED_FILE');
      expect(errorOf(fake).code).toBe('UNSUPPORTED_FILE');
      expect(errorOf(none).code).toBe('FILE_REQUIRED');
      await call(principal, 'post', path)
        .attach('file', Buffer.from('PK'), 'marks.xlsx')
        .expect(403);
    });
  });

  describe('compiling, approving and publishing', () => {
    it('compiles results with positions, closing marks entry', async () => {
      const compiled = dataOf<ExaminationDetail>(await step(exam.id, 'compile').expect(200));
      expect(compiled.status).toBe('COMPILED');
      expect(compiled.compiledAt).not.toBeNull();

      const results = await ctx.prisma.result.findMany({
        where: { examinationId: exam.id },
        include: { subjects: true, student: { select: { firstName: true } } },
        orderBy: { classPosition: 'asc' },
      });
      const summary = results.map((r) => ({
        name: r.student.firstName,
        average: r.average.toNumber(),
        grade: r.grade,
        position: r.classPosition,
        of: r.classSize,
        stream: r.streamName,
        streamPosition: r.streamPosition,
        complete: r.isComplete,
        version: r.compileVersion,
      }));
      // Amina: MAT 92, ENG 85. Brian: MAT 61, ENG absent. Chege: MAT (41–43), ENG 66.
      expect(summary[0]).toEqual({
        name: 'Amina',
        average: 88.5,
        grade: 'A',
        position: 1,
        of: 3,
        stream: 'East',
        streamPosition: 1,
        complete: true,
        version: 1,
      });
      expect(summary[1]).toMatchObject({
        name: 'Brian',
        average: 61,
        grade: 'C',
        position: 2,
        streamPosition: 2,
        complete: false,
      });
      expect(summary[2]).toMatchObject({
        name: 'Chege',
        position: 3,
        stream: 'West',
        streamPosition: 1,
        complete: true,
      });

      // Each result carries a full copy of what it was computed from.
      const amina = results[0];
      expect(amina).toMatchObject({ className: 'Grade 7', gradingScheme: 'Percentage' });
      expect(
        amina?.subjects.map((s) => [s.subjectCode, s.score?.toNumber() ?? null, s.grade]).sort(),
      ).toEqual([
        ['ENG', 85, 'A'],
        ['FRE', null, null],
        ['MAT', 92, 'A'],
      ]);

      const closed = await save(admin, exam.id, grade7.id, [
        entry(students.amina, subjects.MAT, { score: 1 }, 1),
      ]);
      expect(errorOf(closed)).toMatchObject({
        code: 'INVALID_EXAM_STATE',
        message: 'Marks entry is closed for this examination.',
      });
      expect((await sheetOf(admin, exam.id, grade7.id)).stats.awaitingApproval).toBe(3);
    });

    it('keeps a compiled result unchanged when names or schemes change afterwards', async () => {
      await asAdmin('patch', `/classes/${grade7.id}`)
        .send({ name: 'Grade 7 (renamed)' })
        .expect(200);
      await asAdmin('patch', `/subjects/${subjects.MAT.id}`).send({ name: 'Maths' }).expect(200);

      const result = await ctx.prisma.result.findFirstOrThrow({
        where: { examinationId: exam.id, studentId: students.amina.id },
        include: { subjects: true },
      });

      expect(result.className).toBe('Grade 7');
      expect(result.subjects.map((s) => s.subjectName)).toContain('Mathematics');
      await asAdmin('patch', `/classes/${grade7.id}`).send({ name: 'Grade 7' }).expect(200);
    });

    it('reopens, recompiles under a new version, and enforces the order of steps', async () => {
      await step(exam.id, 'publish').expect(409);
      await step(exam.id, 'reopen').expect(200);
      await step(exam.id, 'approve').expect(409);
      await save(admin, exam.id, grade7.id, [
        entry(students.brian, subjects.MAT, { score: 95 }, 2),
      ]).expect(200);

      await step(exam.id, 'compile').expect(200);

      const brian = await ctx.prisma.result.findFirstOrThrow({
        where: { examinationId: exam.id, studentId: students.brian.id },
      });
      expect(brian).toMatchObject({ compileVersion: 2, classPosition: 1 });
      expect(await ctx.prisma.result.count({ where: { examinationId: exam.id } })).toBe(3);
    });

    it('approves, then publishes, after which nothing can be changed', async () => {
      const approved = dataOf<ExaminationDetail>(
        await step(exam.id, 'approve', principal).expect(200),
      );
      expect(approved).toMatchObject({ status: 'APPROVED' });
      expect(approved.approvedAt).not.toBeNull();

      const published = dataOf<ExaminationDetail>(
        await step(exam.id, 'publish', principal).expect(200),
      );
      expect(published.status).toBe('PUBLISHED');

      for (const action of ['open', 'compile', 'reopen', 'approve', 'publish']) {
        expect((await step(exam.id, action)).status, action).toBe(409);
      }
      await save(admin, exam.id, grade7.id, [
        entry(students.amina, subjects.MAT, { score: 1 }, 1),
      ]).expect(409);
      await asAdmin('patch', `/examinations/${exam.id}`).send({ name: 'Changed' }).expect(409);
      await asAdmin('delete', `/examinations/${exam.id}`).expect(409);
      const french = published.subjectsByClass[0]?.subjects.find((s) => s.code === 'FRE');
      await asAdmin('put', `/examinations/${exam.id}/subjects/${french?.examSubjectId}`)
        .send({ maxMarks: 10 })
        .expect(409);

      const actions = (
        await ctx.prisma.auditLog.findMany({
          where: { resourceId: exam.id, action: { startsWith: 'examination.' } },
          orderBy: { createdAt: 'asc' },
        })
      ).map((log) => log.action);
      expect(actions.filter((a) => !a.endsWith('updated'))).toEqual([
        'examination.created',
        'examination.opened',
        'examination.compiled',
        'examination.reopened',
        'examination.compiled',
        'examination.approved',
        'examination.published',
      ]);
    });

    it('will not lower a maximum below a mark already entered, nor delete an exam with marks', async () => {
      const other = dataOf<ExaminationDetail>(
        await asAdmin('post', '/examinations').send(newExam()).expect(201),
      );
      await step(other.id, 'open').expect(200);
      await save(admin, other.id, grade7.id, [
        entry(students.amina, subjects.MAT, { score: 70 }),
      ]).expect(200);
      const maths = other.subjectsByClass[0]?.subjects.find((s) => s.code === 'MAT');

      const lowered = await asAdmin(
        'put',
        `/examinations/${other.id}/subjects/${maths?.examSubjectId}`,
      ).send({ maxMarks: 50 });
      const removed = await asAdmin('delete', `/examinations/${other.id}`);

      expect(errorOf(lowered).code).toBe('MARKS_EXCEED_MAXIMUM');
      expect(errorOf(removed).code).toBe('EXAM_HAS_MARKS');
      const empty = dataOf<ExaminationDetail>(
        await asAdmin('post', '/examinations').send(newExam()).expect(201),
      );
      await asAdmin('delete', `/examinations/${empty.id}`).expect(204);
    });
  });

  describe('competency-based classes', () => {
    it('takes performance levels instead of scores and compiles them by points', async () => {
      const [dan, eve] = await Promise.all([
        admit('Dan', grade4.id, null),
        admit('Eve', grade4.id, null),
      ]);
      const cba = dataOf<ExaminationDetail>(
        await asAdmin('post', '/examinations')
          .send(newExam({ type: 'CONTINUOUS_ASSESSMENT', classIds: [grade4.id] }))
          .expect(201),
      );
      await step(cba.id, 'open').expect(200);

      const score = await save(admin, cba.id, grade4.id, [entry(dan, subjects.MAT, { score: 80 })]);
      const unknown = await save(admin, cba.id, grade4.id, [
        entry(dan, subjects.MAT, { level: 'ZZ' }),
      ]);
      expect(errorOf(score).message).toContain('graded by performance level');
      expect(errorOf(unknown).message).toContain('not a level of the grading scheme');

      const sheet = dataOf<MarksSheet>(
        await save(admin, cba.id, grade4.id, [
          entry(dan, subjects.MAT, { level: 'EE' }),
          entry(dan, subjects.ENG, { level: 'me' }),
          entry(eve, subjects.MAT, { level: 'AE' }),
          entry(eve, subjects.ENG, { level: 'AE' }),
        ]).expect(200),
      );
      expect(sheet.grading).toMatchObject({
        levelBased: true,
        levels: [{ label: 'EE' }, { label: 'ME' }, { label: 'AE' }, { label: 'BE' }],
      });
      expect(sheet.students.find((s) => s.studentId === dan?.id)).toMatchObject({
        total: 7,
        maxTotal: 8,
        average: 3.5,
        grade: 'EE',
      });

      await step(cba.id, 'compile').expect(200);
      const results = await ctx.prisma.result.findMany({
        where: { examinationId: cba.id },
        include: { subjects: true },
        orderBy: { classPosition: 'asc' },
      });
      expect(
        results.map((r) => [r.grade, r.gradeDescriptor, r.average.toNumber(), r.classPosition]),
      ).toEqual([
        ['EE', 'Exceeding Expectation', 3.5, 1],
        ['AE', 'Approaching Expectation', 2, 2],
      ]);
      // No percentage is ever invented for a level.
      expect(
        results.flatMap((r) => r.subjects).every((s) => s.percentage === null && s.score === null),
      ).toBe(true);
    });
  });

  describe('isolation', () => {
    it('keeps examinations and marks within their tenant', async () => {
      expect(
        dataOf<ExaminationSummary[]>(await call(betaAdmin, 'get', '/examinations').expect(200)),
      ).toEqual([]);
      await call(betaAdmin, 'get', `/examinations/${exam.id}`).expect(404);
      await call(betaAdmin, 'get', `/examinations/${exam.id}/marks?classId=${grade7.id}`).expect(
        404,
      );
      await call(betaAdmin, 'post', `/examinations/${exam.id}/reopen`).expect(404);
      await save(betaAdmin, exam.id, grade7.id, [
        entry(students.amina, subjects.MAT, { score: 1 }, 1),
      ]).expect(404);
      await call(betaAdmin, 'post', '/examinations').send(newExam()).expect(400);

      const visible = await ctx.prisma.withTenant(beta.id, async (tx) => ({
        marks: await tx.mark.count(),
        results: await tx.result.count(),
        resultSubjects: await tx.resultSubject.count(),
      }));
      expect(visible).toEqual({ marks: 0, results: 0, resultSubjects: 0 });
    });
  });
});
