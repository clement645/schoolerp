import type { Paginated } from '../src/common/http/pagination.js';
import type { AcademicYearView } from '../src/modules/academics/academics.service.js';
import type { ClassView } from '../src/modules/classes/classes.service.js';
import type {
  ImportResult,
  PromotionResult,
  StudentDetail,
  StudentSummary,
} from '../src/modules/students/students.service.js';
import type { SubjectView } from '../src/modules/subjects/subjects.service.js';
import type {
  TeacherDetail,
  TeacherSummary,
  Workload,
} from '../src/modules/teachers/teachers.service.js';
import {
  createTestApp,
  dataOf,
  errorOf,
  seedTenant,
  seedUser,
  signIn,
  unique,
  type SeededTenant,
  type SeededUser,
  type SignedIn,
  type TestContext,
} from './support/app.js';

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

const HEADER =
  'admission_number,first_name,middle_name,last_name,date_of_birth,gender,nationality,admission_date,class,stream,guardian_first_name,guardian_last_name,guardian_phone,guardian_relationship';

describe('Students and teachers (e2e)', () => {
  let ctx: TestContext;
  let alpha: SeededTenant;
  let beta: SeededTenant;
  let admin: SignedIn;
  let betaAdmin: SignedIn;
  let teacherUser: SeededUser;
  let teacher: SignedIn;

  let year2026: AcademicYearView;
  let grade7: ClassView;
  let grade8: ClassView;
  let maths: SubjectView;
  const stream = (schoolClass: ClassView, name: string) =>
    schoolClass.streams.find((entry) => entry.name === name)?.id as string;

  const call = (actor: SignedIn, method: Method, path: string) =>
    ctx.http()[method](`/api/v1${path}`).set('Authorization', actor.bearer);
  const asAdmin = (method: Method, path: string) => call(admin, method, path);

  let admissionCounter = 0;
  const newStudent = (overrides: Record<string, unknown> = {}) => ({
    admissionNumber: `ADM-${String((admissionCounter += 1)).padStart(4, '0')}`,
    firstName: 'Amina',
    lastName: 'Otieno',
    dateOfBirth: '2013-04-17',
    gender: 'FEMALE',
    admissionDate: '2026-01-05',
    classId: grade7.id,
    streamId: stream(grade7, 'East'),
    ...overrides,
  });
  const admit = async (overrides: Record<string, unknown> = {}) =>
    dataOf<StudentDetail>(
      await asAdmin('post', '/students').send(newStudent(overrides)).expect(201),
    );
  const directory = async (actor: SignedIn, query = '') =>
    dataOf<Paginated<StudentSummary>>(
      await call(actor, 'get', `/students?pageSize=100${query}`).expect(200),
    );

  /** Creates a class with streams and returns it as listed. */
  async function createClass(name: string, level: number, streams: string[]): Promise<ClassView> {
    const created = dataOf<ClassView>(
      await asAdmin('post', '/classes').send({ name, level }).expect(201),
    );
    for (const streamName of streams) {
      await asAdmin('post', `/classes/${created.id}/streams`)
        .send({ name: streamName })
        .expect(201);
    }
    const classes = dataOf<ClassView[]>(await asAdmin('get', '/classes').expect(200));
    return classes.find((entry) => entry.id === created.id) as ClassView;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    [alpha, beta] = await Promise.all([seedTenant(ctx), seedTenant(ctx)]);
    teacherUser = await seedUser(ctx, { tenantId: alpha.id, roles: ['TEACHER'] });
    [admin, betaAdmin, teacher] = await Promise.all([
      signIn(ctx, alpha.admin),
      signIn(ctx, beta.admin),
      signIn(ctx, teacherUser),
    ]);

    year2026 = dataOf<AcademicYearView>(
      await asAdmin('post', '/academic-years')
        .send({ name: '2026', startDate: '2026-01-05', endDate: '2026-11-20' })
        .expect(201),
    );
    grade7 = await createClass('Grade 7', 7, ['East', 'West']);
    grade8 = await createClass('Grade 8', 8, ['East']);
    maths = dataOf<SubjectView>(
      await asAdmin('post', '/subjects').send({ name: 'Mathematics', code: 'MAT' }).expect(201),
    );
    await asAdmin('put', `/classes/${grade7.id}/subjects`)
      .send({ subjects: [{ subjectId: maths.id, isCompulsory: true }] })
      .expect(200);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('admission', () => {
    it('admits a student with guardians and opens their first enrolment', async () => {
      const student = await admit({
        middleName: 'Wanjiru',
        nationality: 'Kenyan',
        emergencyContactName: 'Jane Otieno',
        emergencyContactPhone: '+254 700 000 009',
        guardians: [
          {
            firstName: 'Peter',
            lastName: 'Otieno',
            phone: '+254700000001',
            relationship: 'FATHER',
          },
          { firstName: 'Mary', lastName: 'Otieno', phone: '+254700000002', relationship: 'MOTHER' },
        ],
      });

      expect(student).toMatchObject({
        firstName: 'Amina',
        middleName: 'Wanjiru',
        status: 'ACTIVE',
        dateOfBirth: '2013-04-17',
        class: { name: 'Grade 7' },
        stream: { name: 'East' },
        leftOn: null,
      });
      expect(student.guardians.map((g) => [g.firstName, g.relationship, g.isPrimary])).toEqual([
        ['Peter', 'FATHER', true],
        ['Mary', 'MOTHER', false],
      ]);
      expect(student.enrollments).toEqual([
        expect.objectContaining({
          reason: 'ADMISSION',
          startDate: '2026-01-05',
          endDate: null,
          academicYear: expect.objectContaining({ name: '2026' }) as unknown,
          class: expect.objectContaining({ name: 'Grade 7' }) as unknown,
        }),
      ]);
    });

    it('starts this year’s placement with the year for a student admitted earlier', async () => {
      const student = await admit({ admissionDate: '2023-01-09' });

      expect(student.admissionDate).toBe('2023-01-09');
      expect(student.enrollments[0]?.startDate).toBe('2026-01-05');
    });

    it('rejects invalid admissions', async () => {
      const post = (overrides: Record<string, unknown>) =>
        asAdmin('post', '/students').send(newStudent(overrides));
      const existing = await admit();
      const guardian = {
        firstName: 'A',
        lastName: 'B',
        phone: '+254700000003',
        relationship: 'GUARDIAN',
      };

      const duplicate = await post({ admissionNumber: existing.admissionNumber });
      const noStream = await post({ streamId: null });
      const foreignStream = await post({ streamId: stream(grade8, 'East') });
      const bornAfter = await post({ dateOfBirth: '2026-02-01' });
      const future = await post({ admissionDate: '2999-01-01' });
      const twoPrimaries = await post({
        guardians: [
          { ...guardian, isPrimary: true },
          { ...guardian, isPrimary: true },
        ],
      });

      expect(duplicate.status).toBe(409);
      expect(errorOf(noStream).code).toBe('STREAM_REQUIRED');
      expect(errorOf(foreignStream).code).toBe('UNKNOWN_STREAM');
      expect(errorOf(bornAfter).code).toBe('INVALID_DATES');
      expect(errorOf(future).code).toBe('INVALID_DATES');
      expect(errorOf(twoPrimaries).code).toBe('MULTIPLE_PRIMARY_GUARDIANS');
      await post({ gender: 'UNKNOWN' }).expect(400);
      await post({ admissionNumber: 'has space' }).expect(400);
      await post({ tenantId: beta.id }).expect(400);
    });

    it('requires a current academic year', async () => {
      const response = await call(betaAdmin, 'post', '/students').send(newStudent());

      expect(response.status).toBe(409);
      expect(errorOf(response).code).toBe('NO_CURRENT_ACADEMIC_YEAR');
    });
  });

  describe('directory', () => {
    beforeAll(async () => {
      await admit({
        firstName: 'Brian',
        lastName: 'Kiptoo',
        gender: 'MALE',
        streamId: stream(grade7, 'West'),
      });
      await admit({
        firstName: 'Zawadi',
        lastName: 'Mwangi',
        classId: grade8.id,
        streamId: stream(grade8, 'East'),
      });
    });

    it('searches by any combination of name words and by admission number', async () => {
      const byWords = await directory(admin, '&search=kiptoo%20bri');
      const byNumber = await directory(admin, `&search=${byWords.items[0]?.admissionNumber}`);
      const none = await directory(admin, '&search=kiptoo%20zawadi');

      expect(byWords.items.map((s) => s.firstName)).toEqual(['Brian']);
      expect(byNumber.total).toBe(1);
      expect(none.total).toBe(0);
    });

    it('filters by class, stream, gender and status', async () => {
      const inGrade8 = await directory(admin, `&classId=${grade8.id}`);
      const west = await directory(admin, `&streamId=${stream(grade7, 'West')}`);
      const boys = await directory(admin, '&gender=MALE');
      const graduated = await directory(admin, '&status=GRADUATED');

      expect(inGrade8.items.map((s) => s.firstName)).toEqual(['Zawadi']);
      expect(west.items.map((s) => s.firstName)).toEqual(['Brian']);
      expect(boys.items.every((s) => s.gender === 'MALE')).toBe(true);
      expect(graduated.total).toBe(0);
    });

    it('sorts and paginates', async () => {
      const byName = await directory(admin);
      const byClassDesc = await directory(admin, '&sort=class&order=desc');
      const page = dataOf<Paginated<StudentSummary>>(
        await asAdmin('get', '/students?pageSize=2&page=2').expect(200),
      );

      const names = byName.items.map((s) => s.lastName);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
      expect(byClassDesc.items[0]?.class?.name).toBe('Grade 8');
      expect(page).toMatchObject({ page: 2, pageSize: 2, total: byName.total });
      expect(page.items).toHaveLength(Math.min(2, byName.total - 2));
      await asAdmin('get', '/students?sort=password').expect(400);
      await asAdmin('get', '/students?pageSize=5000').expect(400);
    });
  });

  describe('editing', () => {
    it('updates only what was sent and audits only what changed', async () => {
      const student = await admit({ middleName: 'Njeri', nationality: 'Kenyan' });

      const updated = dataOf<StudentDetail>(
        await asAdmin('patch', `/students/${student.id}`)
          .send({ firstName: 'Aminah', middleName: null, lastName: student.lastName })
          .expect(200),
      );

      expect(updated).toMatchObject({
        firstName: 'Aminah',
        middleName: null,
        nationality: 'Kenyan',
      });
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'student.updated', resourceId: student.id },
      });
      expect(audit.metadata).toEqual({
        before: { firstName: 'Amina', middleName: 'Njeri' },
        after: { firstName: 'Aminah', middleName: null },
      });
    });

    it('keeps dates consistent and admission numbers unique', async () => {
      const [first, second] = await Promise.all([admit(), admit()]);

      const dates = await asAdmin('patch', `/students/${first.id}`).send({
        dateOfBirth: '2027-01-01',
      });
      const clash = await asAdmin('patch', `/students/${first.id}`).send({
        admissionNumber: second.admissionNumber,
      });

      expect(errorOf(dates).code).toBe('INVALID_DATES');
      expect(clash.status).toBe(409);
    });
  });

  describe('transfers and status', () => {
    it('moves a student between streams, keeping the history', async () => {
      const student = await admit();

      const moved = dataOf<StudentDetail>(
        await asAdmin('post', `/students/${student.id}/transfer`)
          .send({
            classId: grade7.id,
            streamId: stream(grade7, 'West'),
            effectiveDate: '2026-03-02',
          })
          .expect(200),
      );

      expect(moved.stream?.name).toBe('West');
      expect(
        moved.enrollments.map((e) => [e.reason, e.stream?.name, e.startDate, e.endDate]),
      ).toEqual([
        ['TRANSFER', 'West', '2026-03-02', null],
        ['ADMISSION', 'East', '2026-01-05', '2026-03-02'],
      ]);
      const same = await asAdmin('post', `/students/${student.id}/transfer`).send({
        classId: grade7.id,
        streamId: stream(grade7, 'West'),
      });
      expect(errorOf(same).code).toBe('SAME_PLACEMENT');
    });

    it('suspends and reinstates without touching the enrolment', async () => {
      const student = await admit();
      const setStatus = (status: string) =>
        asAdmin('post', `/students/${student.id}/status`).send({ status });

      const suspended = dataOf<StudentDetail>(await setStatus('SUSPENDED').expect(200));
      const unchanged = await setStatus('SUSPENDED');
      const active = dataOf<StudentDetail>(await setStatus('ACTIVE').expect(200));

      expect(suspended.status).toBe('SUSPENDED');
      expect(suspended.enrollments[0]?.endDate).toBeNull();
      expect(errorOf(unchanged).code).toBe('STATUS_UNCHANGED');
      expect(active.status).toBe('ACTIVE');
    });

    it('records a departure, then re-admits into a chosen class', async () => {
      const student = await admit();
      const setStatus = (body: Record<string, unknown>) =>
        asAdmin('post', `/students/${student.id}/status`).send(body);

      const left = dataOf<StudentDetail>(
        await setStatus({
          status: 'TRANSFERRED',
          effectiveDate: '2026-06-01',
          reason: 'Family relocated',
        }).expect(200),
      );
      expect(left).toMatchObject({
        status: 'TRANSFERRED',
        leftOn: '2026-06-01',
        leavingReason: 'Family relocated',
        class: { name: 'Grade 7' },
      });
      expect(left.enrollments[0]?.endDate).toBe('2026-06-01');

      // Once gone, nothing but re-admission applies.
      const transfer = await asAdmin('post', `/students/${student.id}/transfer`).send({
        classId: grade8.id,
        streamId: stream(grade8, 'East'),
      });
      const again = await setStatus({ status: 'WITHDRAWN' });
      const suspend = await setStatus({ status: 'SUSPENDED' });
      const noClass = await setStatus({ status: 'ACTIVE' });
      expect(errorOf(transfer).code).toBe('STUDENT_HAS_LEFT');
      expect(errorOf(again).code).toBe('STUDENT_HAS_LEFT');
      expect(errorOf(suspend).code).toBe('READMIT_FIRST');
      expect(errorOf(noClass).code).toBe('CLASS_REQUIRED');

      const back = dataOf<StudentDetail>(
        await setStatus({
          status: 'ACTIVE',
          effectiveDate: '2026-09-01',
          classId: grade8.id,
          streamId: stream(grade8, 'East'),
        }).expect(200),
      );
      expect(back).toMatchObject({ status: 'ACTIVE', leftOn: null, leavingReason: null });
      expect(back.class?.name).toBe('Grade 8');
      expect(back.enrollments.map((e) => [e.reason, e.endDate])).toEqual([
        ['READMISSION', null],
        ['ADMISSION', '2026-06-01'],
      ]);
    });

    it('rejects effective dates in the future', async () => {
      const student = await admit();

      const response = await asAdmin('post', `/students/${student.id}/status`).send({
        status: 'WITHDRAWN',
        effectiveDate: '2999-01-01',
      });

      expect(errorOf(response).code).toBe('FUTURE_DATE');
    });
  });

  describe('guardians', () => {
    const father = { firstName: 'Daniel', lastName: 'Kamau', phone: '+254711000001' };

    it('links one guardian to siblings and keeps a single primary contact', async () => {
      const [older, younger] = await Promise.all([
        admit({ lastName: 'Kamau' }),
        admit({ lastName: 'Kamau', firstName: 'Faith' }),
      ]);
      const add = (studentId: string, body: Record<string, unknown>) =>
        asAdmin('post', `/students/${studentId}/guardians`).send(body);

      const withFather = dataOf<StudentDetail>(
        await add(older.id, { details: father, relationship: 'FATHER' }).expect(201),
      );
      const fatherId = withFather.guardians[0]?.guardianId as string;
      expect(withFather.guardians[0]?.isPrimary).toBe(true);

      const found = dataOf<{ id: string; students: string[] }[]>(
        await asAdmin('get', '/students/guardians?search=kamau').expect(200),
      );
      expect(found.find((g) => g.id === fatherId)?.students).toEqual(['Amina Kamau']);

      const sibling = dataOf<StudentDetail>(
        await add(younger.id, { guardianId: fatherId, relationship: 'FATHER' }).expect(201),
      );
      expect(sibling.guardians[0]?.guardianId).toBe(fatherId);
      expect(await ctx.prisma.guardian.count({ where: { phone: father.phone } })).toBe(1);

      const twice = await add(younger.id, { guardianId: fatherId, relationship: 'FATHER' });
      const both = await add(younger.id, {
        guardianId: fatherId,
        details: father,
        relationship: 'FATHER',
      });
      const neither = await add(younger.id, { relationship: 'FATHER' });
      expect(twice.status).toBe(409);
      expect(errorOf(both).code).toBe('GUARDIAN_INPUT');
      expect(errorOf(neither).code).toBe('GUARDIAN_INPUT');

      // A second guardian made primary takes over from the first.
      const withMother = dataOf<StudentDetail>(
        await add(older.id, {
          details: { firstName: 'Ruth', lastName: 'Kamau', phone: '+254711000002' },
          relationship: 'MOTHER',
          isPrimary: true,
        }).expect(201),
      );
      expect(withMother.guardians.map((g) => [g.firstName, g.isPrimary])).toEqual([
        ['Ruth', true],
        ['Daniel', false],
      ]);

      // Editing contact details changes them for both children.
      await asAdmin('patch', `/students/${older.id}/guardians/${fatherId}`)
        .send({ details: { ...father, phone: '+254711999999' } })
        .expect(200);
      const youngerNow = dataOf<StudentDetail>(
        await asAdmin('get', `/students/${younger.id}`).expect(200),
      );
      expect(youngerNow.guardians[0]?.phone).toBe('+254711999999');
    });

    it('promotes another guardian when the primary is removed, and tidies up orphans', async () => {
      const student = await admit({
        guardians: [
          { firstName: 'One', lastName: 'First', phone: '+254722000001', relationship: 'MOTHER' },
          { firstName: 'Two', lastName: 'Second', phone: '+254722000002', relationship: 'FATHER' },
        ],
      });
      const [primary, other] = student.guardians as [
        StudentDetail['guardians'][0],
        StudentDetail['guardians'][0],
      ];

      const afterRemoval = dataOf<StudentDetail>(
        await asAdmin('delete', `/students/${student.id}/guardians/${primary.guardianId}`).expect(
          200,
        ),
      );

      expect(afterRemoval.guardians).toEqual([
        expect.objectContaining({ guardianId: other.guardianId, isPrimary: true }),
      ]);
      expect(await ctx.prisma.guardian.count({ where: { id: primary.guardianId } })).toBe(0);
      await asAdmin('delete', `/students/${student.id}/guardians/${primary.guardianId}`).expect(
        404,
      );
    });
  });

  describe('promotion', () => {
    let year2027: AcademicYearView;
    let form1: ClassView;
    let east: StudentDetail;
    let west: StudentDetail;
    let repeater: StudentDetail;

    const promote = (body: Record<string, unknown>) =>
      asAdmin('post', '/students/promote').send(body);

    beforeAll(async () => {
      year2027 = dataOf<AcademicYearView>(
        await asAdmin('post', '/academic-years')
          .send({ name: '2027', startDate: '2027-01-04', endDate: '2027-11-19' })
          .expect(201),
      );
      form1 = await createClass('Form 1', 9, ['East', 'West']);
      [east, west, repeater] = await Promise.all([
        admit({ classId: form1.id, streamId: stream(form1, 'East'), firstName: 'Eve' }),
        admit({ classId: form1.id, streamId: stream(form1, 'West'), firstName: 'Wes' }),
        admit({ classId: form1.id, streamId: stream(form1, 'East'), firstName: 'Rita' }),
      ]);
    });

    it('moves students up a class, keeping the stream of the same name', async () => {
      const form2 = await createClass('Form 2', 10, ['East']);

      const result = dataOf<PromotionResult>(
        await promote({
          fromClassId: form1.id,
          toAcademicYearId: year2027.id,
          toClassId: form2.id,
          studentIds: [east.id, west.id],
        }).expect(200),
      );
      const [eastNow, westNow] = await Promise.all(
        [east.id, west.id].map(async (id) =>
          dataOf<StudentDetail>(await asAdmin('get', `/students/${id}`).expect(200)),
        ),
      );

      expect(result).toEqual({ promoted: 2, repeated: 0, graduated: 0 });
      expect(eastNow).toMatchObject({ class: { name: 'Form 2' }, stream: { name: 'East' } });
      // Form 2 has no West stream, so the student awaits placement.
      expect(westNow).toMatchObject({ class: { name: 'Form 2' }, stream: null });
      expect(
        eastNow?.enrollments.map((e) => [e.reason, e.academicYear.name, e.startDate, e.endDate]),
      ).toEqual([
        ['PROMOTION', '2027', '2027-01-04', null],
        ['ADMISSION', '2026', '2026-01-05', '2026-11-20'],
      ]);
    });

    it('refuses to promote the same students twice, or students who are not in the class', async () => {
      const twice = await promote({
        fromClassId: form1.id,
        toAcademicYearId: year2027.id,
        toClassId: grade8.id,
        studentIds: [east.id],
      });
      const fresh = await admit();
      const wrongClass = await promote({
        fromClassId: form1.id,
        toAcademicYearId: year2027.id,
        toClassId: grade8.id,
        studentIds: [fresh.id],
      });
      const sameYear = await promote({
        fromClassId: grade7.id,
        toAcademicYearId: year2026.id,
        toClassId: grade8.id,
        studentIds: [fresh.id],
      });

      // After promotion the student is in Form 2, so they no longer match "from Form 1".
      expect(twice.status).toBe(409);
      expect(errorOf(twice).code).toBe('NOT_IN_CLASS');
      expect(errorOf(wrongClass)).toMatchObject({
        code: 'NOT_IN_CLASS',
        details: { studentIds: [fresh.id] },
      });
      expect(errorOf(sameYear).code).toBe('ALREADY_IN_TARGET_YEAR');
      await promote({
        fromClassId: form1.id,
        toAcademicYearId: year2027.id,
        studentIds: ['00000000-0000-7000-8000-000000000000'],
      }).expect(400);
    });

    it('lets a student repeat the class', async () => {
      const result = dataOf<PromotionResult>(
        await promote({
          fromClassId: form1.id,
          toAcademicYearId: year2027.id,
          toClassId: form1.id,
          studentIds: [repeater.id],
        }).expect(200),
      );
      const now = dataOf<StudentDetail>(
        await asAdmin('get', `/students/${repeater.id}`).expect(200),
      );

      expect(result).toEqual({ promoted: 0, repeated: 1, graduated: 0 });
      expect(now).toMatchObject({
        status: 'ACTIVE',
        class: { name: 'Form 1' },
        stream: { name: 'East' },
      });
      expect(now.enrollments[0]).toMatchObject({
        reason: 'REPEAT',
        academicYear: { name: '2027' },
      });
    });

    it('graduates students when no next class is given', async () => {
      const leaver = await admit({ classId: grade8.id, streamId: stream(grade8, 'East') });

      const result = dataOf<PromotionResult>(
        await promote({
          fromClassId: grade8.id,
          toAcademicYearId: year2027.id,
          studentIds: [leaver.id],
        }).expect(200),
      );
      const now = dataOf<StudentDetail>(await asAdmin('get', `/students/${leaver.id}`).expect(200));

      expect(result).toEqual({ promoted: 0, repeated: 0, graduated: 1 });
      expect(now).toMatchObject({
        status: 'GRADUATED',
        leftOn: '2026-11-20',
        leavingReason: 'Graduated',
      });
      expect(now.enrollments.every((e) => e.endDate !== null)).toBe(true);
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'student.promoted', resourceId: leaver.id },
      });
      expect(audit.metadata).toMatchObject({ outcome: 'GRADUATED', toAcademicYear: '2027' });
    });
  });

  describe('bulk import and export', () => {
    const upload = (csv: string, { dryRun = false, name = 'students.csv', actor = admin } = {}) =>
      call(actor, 'post', `/students/import${dryRun ? '?dryRun=true' : ''}`).attach(
        'file',
        Buffer.from(csv),
        name,
      );
    const row = (number: string, first: string, extra = 'Grade 7,East,,,,') =>
      `${number},${first},,Imported,2013-05-05,F,,2026-01-05,${extra}`;

    it('checks a file without importing it, reporting every problem by line', async () => {
      const existing = await admit();
      const csv = [
        HEADER,
        row('IMP-OK-1', 'Good'),
        row(existing.admissionNumber, 'Taken'),
        row('IMP-BAD-1', 'NoClass', 'Grade 99,,,,,'),
        row('IMP-BAD-2', 'NoStream', 'Grade 7,North,,,,'),
        'IMP-BAD-3,BadDate,,Imported,05/05/2013,F,,2026-01-05,Grade 7,East,,,,',
      ].join('\n');
      const before = await ctx.prisma.student.count({ where: { tenantId: alpha.id } });

      const report = dataOf<ImportResult>(await upload(csv, { dryRun: true }).expect(200));
      const committed = dataOf<ImportResult>(await upload(csv).expect(200));

      expect(report).toMatchObject({ imported: false, valid: 1, problemsTruncated: false });
      expect(report.problems).toEqual([
        {
          row: 3,
          message: `A student with admission number "${existing.admissionNumber}" already exists.`,
        },
        {
          row: 4,
          message: 'Class "Grade 99" does not exist. Create it first or correct the name.',
        },
        { row: 5, message: 'Class "Grade 7" has no stream "North".' },
        { row: 6, message: 'date_of_birth must be a date in YYYY-MM-DD format.' },
      ]);
      // Without dryRun the result is the same: a file with problems imports nothing.
      expect(committed.imported).toBe(false);
      expect(await ctx.prisma.student.count({ where: { tenantId: alpha.id } })).toBe(before);
    });

    it('imports a clean file, sharing one guardian record between siblings', async () => {
      const tag = unique('IMP');
      const guardian = 'Grade 7,East,Samuel,Njoroge,+254733000001,father';
      const csv = [HEADER, row(`${tag}-1`, 'Ann', guardian), row(`${tag}-2`, 'Ben', guardian)].join(
        '\n',
      );

      const dry = dataOf<ImportResult>(await upload(csv, { dryRun: true }).expect(200));
      expect(dry).toMatchObject({ imported: false, valid: 2, problems: [] });
      expect(
        await ctx.prisma.student.count({ where: { admissionNumber: { startsWith: tag } } }),
      ).toBe(0);

      const result = dataOf<ImportResult>(await upload(csv).expect(200));
      const imported = await ctx.prisma.student.findMany({
        where: { admissionNumber: { startsWith: tag } },
        include: { guardians: true, enrollments: true },
        orderBy: { admissionNumber: 'asc' },
      });

      expect(result).toMatchObject({ imported: true, valid: 2, problems: [] });
      expect(imported.map((s) => s.firstName)).toEqual(['Ann', 'Ben']);
      expect(imported.every((s) => s.enrollments.length === 1 && s.guardians[0]?.isPrimary)).toBe(
        true,
      );
      expect(new Set(imported.map((s) => s.guardians[0]?.guardianId)).size).toBe(1);
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'students.imported', tenantId: alpha.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit.metadata).toMatchObject({ count: 2, academicYear: '2026' });
    });

    it('rejects missing files, other file types and oversized uploads', async () => {
      const none = await asAdmin('post', '/students/import');
      const spreadsheet = await upload('PK\u0003\u0004 not really a csv', {
        name: 'students.xlsx',
      });
      const binary = await upload(`${HEADER}\n\u0000\u0001\u0002`, { name: 'students.csv' });
      const huge = await upload(`${HEADER}\n${'x'.repeat(1_100_000)}`);

      expect(errorOf(none).code).toBe('FILE_REQUIRED');
      expect(errorOf(spreadsheet).code).toBe('UNSUPPORTED_FILE');
      expect(errorOf(binary).code).toBe('UNSUPPORTED_FILE');
      expect(huge.status).toBe(413);
      await upload(`${HEADER}\n${row('T-1', 'Nope')}`, { actor: teacher }).expect(403);
    });

    it('exports the filtered directory as CSV and audits the export', async () => {
      await admit({ firstName: '=HYPERLINK("http://evil.example")', lastName: 'Formula' });

      const response = await asAdmin('get', '/students/export?search=Formula').expect(200);
      const text = response.text.replace('\uFEFF', '');
      const [header, ...rows] = text.trim().split('\r\n');

      expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(response.headers['content-disposition']).toMatch(
        /^attachment; filename="students-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      expect(response.text.startsWith('\uFEFF')).toBe(true);
      expect(header).toMatch(/^Admission number,First name,Middle name,Last name,/);
      expect(rows).toHaveLength(1);
      // A leading "=" would run as a formula in a spreadsheet; it is neutralised.
      expect(rows[0]).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'students.exported', actorId: alpha.admin.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit.metadata).toMatchObject({ count: 1, filters: { search: 'Formula' } });
    });
  });

  describe('teachers', () => {
    let profile: TeacherDetail;
    const createTeacher = (overrides: Record<string, unknown> = {}) =>
      asAdmin('post', '/teachers').send({
        staffNumber: unique('T'),
        firstName: 'Tom',
        lastName: 'Mutua',
        ...overrides,
      });
    const assign = (teacherId: string, body: Record<string, unknown>) =>
      asAdmin('post', `/teachers/${teacherId}/assignments`).send(body);

    it('registers a teacher and links their login account once', async () => {
      const linkable = dataOf<{ id: string }[]>(
        await asAdmin('get', '/teachers/linkable-users').expect(200),
      );
      expect(linkable.map((user) => user.id)).toContain(teacherUser.id);

      profile = dataOf<TeacherDetail>(
        await createTeacher({
          staffNumber: 'T-001',
          phone: '+254 700 555 000',
          registrationNumber: 'TSC/123456',
          employmentDate: '2022-01-10',
          userId: teacherUser.id,
        }).expect(201),
      );

      expect(profile).toMatchObject({
        staffNumber: 'T-001',
        status: 'ACTIVE',
        employmentDate: '2022-01-10',
        user: { id: teacherUser.id, email: teacherUser.email },
        assignments: [],
      });
      const after = dataOf<{ id: string }[]>(
        await asAdmin('get', '/teachers/linkable-users').expect(200),
      );
      expect(after.map((user) => user.id)).not.toContain(teacherUser.id);
    });

    it('rejects duplicate staff numbers, double links and accounts from other tenants', async () => {
      const sameNumber = await createTeacher({ staffNumber: 'T-001' });
      const sameAccount = await createTeacher({ userId: teacherUser.id });
      const foreignAccount = await createTeacher({ userId: beta.admin.id });

      expect(sameNumber.status).toBe(409);
      expect(sameAccount.status).toBe(409);
      expect(errorOf(foreignAccount).code).toBe('UNKNOWN_USER');
    });

    it('assigns subjects and class-teacher duties with sensible checks', async () => {
      const english = dataOf<SubjectView>(
        await asAdmin('post', '/subjects').send({ name: 'English', code: 'ENG' }).expect(201),
      );
      const east7 = stream(grade7, 'East');

      const withSubject = dataOf<TeacherDetail>(
        await assign(profile.id, {
          kind: 'SUBJECT_TEACHER',
          classId: grade7.id,
          streamId: east7,
          subjectId: maths.id,
        }).expect(201),
      );
      expect(withSubject.assignments).toEqual([
        expect.objectContaining({
          kind: 'SUBJECT_TEACHER',
          academicYear: expect.objectContaining({ name: '2026', isCurrent: true }) as unknown,
          class: { id: grade7.id, name: 'Grade 7' },
          stream: expect.objectContaining({ name: 'East' }) as unknown,
          subject: expect.objectContaining({ code: 'MAT' }) as unknown,
        }),
      ]);

      const duplicate = await assign(profile.id, {
        kind: 'SUBJECT_TEACHER',
        classId: grade7.id,
        streamId: east7,
        subjectId: maths.id,
      });
      const notTaught = await assign(profile.id, {
        kind: 'SUBJECT_TEACHER',
        classId: grade7.id,
        subjectId: english.id,
      });
      const noSubject = await assign(profile.id, { kind: 'SUBJECT_TEACHER', classId: grade7.id });
      const wrongStream = await assign(profile.id, {
        kind: 'CLASS_TEACHER',
        classId: grade8.id,
        streamId: east7,
      });
      expect(duplicate.status).toBe(409);
      expect(errorOf(notTaught).code).toBe('SUBJECT_NOT_TAUGHT');
      expect(errorOf(noSubject).code).toBe('SUBJECT_REQUIRED');
      expect(errorOf(wrongStream).code).toBe('UNKNOWN_STREAM');

      // One class teacher per stream per year.
      await assign(profile.id, {
        kind: 'CLASS_TEACHER',
        classId: grade7.id,
        streamId: east7,
      }).expect(201);
      const colleague = dataOf<TeacherDetail>(
        await createTeacher({ firstName: 'Jane' }).expect(201),
      );
      const second = await assign(colleague.id, {
        kind: 'CLASS_TEACHER',
        classId: grade7.id,
        streamId: east7,
      });
      expect(second.status).toBe(409);
      expect(errorOf(second).message).toMatch(/already has a class teacher/);
    });

    it('reports workload for the academic year', async () => {
      const workload = dataOf<Workload>(await asAdmin('get', '/teachers/workload').expect(200));
      const mine = workload.rows.find((entry) => entry.teacher.id === profile.id);

      expect(workload.academicYear?.name).toBe('2026');
      expect(mine).toMatchObject({
        teacher: { name: 'Tom Mutua', staffNumber: 'T-001' },
        teachingAssignments: 1,
        subjects: ['Mathematics'],
        classes: ['Grade 7 East'],
        classTeacherOf: ['Grade 7 East'],
      });
    });

    it('shows a teacher their own profile and searches the staff directory', async () => {
      const own = dataOf<TeacherDetail | null>(
        await call(teacher, 'get', '/teachers/me').expect(200),
      );
      const adminOwn = dataOf<TeacherDetail | null>(
        await asAdmin('get', '/teachers/me').expect(200),
      );
      const found = dataOf<Paginated<TeacherSummary>>(
        await asAdmin('get', '/teachers?search=mutua%20tom&status=ACTIVE').expect(200),
      );

      expect(own?.id).toBe(profile.id);
      expect(own?.assignments).toHaveLength(2);
      expect(adminOwn).toBeNull();
      expect(found.items.map((entry) => entry.id)).toEqual([profile.id]);
      await call(teacher, 'post', '/teachers')
        .send({ staffNumber: 'X', firstName: 'A', lastName: 'B' })
        .expect(403);
    });

    it('removes assignments and blocks new ones for inactive staff', async () => {
      const extra = dataOf<TeacherDetail>(await createTeacher({ firstName: 'Temp' }).expect(201));
      const assigned = dataOf<TeacherDetail>(
        await assign(extra.id, {
          kind: 'SUBJECT_TEACHER',
          classId: grade7.id,
          subjectId: maths.id,
        }).expect(201),
      );
      const assignmentId = assigned.assignments[0]?.id as string;

      const removed = await asAdmin(
        'delete',
        `/teachers/${extra.id}/assignments/${assignmentId}`,
      ).expect(200);
      expect(dataOf<TeacherDetail>(removed).assignments).toEqual([]);
      await asAdmin('delete', `/teachers/${extra.id}/assignments/${assignmentId}`).expect(404);

      await asAdmin('patch', `/teachers/${extra.id}`).send({ status: 'INACTIVE' }).expect(200);
      const blocked = await assign(extra.id, {
        kind: 'SUBJECT_TEACHER',
        classId: grade7.id,
        subjectId: maths.id,
      });
      expect(errorOf(blocked).code).toBe('TEACHER_INACTIVE');
    });
  });

  describe('what a teacher can see', () => {
    let inEast: StudentDetail;
    let inWest: StudentDetail;
    let inGrade8: StudentDetail;

    beforeAll(async () => {
      [inEast, inWest, inGrade8] = await Promise.all([
        admit({ firstName: 'Scope', lastName: 'Eastwood' }),
        admit({ firstName: 'Scope', lastName: 'Westbrook', streamId: stream(grade7, 'West') }),
        admit({
          firstName: 'Scope',
          lastName: 'Eighth',
          classId: grade8.id,
          streamId: stream(grade8, 'East'),
        }),
      ]);
    });

    it('lists only the students of the streams they are assigned to', async () => {
      const mine = await directory(teacher, '&search=Scope');
      const everyone = await directory(admin, '&search=Scope');

      expect(mine.items.map((s) => s.lastName)).toEqual(['Eastwood']);
      expect(mine.total).toBe(1);
      expect(everyone.total).toBe(3);
      // Filtering by another class does not widen the scope.
      expect((await directory(teacher, `&classId=${grade8.id}`)).total).toBe(0);
    });

    it('answers "not found" for students outside their classes', async () => {
      await call(teacher, 'get', `/students/${inEast.id}`).expect(200);

      for (const outside of [inWest, inGrade8]) {
        const response = await call(teacher, 'get', `/students/${outside.id}`);
        expect(response.status).toBe(404);
        expect(errorOf(response).code).toBe('STUDENT_NOT_FOUND');
      }
    });

    it('exports only their own students and cannot change records', async () => {
      const csv = (await call(teacher, 'get', '/students/export?search=Scope').expect(200)).text;

      expect(csv).toContain('Eastwood');
      expect(csv).not.toContain('Westbrook');
      expect(csv).not.toContain('Eighth');
      await call(teacher, 'post', '/students').send(newStudent()).expect(403);
      await call(teacher, 'patch', `/students/${inEast.id}`)
        .send({ firstName: 'Changed' })
        .expect(403);
      await call(teacher, 'post', `/students/${inEast.id}/status`)
        .send({ status: 'WITHDRAWN' })
        .expect(403);
      await call(teacher, 'get', '/students/guardians?search=ot').expect(403);
    });

    it('follows assignments as they change', async () => {
      const me = dataOf<TeacherDetail>(await call(teacher, 'get', '/teachers/me').expect(200));

      // A whole-class assignment covers every stream of that class.
      await asAdmin('post', `/teachers/${me.id}/assignments`)
        .send({ kind: 'CLASS_TEACHER', classId: grade8.id })
        .expect(201);
      expect((await directory(teacher, '&search=Scope')).items.map((s) => s.lastName)).toEqual([
        'Eastwood',
        'Eighth',
      ]);

      // A student transferred out of their stream disappears from their list.
      await asAdmin('post', `/students/${inEast.id}/transfer`)
        .send({ classId: grade7.id, streamId: stream(grade7, 'West') })
        .expect(200);
      expect((await directory(teacher, '&search=Scope')).items.map((s) => s.lastName)).toEqual([
        'Eighth',
      ]);
      await call(teacher, 'get', `/students/${inEast.id}`).expect(404);
    });

    it('shows nothing to a teacher account with no staff profile or an inactive one', async () => {
      const unlinkedUser = await seedUser(ctx, { tenantId: alpha.id, roles: ['TEACHER'] });
      const unlinked = await signIn(ctx, unlinkedUser);
      expect((await directory(unlinked)).total).toBe(0);

      const me = dataOf<TeacherDetail>(await call(teacher, 'get', '/teachers/me').expect(200));
      await asAdmin('patch', `/teachers/${me.id}`).send({ status: 'INACTIVE' }).expect(200);
      expect((await directory(teacher)).total).toBe(0);

      await asAdmin('patch', `/teachers/${me.id}`).send({ status: 'ACTIVE' }).expect(200);
      expect((await directory(teacher)).total).toBeGreaterThan(0);
    });

    it('does not restrict staff who work across all classes', async () => {
      const officerUser = await seedUser(ctx, { tenantId: alpha.id, roles: ['EXAM_OFFICER'] });
      const officer = await signIn(ctx, officerUser);

      expect((await directory(officer, '&search=Scope')).total).toBe(3);
    });
  });

  describe('isolation', () => {
    it('keeps one tenant’s people out of another tenant’s reach', async () => {
      const student = await admit({
        guardians: [
          { firstName: 'Iso', lastName: 'Lated', phone: '+254744000001', relationship: 'MOTHER' },
        ],
      });
      const guardianId = student.guardians[0]?.guardianId as string;
      const staff = dataOf<Paginated<TeacherSummary>>(
        await asAdmin('get', '/teachers').expect(200),
      );
      const teacherId = staff.items[0]?.id as string;

      expect((await directory(betaAdmin)).total).toBe(0);
      expect(
        dataOf<Paginated<TeacherSummary>>(await call(betaAdmin, 'get', '/teachers').expect(200))
          .total,
      ).toBe(0);
      await call(betaAdmin, 'get', `/students/${student.id}`).expect(404);
      await call(betaAdmin, 'patch', `/students/${student.id}`)
        .send({ firstName: 'Taken' })
        .expect(404);
      await call(betaAdmin, 'post', `/students/${student.id}/status`)
        .send({ status: 'WITHDRAWN' })
        .expect(404);
      await call(betaAdmin, 'get', `/teachers/${teacherId}`).expect(404);
      await call(betaAdmin, 'post', `/teachers/${teacherId}/assignments`)
        .send({ kind: 'CLASS_TEACHER', classId: grade7.id })
        .expect(404);
      expect(
        dataOf<unknown[]>(
          await call(betaAdmin, 'get', '/students/guardians?search=Lated').expect(200),
        ),
      ).toEqual([]);

      // Beta sets itself up, then tries to borrow alpha's class and guardian.
      await call(betaAdmin, 'post', '/academic-years')
        .send({ name: '2026', startDate: '2026-01-05', endDate: '2026-11-20' })
        .expect(201);
      const borrowClass = await call(betaAdmin, 'post', '/students').send(newStudent());
      expect(errorOf(borrowClass).code).toBe('UNKNOWN_CLASS');

      const betaClass = dataOf<ClassView>(
        await call(betaAdmin, 'post', '/classes').send({ name: 'Grade 1', level: 1 }).expect(201),
      );
      const betaStudent = dataOf<StudentDetail>(
        await call(betaAdmin, 'post', '/students')
          .send(newStudent({ classId: betaClass.id, streamId: null }))
          .expect(201),
      );
      const borrowGuardian = await call(
        betaAdmin,
        'post',
        `/students/${betaStudent.id}/guardians`,
      ).send({
        guardianId,
        relationship: 'MOTHER',
      });
      expect(errorOf(borrowGuardian).code).toBe('UNKNOWN_GUARDIAN');
    });

    it('never lets a tenant delete student or enrolment records', async () => {
      for (const model of ['student', 'enrollment'] as const) {
        const attempt = ctx.prisma.withTenant(alpha.id, (tx) =>
          model === 'student' ? tx.student.deleteMany() : tx.enrollment.deleteMany(),
        );
        await expect(attempt).rejects.toThrow();
      }
      expect(await ctx.prisma.student.count({ where: { tenantId: alpha.id } })).toBeGreaterThan(0);
    });
  });
});
