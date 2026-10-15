import type { AuditLogView } from '../src/modules/audit/audit.service.js';
import type { ClassView } from '../src/modules/classes/classes.service.js';
import type { SchoolView } from '../src/modules/schools/schools.service.js';
import type { DocumentView } from '../src/modules/students/student-files.service.js';
import type { StudentDetail } from '../src/modules/students/students.service.js';
import type { TeacherDetail } from '../src/modules/teachers/teachers.service.js';
import { StorageService } from '../src/storage/storage.service.js';
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

type Method = 'get' | 'post' | 'put' | 'delete';

// The smallest files that are genuinely of each type by their leading bytes.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-png-body-for-tests'),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake-jpeg-body')]);
const PDF = Buffer.from('%PDF-1.7\nfake pdf body for tests\n%%EOF');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('File storage (e2e, real object storage)', () => {
  let ctx: TestContext;
  let storage: StorageService;
  let alpha: SeededTenant;
  let beta: SeededTenant;
  let admin: SignedIn;
  let betaAdmin: SignedIn;
  let teacher: SignedIn;
  let outsider: SignedIn;
  let student: StudentDetail;

  const call = (actor: SignedIn, method: Method, path: string) =>
    ctx.http()[method](`/api/v1${path}`).set('Authorization', actor.bearer);
  const asAdmin = (method: Method, path: string) => call(admin, method, path);
  const upload = (
    actor: SignedIn,
    method: 'put' | 'post',
    path: string,
    file: Buffer,
    name: string,
  ) => call(actor, method, path).attach('file', file, name);

  /** Reads a stored object back, or returns null if it no longer exists. */
  async function stored(key: string | null | undefined): Promise<Buffer | null> {
    if (!key) return null;
    try {
      const { body } = await storage.get(key);
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }
  const photoKey = async (id: string) =>
    (await ctx.prisma.student.findUniqueOrThrow({ where: { id }, select: { photoKey: true } }))
      .photoKey;

  beforeAll(async () => {
    ctx = await createTestApp();
    storage = ctx.app.get(StorageService);
    [alpha, beta] = await Promise.all([seedTenant(ctx), seedTenant(ctx)]);
    const [teacherUser, outsiderUser] = await Promise.all([
      seedUser(ctx, { tenantId: alpha.id, roles: ['TEACHER'] }),
      seedUser(ctx, { tenantId: alpha.id, roles: ['TEACHER'] }),
    ]);
    [admin, betaAdmin, teacher, outsider] = await Promise.all([
      signIn(ctx, alpha.admin),
      signIn(ctx, beta.admin),
      signIn(ctx, teacherUser),
      signIn(ctx, outsiderUser),
    ]);

    await asAdmin('post', '/academic-years')
      .send({ name: '2026', startDate: '2026-01-05', endDate: '2026-11-20' })
      .expect(201);
    const grade7 = dataOf<ClassView>(
      await asAdmin('post', '/classes').send({ name: 'Grade 7', level: 7 }).expect(201),
    );
    student = dataOf<StudentDetail>(
      await asAdmin('post', '/students')
        .send({
          admissionNumber: unique('F'),
          firstName: 'Amina',
          lastName: 'Otieno',
          dateOfBirth: '2013-04-17',
          gender: 'FEMALE',
          admissionDate: '2026-01-05',
          classId: grade7.id,
        })
        .expect(201),
    );
    // `teacher` is assigned to the student's class; `outsider` is not.
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
      .send({ kind: 'CLASS_TEACHER', classId: grade7.id })
      .expect(201);
    await asAdmin('post', '/teachers')
      .send({
        staffNumber: unique('T'),
        firstName: 'Out',
        lastName: 'Sider',
        userId: outsiderUser.id,
      })
      .expect(201);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('student photographs', () => {
    const path = () => `/students/${student.id}/photo`;

    it('stores a photo privately and serves it back through the API', async () => {
      expect(student.hasPhoto).toBe(false);
      await asAdmin('get', path()).expect(404);

      await upload(admin, 'put', path(), PNG, 'me.png').expect(204);

      const key = await photoKey(student.id);
      expect(key).toMatch(new RegExp(`^tenants/${alpha.id}/students/[0-9a-f-]{36}\\.png$`));
      expect(await stored(key)).toEqual(PNG);

      const response = await asAdmin('get', path())
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });
      expect(response.status).toBe(200);
      expect(response.body).toEqual(PNG);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['cache-control']).toBe('private, max-age=300');
      expect(response.headers['x-content-type-options']).toBe('nosniff');

      const detail = dataOf<StudentDetail>(
        await asAdmin('get', `/students/${student.id}`).expect(200),
      );
      expect(detail.hasPhoto).toBe(true);
      expect(JSON.stringify(detail)).not.toContain(key);
    });

    it('trusts the content, not the file name, and removes the old file on replace', async () => {
      const before = await photoKey(student.id);

      // A JPEG uploaded under a .png name is stored as what it really is.
      await upload(admin, 'put', path(), JPEG, 'still-called.png').expect(204);

      const after = await photoKey(student.id);
      expect(after).toMatch(/\.jpg$/);
      expect((await asAdmin('get', path())).headers['content-type']).toBe('image/jpeg');
      expect(await stored(before)).toBeNull();
    });

    it('rejects scripts, documents, empty and oversized uploads, keeping the current photo', async () => {
      const current = await photoKey(student.id);

      const svg = await upload(admin, 'put', path(), SVG, 'photo.png');
      const pdf = await upload(admin, 'put', path(), PDF, 'photo.jpg');
      const none = await asAdmin('put', path());
      const huge = await upload(
        admin,
        'put',
        path(),
        Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]),
        'big.jpg',
      );

      expect(errorOf(svg).code).toBe('UNSUPPORTED_FILE');
      expect(errorOf(pdf).code).toBe('UNSUPPORTED_FILE');
      expect(errorOf(none).code).toBe('FILE_REQUIRED');
      expect(huge.status).toBe(413);
      expect(await photoKey(student.id)).toBe(current);
      expect(await stored(current)).toEqual(JPEG);
    });

    it('follows the same class scope as the student record', async () => {
      await call(teacher, 'get', path()).expect(200);
      await call(outsider, 'get', path()).expect(404);
      await ctx.http().get(`/api/v1${path()}`).expect(401);
      await upload(teacher, 'put', path(), PNG, 'me.png').expect(403);
      await call(teacher, 'delete', path()).expect(403);
    });

    it('removes the photo from storage when it is deleted', async () => {
      const key = await photoKey(student.id);

      await asAdmin('delete', path()).expect(204);

      expect(await photoKey(student.id)).toBeNull();
      expect(await stored(key)).toBeNull();
      await asAdmin('get', path()).expect(404);
      await asAdmin('delete', path()).expect(204);
    });
  });

  describe('student documents', () => {
    const path = (suffix = '') => `/students/${student.id}/documents${suffix}`;
    const add = (file: Buffer, name: string, fields: Record<string, string> = {}) =>
      asAdmin('post', path())
        .field({ title: 'Birth certificate', category: 'BIRTH_CERTIFICATE', ...fields })
        .attach('file', file, name);

    it('uploads, lists, downloads and deletes a document', async () => {
      const created = dataOf<DocumentView>(
        await add(PDF, 'Birth Certificate (scan).PDF').expect(201),
      );

      expect(created).toMatchObject({
        title: 'Birth certificate',
        category: 'BIRTH_CERTIFICATE',
        fileName: 'Birth Certificate scan.pdf',
        contentType: 'application/pdf',
        sizeBytes: PDF.length,
        uploadedBy: 'Test SCHOOL_ADMIN',
      });
      expect(JSON.stringify(created)).not.toMatch(/storageKey|tenants\//);
      const row = await ctx.prisma.studentDocument.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.storageKey).toMatch(
        new RegExp(`^tenants/${alpha.id}/documents/[0-9a-f-]{36}\\.pdf$`),
      );

      const listed = dataOf<DocumentView[]>(await asAdmin('get', path()).expect(200));
      expect(listed.map((document) => document.id)).toEqual([created.id]);

      const download = await asAdmin('get', path(`/${created.id}/download`))
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });
      expect(download.status).toBe(200);
      expect(download.body).toEqual(PDF);
      expect(download.headers['content-type']).toBe('application/pdf');
      expect(download.headers['cache-control']).toBe('no-store');
      // Always a download, never rendered in the application's origin.
      expect(download.headers['content-disposition']).toMatch(
        /^attachment; filename="Birth Certificate scan\.pdf"; filename\*=UTF-8''/,
      );

      await asAdmin('delete', path(`/${created.id}`)).expect(204);
      expect(await stored(row.storageKey)).toBeNull();
      await asAdmin('get', path(`/${created.id}/download`)).expect(404);
      await asAdmin('delete', path(`/${created.id}`)).expect(404);
    });

    it('audits uploads, downloads and deletions', async () => {
      const created = dataOf<DocumentView>(
        await add(PDF, 'medical.pdf', { title: 'Allergy note', category: 'MEDICAL' }).expect(201),
      );
      await asAdmin('get', path(`/${created.id}/download`)).expect(200);
      await asAdmin('delete', path(`/${created.id}`)).expect(204);

      const log = dataOf<{ items: AuditLogView[] }>(
        await asAdmin('get', '/audit-logs?action=student.document&pageSize=100').expect(200),
      );
      const mine = log.items.filter(
        (entry) => (entry.details as { documentId?: string })?.documentId === created.id,
      );

      expect(mine.map((entry) => entry.action).sort()).toEqual([
        'student.document.deleted',
        'student.document.downloaded',
        'student.document.uploaded',
      ]);
      expect(mine.every((entry) => entry.actor?.email === alpha.admin.email)).toBe(true);
    });

    it('rejects unsupported content and invalid details, storing nothing', async () => {
      const before = await ctx.prisma.studentDocument.count({ where: { studentId: student.id } });

      const html = await add(Buffer.from('<!doctype html><script>alert(1)</script>'), 'page.pdf');
      const executable = await add(Buffer.from('MZ\u0090\u0000binary'), 'setup.pdf');
      const noTitle = await add(PDF, 'a.pdf', { title: '' });
      const badCategory = await add(PDF, 'a.pdf', { category: 'SECRET' });
      const noFile = await asAdmin('post', path()).field({ title: 'No file', category: 'OTHER' });
      const huge = await add(Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]), 'big.pdf');

      expect(errorOf(html).code).toBe('UNSUPPORTED_FILE');
      expect(errorOf(executable).code).toBe('UNSUPPORTED_FILE');
      expect(noTitle.status).toBe(400);
      expect(badCategory.status).toBe(400);
      expect(errorOf(noFile).code).toBe('FILE_REQUIRED');
      expect(huge.status).toBe(413);
      expect(await ctx.prisma.studentDocument.count({ where: { studentId: student.id } })).toBe(
        before,
      );
    });

    it('keeps documents from teachers, even for students in their own class', async () => {
      const created = dataOf<DocumentView>(await add(PDF, 'private.pdf').expect(201));

      // The teacher can see the student, but personal documents need more.
      await call(teacher, 'get', `/students/${student.id}`).expect(200);
      await call(teacher, 'get', path()).expect(403);
      await call(teacher, 'get', path(`/${created.id}/download`)).expect(403);
      await call(teacher, 'delete', path(`/${created.id}`)).expect(403);
      await call(teacher, 'post', path())
        .field({ title: 'Mine', category: 'OTHER' })
        .attach('file', PDF, 'mine.pdf')
        .expect(403);
    });
  });

  describe('school logo', () => {
    it('uploads, serves, replaces and removes the logo', async () => {
      const before = dataOf<SchoolView>(await asAdmin('get', '/school').expect(200));
      expect(before.hasLogo).toBe(false);
      await asAdmin('get', '/school/logo').expect(404);

      await upload(admin, 'put', '/school/logo', PNG, 'crest.png').expect(204);
      const first = (await ctx.prisma.school.findUniqueOrThrow({ where: { id: alpha.schoolId } }))
        .logoKey;
      expect(first).toMatch(new RegExp(`^tenants/${alpha.id}/school/`));

      const after = dataOf<SchoolView>(await asAdmin('get', '/school').expect(200));
      expect(after.hasLogo).toBe(true);
      expect(JSON.stringify(after)).not.toContain('tenants/');
      // Every member of the school can see its logo.
      expect((await call(teacher, 'get', '/school/logo').expect(200)).headers['content-type']).toBe(
        'image/png',
      );

      await upload(admin, 'put', '/school/logo', JPEG, 'crest.jpg').expect(204);
      expect(await stored(first)).toBeNull();

      const current = (await ctx.prisma.school.findUniqueOrThrow({ where: { id: alpha.schoolId } }))
        .logoKey;
      await asAdmin('delete', '/school/logo').expect(204);
      expect(await stored(current)).toBeNull();
      await asAdmin('get', '/school/logo').expect(404);
    });

    it('is managed only by those who manage settings, and accepts only images', async () => {
      await upload(teacher, 'put', '/school/logo', PNG, 'crest.png').expect(403);
      await call(teacher, 'delete', '/school/logo').expect(403);
      expect(errorOf(await upload(admin, 'put', '/school/logo', PDF, 'crest.png')).code).toBe(
        'UNSUPPORTED_FILE',
      );
      expect(errorOf(await upload(admin, 'put', '/school/logo', SVG, 'crest.svg')).code).toBe(
        'UNSUPPORTED_FILE',
      );
    });
  });

  describe('isolation', () => {
    it('never serves or accepts files across tenants', async () => {
      await upload(admin, 'put', `/students/${student.id}/photo`, PNG, 'me.png').expect(204);
      const document = dataOf<DocumentView>(
        await asAdmin('post', `/students/${student.id}/documents`)
          .field({ title: 'Report', category: 'OTHER' })
          .attach('file', PDF, 'report.pdf')
          .expect(201),
      );
      const base = `/students/${student.id}`;

      await call(betaAdmin, 'get', `${base}/photo`).expect(404);
      await upload(betaAdmin, 'put', `${base}/photo`, JPEG, 'swap.jpg').expect(404);
      await call(betaAdmin, 'delete', `${base}/photo`).expect(404);
      await call(betaAdmin, 'get', `${base}/documents`).expect(404);
      await call(betaAdmin, 'get', `${base}/documents/${document.id}/download`).expect(404);
      await call(betaAdmin, 'delete', `${base}/documents/${document.id}`).expect(404);
      await call(betaAdmin, 'post', `${base}/documents`)
        .field({ title: 'Planted', category: 'OTHER' })
        .attach('file', PDF, 'planted.pdf')
        .expect(404);

      // Nothing changed, and a rejected upload left nothing behind in storage.
      expect(await stored(await photoKey(student.id))).toEqual(PNG);
      expect(await ctx.prisma.studentDocument.count({ where: { id: document.id } })).toBe(1);
      expect(await ctx.prisma.studentDocument.count({ where: { title: 'Planted' } })).toBe(0);
    });

    it('hides document rows of other tenants at the database level', async () => {
      const visible = await ctx.prisma.withTenant(beta.id, (tx) => tx.studentDocument.count());
      const own = await ctx.prisma.withTenant(alpha.id, (tx) => tx.studentDocument.count());

      expect(visible).toBe(0);
      expect(own).toBeGreaterThan(0);
    });
  });
});
