import type { AcademicYearView } from '../src/modules/academics/academics.service.js';
import type {
  AttendanceSummary,
  MonthlyRegister,
  RegisterView,
  StudentAttendance,
} from '../src/modules/attendance/attendance.service.js';
import type { ClassView } from '../src/modules/classes/classes.service.js';
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

type Method = 'get' | 'post' | 'put';
type Name = 'amina' | 'brian' | 'chege' | 'dalia' | 'eve';
type Status = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';

describe('Attendance (e2e)', () => {
  let ctx: TestContext;
  let alpha: SeededTenant;
  let beta: SeededTenant;
  let admin: SignedIn;
  let betaAdmin: SignedIn;
  let teacher: SignedIn;
  let accountant: SignedIn;

  let grade7: ClassView;
  let grade8: ClassView;
  let students: Record<Name, StudentDetail>;

  const call = (actor: SignedIn, method: Method, path: string) =>
    ctx.http()[method](`/api/v1${path}`).set('Authorization', actor.bearer);
  const asAdmin = (method: Method, path: string) => call(admin, method, path);
  const streamId = (name: string) => grade7.streams.find((s) => s.name === name)?.id as string;
  const mark = (
    actor: SignedIn,
    classId: string,
    date: string,
    records: Partial<Record<Name, Status>>,
    extra: Record<string, unknown> = {},
  ) =>
    call(actor, 'put', '/attendance/register').send({
      classId,
      date,
      records: Object.entries(records).map(([name, status]) => ({
        studentId: students[name as Name].id,
        status,
      })),
      ...extra,
    });
  const registerOf = async (actor: SignedIn, query: string) =>
    dataOf<RegisterView>(await call(actor, 'get', `/attendance/register?${query}`).expect(200));
  const statuses = (register: RegisterView): Record<string, Status | null> =>
    Object.fromEntries(
      register.students.map((row) => [row.student.name.split(' ')[0] ?? '', row.status]),
    );

  let admission = 0;
  async function admit(firstName: string, classId: string, stream: string | null) {
    return dataOf<StudentDetail>(
      await asAdmin('post', '/students')
        .send({
          admissionNumber: `A-${String((admission += 1)).padStart(3, '0')}`,
          firstName,
          lastName: 'Learner',
          dateOfBirth: '2013-04-17',
          gender: 'MALE',
          admissionDate: '2026-01-05',
          classId,
          streamId: stream,
        })
        .expect(201),
    );
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    [alpha, beta] = await Promise.all([seedTenant(ctx), seedTenant(ctx)]);
    const [teacherUser, accountantUser] = await Promise.all([
      seedUser(ctx, { tenantId: alpha.id, roles: ['TEACHER'] }),
      seedUser(ctx, { tenantId: alpha.id, roles: ['ACCOUNTANT'] }),
    ]);
    [admin, betaAdmin, teacher, accountant] = await Promise.all([
      signIn(ctx, alpha.admin),
      signIn(ctx, beta.admin),
      signIn(ctx, teacherUser),
      signIn(ctx, accountantUser),
    ]);

    dataOf<AcademicYearView>(
      await asAdmin('post', '/academic-years')
        .send({ name: '2026', startDate: '2026-01-05', endDate: '2026-11-20' })
        .expect(201),
    );
    const maths = dataOf<SubjectView>(
      await asAdmin('post', '/subjects').send({ name: 'Mathematics', code: 'MAT' }).expect(201),
    );
    const createClass = async (name: string, level: number, streams: string[]) => {
      const created = dataOf<ClassView>(
        await asAdmin('post', '/classes').send({ name, level }).expect(201),
      );
      for (const stream of streams) {
        await asAdmin('post', `/classes/${created.id}/streams`).send({ name: stream }).expect(201);
      }
      return dataOf<ClassView[]>(await asAdmin('get', '/classes').expect(200)).find(
        (c) => c.id === created.id,
      ) as ClassView;
    };
    grade7 = await createClass('Grade 7', 7, ['East', 'West']);
    await asAdmin('put', `/classes/${grade7.id}/subjects`)
      .send({ subjects: [{ subjectId: maths.id, isCompulsory: true }] })
      .expect(200);
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
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('marking a register', () => {
    it('starts unmarked, listing the class’s active learners', async () => {
      const register = await registerOf(admin, `classId=${grade7.id}&date=2026-10-05`);
      expect(register.lastMarkedAt).toBeNull();
      expect(statuses(register)).toEqual({ Amina: null, Brian: null, Chege: null, Dalia: null });
      expect(register.summary).toMatchObject({ marked: 0, unmarked: 4, rate: null });
    });

    it('marks several learners at once and returns the register', async () => {
      const register = dataOf<RegisterView>(
        await mark(admin, grade7.id, '2026-10-05', {
          amina: 'PRESENT',
          brian: 'LATE',
          chege: 'ABSENT',
        }).expect(200),
      );
      expect(statuses(register)).toEqual({
        Amina: 'PRESENT',
        Brian: 'LATE',
        Chege: 'ABSENT',
        Dalia: null,
      });
      expect(register.summary).toMatchObject({
        present: 1,
        late: 1,
        absent: 1,
        unmarked: 1,
        rate: 66.67,
      });
      expect(register.lastMarkedAt).not.toBeNull();
    });

    it('corrects a mark instead of duplicating it', async () => {
      await mark(admin, grade7.id, '2026-10-05', { chege: 'EXCUSED', dalia: 'PRESENT' }, {}).expect(
        200,
      );
      await mark(admin, grade7.id, '2026-10-05', { chege: 'EXCUSED' }).expect(200);

      const sessions = await ctx.prisma.attendanceSession.count({ where: { classId: grade7.id } });
      const records = await ctx.prisma.attendanceRecord.findMany({
        where: { studentId: students.chege.id },
      });
      expect(sessions).toBe(1);
      expect(records).toHaveLength(1);
      expect(records[0]?.status).toBe('EXCUSED');

      // Only real changes are audited: the repeat of EXCUSED is not one.
      const audits = await ctx.prisma.auditLog.findMany({
        where: { tenantId: alpha.id, action: 'attendance.marked' },
        orderBy: { createdAt: 'asc' },
      });
      expect(audits).toHaveLength(2);
      expect(audits[1]?.metadata).toMatchObject({
        created: 1,
        corrected: [{ studentId: students.chege.id, from: 'ABSENT', to: 'EXCUSED' }],
      });
    });

    it('lets the database refuse a second mark for the same learner and day', async () => {
      const session = await ctx.prisma.attendanceSession.findFirstOrThrow({
        where: { classId: grade7.id },
      });
      await expect(
        ctx.prisma.attendanceRecord.create({
          data: {
            tenantId: alpha.id,
            schoolId: alpha.schoolId,
            sessionId: session.id,
            studentId: students.amina.id,
            date: session.date,
            status: 'ABSENT',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('rejects invalid registers without recording anything', async () => {
      const count = () => ctx.prisma.attendanceRecord.count({ where: { tenantId: alpha.id } });
      const before = await count();

      const future = await mark(admin, grade7.id, '2099-01-01', { amina: 'PRESENT' }).expect(422);
      expect(errorOf(future).code).toBe('DATE_IN_FUTURE');
      // Eve is in Grade 8: the whole register is refused, including Amina.
      const wrongClass = await mark(admin, grade7.id, '2026-10-06', {
        amina: 'PRESENT',
        eve: 'PRESENT',
      }).expect(422);
      expect(errorOf(wrongClass).code).toBe('STUDENT_NOT_IN_CLASS');

      const twice = await call(admin, 'put', '/attendance/register')
        .send({
          classId: grade7.id,
          date: '2026-10-06',
          records: [
            { studentId: students.amina.id, status: 'PRESENT' },
            { studentId: students.amina.id, status: 'ABSENT' },
          ],
        })
        .expect(400);
      expect(errorOf(twice).code).toBe('DUPLICATE_STUDENT');

      await mark(admin, grade7.id, '2026-10-06', { amina: 'HERE' as Status }).expect(400);
      await mark(admin, grade7.id, '06/10/2026', { amina: 'PRESENT' }).expect(400);
      await call(admin, 'put', '/attendance/register')
        .send({ classId: grade7.id, date: '2026-10-06', records: [] })
        .expect(400);
      expect(await count()).toBe(before);
    });

    it('does not mark learners who have left', async () => {
      const leaver = await admit('Felix', grade8.id, null);
      await asAdmin('post', `/students/${leaver.id}/status`)
        .send({ status: 'WITHDRAWN', effectiveDate: '2026-10-01', reason: 'Relocated' })
        .expect((response) => expect([200, 201]).toContain(response.status));
      const refused = await call(admin, 'put', '/attendance/register')
        .send({
          classId: grade8.id,
          date: '2026-10-06',
          records: [{ studentId: leaver.id, status: 'PRESENT' }],
        })
        .expect(422);
      expect(errorOf(refused).code).toBe('STUDENT_NOT_IN_CLASS');
    });
  });

  describe('who may mark and see what', () => {
    it('limits a teacher to the stream they teach', async () => {
      const register = await registerOf(teacher, `classId=${grade7.id}&date=2026-10-05`);
      expect(Object.keys(statuses(register))).toEqual(['Amina', 'Brian']);

      await mark(teacher, grade7.id, '2026-10-06', { amina: 'PRESENT', brian: 'ABSENT' }).expect(
        200,
      );
      // Chege is in the other stream.
      const other = await mark(teacher, grade7.id, '2026-10-06', { chege: 'PRESENT' }).expect(422);
      expect(errorOf(other).code).toBe('STUDENT_NOT_IN_CLASS');
      // Grade 8 is not theirs at all.
      const notTheirs = await call(
        teacher,
        'get',
        `/attendance/register?classId=${grade8.id}&date=2026-10-06`,
      ).expect(403);
      expect(errorOf(notTheirs).code).toBe('CLASS_NOT_ASSIGNED');
      await mark(teacher, grade8.id, '2026-10-06', { eve: 'PRESENT' }).expect(403);
    });

    it('keeps out those without attendance permissions', async () => {
      const path = `/attendance/register?classId=${grade7.id}&date=2026-10-05`;
      await call(accountant, 'get', path).expect(403);
      await mark(accountant, grade7.id, '2026-10-07', { amina: 'PRESENT' }).expect(403);
      await call(accountant, 'get', '/attendance/summary?from=2026-10-01&to=2026-10-31').expect(
        403,
      );
      await ctx.http().get(`/api/v1${path}`).expect(401);
    });

    it('keeps attendance within its tenant', async () => {
      await call(
        betaAdmin,
        'get',
        `/attendance/register?classId=${grade7.id}&date=2026-10-05`,
      ).expect(404);
      await mark(betaAdmin, grade7.id, '2026-10-05', { amina: 'ABSENT' }).expect(404);
      await call(
        betaAdmin,
        'get',
        `/attendance/students/${students.amina.id}?from=2026-10-01&to=2026-10-31`,
      ).expect(404);
      const summary = dataOf<AttendanceSummary>(
        await call(betaAdmin, 'get', '/attendance/summary?from=2026-10-01&to=2026-10-31').expect(
          200,
        ),
      );
      expect(summary.totals.marked).toBe(0);
    });
  });

  describe('summaries and reports', () => {
    beforeAll(async () => {
      // 05: Amina P, Brian L, Chege E, Dalia P.  06: Amina P, Brian A (teacher).
      await mark(admin, grade7.id, '2026-10-06', { chege: 'PRESENT', dalia: 'ABSENT' }).expect(200);
      await mark(admin, grade8.id, '2026-10-06', { eve: 'PRESENT' }).expect(200);
    });

    it('totals a period, by day and by class', async () => {
      const summary = dataOf<AttendanceSummary>(
        await asAdmin('get', '/attendance/summary?from=2026-10-01&to=2026-10-31').expect(200),
      );
      expect(summary.totals).toEqual({
        present: 5,
        absent: 2,
        late: 1,
        excused: 1,
        marked: 9,
        rate: 66.67,
      });
      expect(summary.daily.map((day) => [day.date, day.marked, day.rate])).toEqual([
        ['2026-10-05', 4, 75],
        ['2026-10-06', 5, 60],
      ]);
      expect(summary.byClass).toEqual([
        { classId: grade7.id, class: 'Grade 7', rate: 62.5, marked: 8 },
        { classId: grade8.id, class: 'Grade 8', rate: 100, marked: 1 },
      ]);
      // Per-learner rows need a class.
      expect(summary.students).toEqual([]);
    });

    it('lists each learner of a class or stream', async () => {
      const summary = dataOf<AttendanceSummary>(
        await asAdmin(
          'get',
          `/attendance/summary?classId=${grade7.id}&streamId=${streamId('East')}&from=2026-10-01&to=2026-10-31`,
        ).expect(200),
      );
      expect(
        summary.students.map((row) => [
          row.student.name,
          row.present,
          row.late,
          row.absent,
          row.rate,
        ]),
      ).toEqual([
        ['Amina Learner', 2, 0, 0, 100],
        ['Brian Learner', 0, 1, 1, 50],
      ]);
      expect(summary.totals.marked).toBe(4);
    });

    it('narrows a teacher’s summary to their own learners', async () => {
      const summary = dataOf<AttendanceSummary>(
        await call(teacher, 'get', '/attendance/summary?from=2026-10-01&to=2026-10-31').expect(200),
      );
      expect(summary.totals.marked).toBe(4);
      expect(summary.byClass.map((row) => row.class)).toEqual(['Grade 7']);
    });

    it('lays out a month as a register', async () => {
      const month = dataOf<MonthlyRegister>(
        await asAdmin('get', `/attendance/monthly?classId=${grade7.id}&month=2026-10`).expect(200),
      );
      expect(month.days).toEqual(['2026-10-05', '2026-10-06']);
      const chege = month.students.find((row) => row.student.name === 'Chege Learner');
      expect(chege).toMatchObject({
        stream: 'West',
        marks: { '2026-10-05': 'EXCUSED', '2026-10-06': 'PRESENT' },
        present: 1,
        excused: 1,
        rate: 50,
      });
      const empty = dataOf<MonthlyRegister>(
        await asAdmin('get', `/attendance/monthly?classId=${grade7.id}&month=2026-09`).expect(200),
      );
      expect(empty).toMatchObject({ days: [], students: [] });
    });

    it('reports one learner’s history', async () => {
      const history = dataOf<StudentAttendance>(
        await asAdmin(
          'get',
          `/attendance/students/${students.brian.id}?from=2026-10-01&to=2026-10-31`,
        ).expect(200),
      );
      expect(history.totals).toMatchObject({ late: 1, absent: 1, marked: 2, rate: 50 });
      expect(history.records.map((record) => [record.date, record.status])).toEqual([
        ['2026-10-06', 'ABSENT'],
        ['2026-10-05', 'LATE'],
      ]);
      await call(
        teacher,
        'get',
        `/attendance/students/${students.chege.id}?from=2026-10-01&to=2026-10-31`,
      ).expect(404);
    });

    it('validates report periods', async () => {
      const backwards = await asAdmin(
        'get',
        '/attendance/summary?from=2026-10-31&to=2026-10-01',
      ).expect(400);
      expect(errorOf(backwards).code).toBe('INVALID_RANGE');
      const tooLong = await asAdmin(
        'get',
        '/attendance/summary?from=2024-01-01&to=2026-10-01',
      ).expect(400);
      expect(errorOf(tooLong).code).toBe('RANGE_TOO_LONG');
      await asAdmin('get', `/attendance/monthly?classId=${grade7.id}&month=2026-13`).expect(400);
      await asAdmin('get', '/attendance/summary?from=2026-10-01').expect(400);
    });
  });
});
