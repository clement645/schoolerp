import type { AcademicYearView, TermView } from '../src/modules/academics/academics.service.js';
import type { CalendarEventView } from '../src/modules/calendar/calendar.service.js';
import type { ClassView } from '../src/modules/classes/classes.service.js';
import type { Dashboard } from '../src/modules/dashboard/dashboard.service.js';
import type { ExaminationDetail } from '../src/modules/examinations/examinations.service.js';
import type { StudentDetail } from '../src/modules/students/students.service.js';
import type { SubjectView } from '../src/modules/subjects/subjects.service.js';
import {
  createTestApp,
  dataOf,
  errorOf,
  seedTenant,
  seedUser,
  signIn,
  type SeededTenant,
  type SignedIn,
  type TestContext,
} from './support/app.js';

type Method = 'get' | 'post' | 'put' | 'delete';

const iso = (offsetDays: number): string => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

describe('Calendar and dashboard (e2e)', () => {
  let ctx: TestContext;
  let alpha: SeededTenant;
  let beta: SeededTenant;
  let admin: SignedIn;
  let betaAdmin: SignedIn;
  let teacher: SignedIn;
  let accountant: SignedIn;
  let parent: SignedIn;

  const call = (actor: SignedIn, method: Method, path: string) =>
    ctx.http()[method](`/api/v1${path}`).set('Authorization', actor.bearer);
  const asAdmin = (method: Method, path: string) => call(admin, method, path);
  const dashboardOf = async (actor: SignedIn, query = '') =>
    dataOf<Dashboard>(await call(actor, 'get', `/dashboard${query}`).expect(200));
  const event = (overrides: Record<string, unknown> = {}) => ({
    title: 'Parents’ day',
    category: 'MEETING',
    visibility: 'EVERYONE',
    startDate: iso(7),
    ...overrides,
  });
  const eventsOf = async (actor: SignedIn) =>
    dataOf<CalendarEventView[]>(
      await call(actor, 'get', `/calendar/events?from=${iso(0)}&to=${iso(60)}`).expect(200),
    );

  beforeAll(async () => {
    ctx = await createTestApp();
    [alpha, beta] = await Promise.all([seedTenant(ctx), seedTenant(ctx)]);
    const [teacherUser, accountantUser, parentUser] = await Promise.all([
      seedUser(ctx, { tenantId: alpha.id, roles: ['TEACHER'] }),
      seedUser(ctx, { tenantId: alpha.id, roles: ['ACCOUNTANT'] }),
      seedUser(ctx, { tenantId: alpha.id, roles: ['PARENT'] }),
    ]);
    [admin, betaAdmin, teacher, accountant, parent] = await Promise.all([
      signIn(ctx, alpha.admin),
      signIn(ctx, beta.admin),
      signIn(ctx, teacherUser),
      signIn(ctx, accountantUser),
      signIn(ctx, parentUser),
    ]);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('an empty school', () => {
    it('shows zeros and empty lists, never invented figures', async () => {
      const dashboard = await dashboardOf(admin);
      expect(dashboard.term).toBeNull();
      expect(dashboard.counts).toEqual({ students: 0, teachers: 0, classes: 0 });
      expect(dashboard.attendance?.week).toHaveLength(7);
      expect(
        dashboard.attendance?.week.every((day) => day.rate === null && day.present === 0),
      ).toBe(true);
      expect(dashboard.attendance?.today).toEqual({ rate: null, marked: 0 });
      expect(dashboard.performance).toEqual({ trend: [], latest: null, meritList: [] });
      expect(dashboard.finance).toMatchObject({ collected: 0, outstanding: 0, recentPayments: [] });
      expect(dashboard.upcomingEvents).toEqual([]);
    });
  });

  describe('calendar', () => {
    let open: CalendarEventView;

    it('creates events and validates their dates and times', async () => {
      open = dataOf<CalendarEventView>(
        await asAdmin('post', '/calendar/events')
          .send(event({ startTime: '09:00', endTime: '13:00', location: 'Main hall' }))
          .expect(201),
      );
      expect(open).toMatchObject({
        startDate: iso(7),
        endDate: iso(7),
        startTime: '09:00',
        visibility: 'EVERYONE',
      });
      await asAdmin('post', '/calendar/events')
        .send(event({ title: 'Staff briefing', visibility: 'STAFF', startDate: iso(3) }))
        .expect(201);

      const backwards = await asAdmin('post', '/calendar/events')
        .send(event({ endDate: iso(5) }))
        .expect(400);
      expect(errorOf(backwards).code).toBe('INVALID_RANGE');
      const times = await asAdmin('post', '/calendar/events')
        .send(event({ startTime: '13:00', endTime: '09:00' }))
        .expect(400);
      expect(errorOf(times).code).toBe('INVALID_TIME');
      await asAdmin('post', '/calendar/events')
        .send(event({ startTime: '25:00' }))
        .expect(400);
      await asAdmin('post', '/calendar/events')
        .send(event({ category: 'PARTY' }))
        .expect(400);
    });

    it('shows parents only what is meant for everyone', async () => {
      expect((await eventsOf(teacher)).map((e) => e.title)).toEqual([
        'Staff briefing',
        'Parents’ day',
      ]);
      expect((await eventsOf(parent)).map((e) => e.title)).toEqual(['Parents’ day']);
      expect((await dashboardOf(parent)).upcomingEvents?.map((e) => e.title)).toEqual([
        'Parents’ day',
      ]);
    });

    it('lists only events that overlap the period asked for', async () => {
      await asAdmin('post', '/calendar/events')
        .send(
          event({
            title: 'Mid-term break',
            category: 'HOLIDAY',
            startDate: iso(58),
            endDate: iso(65),
          }),
        )
        .expect(201);
      // Starts inside the window and runs past its end: still included.
      expect((await eventsOf(admin)).map((e) => e.title)).toContain('Mid-term break');
      const later = dataOf<CalendarEventView[]>(
        await asAdmin('get', `/calendar/events?from=${iso(70)}&to=${iso(90)}`).expect(200),
      );
      expect(later).toEqual([]);
      await asAdmin('get', `/calendar/events?from=${iso(10)}&to=${iso(0)}`).expect(400);
      await asAdmin('get', `/calendar/events?from=${iso(0)}&to=${iso(900)}`).expect(400);
    });

    it('keeps changes to those who manage the calendar, within their tenant', async () => {
      await call(teacher, 'post', '/calendar/events').send(event()).expect(403);
      await call(parent, 'delete', `/calendar/events/${open.id}`).expect(403);
      await call(betaAdmin, 'put', `/calendar/events/${open.id}`).send(event()).expect(404);
      await call(betaAdmin, 'delete', `/calendar/events/${open.id}`).expect(404);
      expect(await eventsOf(betaAdmin)).toEqual([]);

      const moved = dataOf<CalendarEventView>(
        await asAdmin('put', `/calendar/events/${open.id}`)
          .send(event({ startDate: iso(8) }))
          .expect(200),
      );
      expect(moved).toMatchObject({ startDate: iso(8), startTime: null });
    });

    it('deletes an event', async () => {
      const extra = dataOf<CalendarEventView>(
        await asAdmin('post', '/calendar/events')
          .send(event({ title: 'Cancelled trip' }))
          .expect(201),
      );
      await asAdmin('delete', `/calendar/events/${extra.id}`).expect(204);
      await asAdmin('delete', `/calendar/events/${extra.id}`).expect(404);
    });
  });

  describe('a school in session', () => {
    let term: TermView;
    let lastTerm: TermView;

    beforeAll(async () => {
      const year = dataOf<AcademicYearView>(
        await asAdmin('post', '/academic-years')
          .send({ name: 'This year', startDate: iso(-200), endDate: iso(100) })
          .expect(201),
      );
      lastTerm = dataOf<TermView>(
        await asAdmin('post', `/academic-years/${year.id}/terms`)
          .send({ name: 'Term 1', sequence: 1, startDate: iso(-200), endDate: iso(-101) })
          .expect(201),
      );
      term = dataOf<TermView>(
        await asAdmin('post', `/academic-years/${year.id}/terms`)
          .send({ name: 'Term 2', sequence: 2, startDate: iso(-60), endDate: iso(30) })
          .expect(201),
      );
      await asAdmin('post', `/terms/${term.id}/set-current`).expect((r) =>
        expect(r.status).toBeLessThan(300),
      );
      await asAdmin('post', '/grading-schemes')
        .send({
          name: 'Percentage',
          type: 'PERCENTAGE',
          boundaries: [
            { label: 'A', minScore: 80, points: 12 },
            { label: 'C', minScore: 50, points: 6 },
            { label: 'E', minScore: 0, points: 1 },
          ],
        })
        .expect(201);
      const maths = dataOf<SubjectView>(
        await asAdmin('post', '/subjects').send({ name: 'Mathematics', code: 'MAT' }).expect(201),
      );
      const grade7 = dataOf<ClassView>(
        await asAdmin('post', '/classes').send({ name: 'Grade 7', level: 7 }).expect(201),
      );
      await asAdmin('put', `/classes/${grade7.id}/subjects`)
        .send({ subjects: [{ subjectId: maths.id, isCompulsory: true }] })
        .expect(200);
      const admit = async (firstName: string, admissionNumber: string) =>
        dataOf<StudentDetail>(
          await asAdmin('post', '/students')
            .send({
              admissionNumber,
              firstName,
              lastName: 'Learner',
              dateOfBirth: '2013-04-17',
              gender: 'FEMALE',
              admissionDate: iso(-150),
              classId: grade7.id,
              streamId: null,
            })
            .expect(201),
        );
      const amina = await admit('Amina', 'D-001');
      const brian = await admit('Brian', 'D-002');

      await asAdmin('put', '/attendance/register')
        .send({
          classId: grade7.id,
          date: iso(0),
          records: [
            { studentId: amina.id, status: 'PRESENT' },
            { studentId: brian.id, status: 'ABSENT' },
          ],
        })
        .expect(200);

      const exam = dataOf<ExaminationDetail>(
        await asAdmin('post', '/examinations')
          .send({
            name: 'Mid-term',
            type: 'MID_TERM',
            termId: term.id,
            startDate: iso(-20),
            endDate: iso(-18),
            classIds: [grade7.id],
          })
          .expect(201),
      );
      await asAdmin('post', `/examinations/${exam.id}/open`).expect(200);
      await asAdmin('put', `/examinations/${exam.id}/marks`)
        .send({
          classId: grade7.id,
          entries: [
            { studentId: amina.id, subjectId: maths.id, version: 0, score: 90 },
            { studentId: brian.id, subjectId: maths.id, version: 0, score: 40 },
          ],
        })
        .expect(200);
      await asAdmin('post', `/examinations/${exam.id}/compile`).expect(200);

      await asAdmin('post', '/finance/invoices')
        .send({
          studentId: amina.id,
          termId: term.id,
          dueDate: iso(20),
          lines: [{ description: 'Tuition', amount: 10000 }],
        })
        .expect(201);
      await asAdmin('post', '/finance/payments')
        .send({ studentId: amina.id, amount: 4000, method: 'CASH' })
        .expect(201);
    });

    it('brings together the term’s real figures', async () => {
      const dashboard = await dashboardOf(admin);
      expect(dashboard.term).toMatchObject({
        id: term.id,
        name: 'Term 2',
        academicYear: 'This year',
      });
      expect(dashboard.counts).toEqual({ students: 2, teachers: 0, classes: 1 });

      expect(dashboard.attendance?.today).toEqual({ rate: 50, marked: 2 });
      expect(dashboard.attendance?.week[6]).toEqual({
        date: iso(0),
        present: 1,
        absent: 1,
        late: 0,
        excused: 0,
        rate: 50,
      });
      expect(dashboard.attendance?.week[5]).toMatchObject({ date: iso(-1), rate: null });

      expect(dashboard.performance?.latest).toMatchObject({
        name: 'Mid-term',
        meanScore: 65,
        passPercentage: 50,
      });
      expect(dashboard.performance?.trend).toEqual([
        { examination: 'Mid-term', date: iso(-20), mean: 65, passPercentage: 50 },
      ]);
      expect(
        dashboard.performance?.meritList.map((row) => [row.rank, row.student.name, row.average]),
      ).toEqual([
        [1, 'Amina Learner', 90],
        [2, 'Brian Learner', 40],
      ]);

      expect(dashboard.finance).toMatchObject({
        currency: 'KES',
        collected: 4000,
        outstanding: 6000,
        collectionRate: 40,
      });
      expect(dashboard.finance?.recentPayments).toHaveLength(1);
      expect(dashboard.upcomingEvents?.map((e) => e.title)).toEqual([
        'Staff briefing',
        'Parents’ day',
        'Mid-term break',
      ]);
    });

    it('follows the term that is chosen', async () => {
      const earlier = await dashboardOf(admin, `?termId=${lastTerm.id}`);
      expect(earlier.term?.name).toBe('Term 1');
      // Nothing was examined or invoiced in Term 1.
      expect(earlier.performance).toEqual({ trend: [], latest: null, meritList: [] });
      expect(earlier.finance).toMatchObject({ collected: 0, outstanding: 0 });
      await asAdmin('get', '/dashboard?termId=not-a-uuid').expect(400);
    });

    it('leaves out what the caller may not see', async () => {
      const forAccountant = await dashboardOf(accountant);
      expect(forAccountant.counts).toEqual({ students: 2, teachers: null, classes: 1 });
      expect(forAccountant.attendance).toBeNull();
      expect(forAccountant.performance).toBeNull();
      expect(forAccountant.finance?.collected).toBe(4000);

      // A teacher with no classes sees no learners, results or attendance of others.
      const forTeacher = await dashboardOf(teacher);
      expect(forTeacher.counts.students).toBe(0);
      expect(forTeacher.finance).toBeNull();
      expect(forTeacher.attendance?.today).toEqual({ rate: null, marked: 0 });
      expect(forTeacher.performance?.meritList).toEqual([]);

      const forParent = await dashboardOf(parent);
      expect(forParent).toMatchObject({
        counts: { students: null, teachers: null, classes: null },
        attendance: null,
        performance: null,
        finance: null,
      });
      await ctx.http().get('/api/v1/dashboard').expect(401);
    });

    it('shows another tenant nothing of this one', async () => {
      const theirs = await dashboardOf(betaAdmin);
      expect(theirs.counts).toEqual({ students: 0, teachers: 0, classes: 0 });
      expect(theirs.upcomingEvents).toEqual([]);
      expect(theirs.finance?.collected).toBe(0);
    });
  });
});
