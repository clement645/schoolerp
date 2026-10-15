import type { AcademicYearView } from '../src/modules/academics/academics.service.js';
import type { ClassView } from '../src/modules/classes/classes.service.js';
import type { AnnouncementView } from '../src/modules/communication/announcements.service.js';
import type {
  Correspondent,
  ThreadDetail,
  ThreadSummary,
} from '../src/modules/communication/messages.service.js';
import type { NotificationList } from '../src/modules/communication/notifications.service.js';
import type { SubjectView } from '../src/modules/subjects/subjects.service.js';
import type { TeacherDetail } from '../src/modules/teachers/teachers.service.js';
import type { SlotView } from '../src/modules/timetable/timetable.service.js';
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

type Method = 'get' | 'post' | 'put' | 'delete';

const iso = (offsetDays: number): string => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

describe('Communication and timetable (e2e)', () => {
  let ctx: TestContext;
  let alpha: SeededTenant;
  let beta: SeededTenant;
  let users: Record<
    'teacher' | 'colleague' | 'parent' | 'otherParent' | 'student' | 'betaTeacher',
    SeededUser
  >;
  let admin: SignedIn;
  let betaAdmin: SignedIn;
  let teacher: SignedIn;
  let colleague: SignedIn;
  let parent: SignedIn;
  let otherParent: SignedIn;
  let student: SignedIn;

  const call = (actor: SignedIn, method: Method, path: string) =>
    ctx.http()[method](`/api/v1${path}`).set('Authorization', actor.bearer);
  const asAdmin = (method: Method, path: string) => call(admin, method, path);
  const notificationsOf = async (actor: SignedIn, query = '') =>
    dataOf<NotificationList>(await call(actor, 'get', `/notifications${query}`).expect(200));
  const announcementsOf = async (actor: SignedIn) =>
    dataOf<AnnouncementView[]>(await call(actor, 'get', '/announcements').expect(200));
  const announce = (body: Record<string, unknown>, actor = admin) =>
    call(actor, 'post', '/announcements').send({
      title: 'Closing day',
      body: 'School closes at noon on Friday.',
      audience: 'EVERYONE',
      ...body,
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    [alpha, beta] = await Promise.all([seedTenant(ctx), seedTenant(ctx)]);
    const seed = (tenant: SeededTenant, role: 'TEACHER' | 'PARENT' | 'STUDENT') =>
      seedUser(ctx, { tenantId: tenant.id, roles: [role] });
    users = {
      teacher: await seed(alpha, 'TEACHER'),
      colleague: await seed(alpha, 'TEACHER'),
      parent: await seed(alpha, 'PARENT'),
      otherParent: await seed(alpha, 'PARENT'),
      student: await seed(alpha, 'STUDENT'),
      betaTeacher: await seed(beta, 'TEACHER'),
    };
    [admin, betaAdmin, teacher, colleague, parent, otherParent, student] = await Promise.all([
      signIn(ctx, alpha.admin),
      signIn(ctx, beta.admin),
      signIn(ctx, users.teacher),
      signIn(ctx, users.colleague),
      signIn(ctx, users.parent),
      signIn(ctx, users.otherParent),
      signIn(ctx, users.student),
    ]);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('announcements', () => {
    let forEveryone: AnnouncementView;

    it('publishes to an audience and notifies exactly those people', async () => {
      forEveryone = dataOf<AnnouncementView>(await announce({ isPinned: true }).expect(201));
      expect(forEveryone).toMatchObject({ audience: 'EVERYONE', isPinned: true, isExpired: false });
      for (const actor of [teacher, parent, student]) {
        const list = await notificationsOf(actor);
        expect(list).toMatchObject({ total: 1, unread: 1 });
        expect(list.items[0]).toMatchObject({
          kind: 'ANNOUNCEMENT',
          title: 'Closing day',
          link: '/announcements',
          isRead: false,
        });
      }
      // The author is not notified of their own announcement.
      expect((await notificationsOf(admin)).total).toBe(0);

      await announce({ title: 'Staff meeting', audience: 'STAFF' }).expect(201);
      await announce({ title: 'Fees reminder', audience: 'PARENTS' }).expect(201);
      expect((await notificationsOf(teacher)).total).toBe(2);
      expect((await notificationsOf(parent)).total).toBe(2);
      expect((await notificationsOf(student)).total).toBe(1);
    });

    it('shows each person only what is addressed to them', async () => {
      const titles = async (actor: SignedIn) =>
        (await announcementsOf(actor)).map((a) => a.title).sort();
      expect(await titles(teacher)).toEqual(['Closing day', 'Staff meeting']);
      expect(await titles(parent)).toEqual(['Closing day', 'Fees reminder']);
      expect(await titles(student)).toEqual(['Closing day']);
      expect(await titles(admin)).toEqual(['Closing day', 'Fees reminder', 'Staff meeting']);
      // Pinned first.
      expect((await announcementsOf(admin))[0]?.title).toBe('Closing day');
    });

    it('stops showing an announcement once it expires', async () => {
      await announce({ title: 'Old notice', expiresOn: iso(-1) }).expect(201);
      await announce({ title: 'Ends today', expiresOn: iso(0) }).expect(201);
      const seenByParent = (await announcementsOf(parent)).map((a) => a.title);
      expect(seenByParent).toContain('Ends today');
      expect(seenByParent).not.toContain('Old notice');
      const old = (await announcementsOf(admin)).find((a) => a.title === 'Old notice');
      expect(old?.isExpired).toBe(true);
    });

    it('keeps publishing to those who manage announcements, within their tenant', async () => {
      await announce({}, teacher).expect(403);
      await announce({}, parent).expect(403);
      await announce({ audience: 'ALUMNI' }).expect(400);
      await announce({ title: 'x' }).expect(400);
      await call(betaAdmin, 'put', `/announcements/${forEveryone.id}`)
        .send({ title: 'Hijacked', body: 'Not yours', audience: 'EVERYONE' })
        .expect(404);
      await call(betaAdmin, 'delete', `/announcements/${forEveryone.id}`).expect(404);
      expect(await announcementsOf(betaAdmin)).toEqual([]);

      const edited = dataOf<AnnouncementView>(
        await asAdmin('put', `/announcements/${forEveryone.id}`)
          .send({
            title: 'Closing day (updated)',
            body: 'School closes at 1pm.',
            audience: 'EVERYONE',
          })
          .expect(200),
      );
      expect(edited).toMatchObject({ title: 'Closing day (updated)', isPinned: false });
      const extra = dataOf<AnnouncementView>(await announce({ title: 'Mistake' }).expect(201));
      await asAdmin('delete', `/announcements/${extra.id}`).expect(204);
      await asAdmin('delete', `/announcements/${extra.id}`).expect(404);
    });
  });

  describe('notifications', () => {
    it('are private to their recipient', async () => {
      const mine = await notificationsOf(parent);
      const first = mine.items[0]?.id as string;

      // Somebody else's notification does not exist for the caller.
      await call(teacher, 'post', `/notifications/${first}/read`).expect(404);
      await call(betaAdmin, 'post', `/notifications/${first}/read`).expect(404);
      expect((await notificationsOf(parent)).unread).toBe(mine.unread);

      await call(parent, 'post', `/notifications/${first}/read`).expect(204);
      const after = await notificationsOf(parent);
      expect(after.unread).toBe(mine.unread - 1);
      expect(after.items.find((item) => item.id === first)?.isRead).toBe(true);
      expect((await notificationsOf(parent, '?unreadOnly=true')).total).toBe(mine.unread - 1);
    });

    it('marks everything read at once, for the caller only', async () => {
      const before = (await notificationsOf(teacher)).unread;
      const result = dataOf<{ updated: number }>(
        await call(parent, 'post', '/notifications/read-all').expect(200),
      );
      expect(result.updated).toBeGreaterThan(0);
      expect((await notificationsOf(parent)).unread).toBe(0);
      expect((await notificationsOf(teacher)).unread).toBe(before);
      await ctx.http().get('/api/v1/notifications').expect(401);
      await call(parent, 'get', '/notifications?pageSize=1000').expect(400);
    });
  });

  describe('messages', () => {
    let thread: ThreadDetail;

    it('lets staff write to a parent, who is notified', async () => {
      thread = dataOf<ThreadDetail>(
        await call(teacher, 'post', '/messages/threads')
          .send({
            recipientIds: [users.parent.id],
            subject: 'Homework',
            body: 'Amina has not handed in her homework.',
          })
          .expect(201),
      );
      expect(thread.participants.map((p) => p.id).sort()).toEqual(
        [users.parent.id, users.teacher.id].sort(),
      );
      expect(thread.messages).toMatchObject([
        { body: 'Amina has not handed in her homework.', isMine: true },
      ]);

      const inbox = dataOf<ThreadSummary[]>(
        await call(parent, 'get', '/messages/threads').expect(200),
      );
      expect(inbox).toMatchObject([{ id: thread.id, subject: 'Homework', hasUnread: true }]);
      expect(inbox[0]?.participants.map((p) => p.id)).toEqual([users.teacher.id]);
      const notice = (await notificationsOf(parent, '?unreadOnly=true')).items[0];
      expect(notice).toMatchObject({ kind: 'MESSAGE', link: `/messages?thread=${thread.id}` });
      expect(notice?.title).toContain('Homework');
    });

    it('marks a conversation read when opened, and carries replies', async () => {
      const opened = dataOf<ThreadDetail>(
        await call(parent, 'get', `/messages/threads/${thread.id}`).expect(200),
      );
      expect(opened.messages[0]?.isMine).toBe(false);
      const inbox = dataOf<ThreadSummary[]>(
        await call(parent, 'get', '/messages/threads').expect(200),
      );
      expect(inbox[0]?.hasUnread).toBe(false);

      const replied = dataOf<ThreadDetail>(
        await call(parent, 'post', `/messages/threads/${thread.id}/messages`)
          .send({ body: 'She will bring it tomorrow.' })
          .expect(201),
      );
      expect(replied.messages).toHaveLength(2);
      const teachers = dataOf<ThreadSummary[]>(
        await call(teacher, 'get', '/messages/threads').expect(200),
      );
      expect(teachers[0]).toMatchObject({
        hasUnread: true,
        lastMessage: { body: 'She will bring it tomorrow.' },
      });
      await call(parent, 'post', `/messages/threads/${thread.id}/messages`)
        .send({ body: '   ' })
        .expect(400);
    });

    it('is closed to everyone who is not in the conversation', async () => {
      for (const outsider of [colleague, otherParent, admin, betaAdmin]) {
        const read = await call(outsider, 'get', `/messages/threads/${thread.id}`).expect(404);
        expect(errorOf(read).code).toBe('THREAD_NOT_FOUND');
        await call(outsider, 'post', `/messages/threads/${thread.id}/messages`)
          .send({ body: 'Let me in' })
          .expect(404);
        const inbox = dataOf<ThreadSummary[]>(
          await call(outsider, 'get', '/messages/threads').expect(200),
        );
        expect(inbox.some((entry) => entry.id === thread.id)).toBe(false);
      }
      // Nothing an outsider tried was added.
      const intact = dataOf<ThreadDetail>(
        await call(teacher, 'get', `/messages/threads/${thread.id}`).expect(200),
      );
      expect(intact.messages).toHaveLength(2);
    });

    it('lets parents write to staff only', async () => {
      const toParent = await call(parent, 'post', '/messages/threads')
        .send({ recipientIds: [users.otherParent.id], subject: 'Hello', body: 'Hi there' })
        .expect(403);
      expect(errorOf(toParent).code).toBe('RECIPIENT_NOT_ALLOWED');
      // A mixed list is refused as a whole.
      await call(parent, 'post', '/messages/threads')
        .send({ recipientIds: [users.teacher.id, users.student.id], subject: 'Hello', body: 'Hi' })
        .expect(403);

      const offered = dataOf<Correspondent[]>(
        await call(parent, 'get', '/messages/recipients').expect(200),
      );
      const ids = offered.map((person) => person.id);
      expect(ids).toEqual(expect.arrayContaining([users.teacher.id, users.colleague.id]));
      expect(ids).not.toContain(users.otherParent.id);
      expect(ids).not.toContain(users.student.id);
      expect(ids).not.toContain(users.parent.id);

      await call(parent, 'post', '/messages/threads')
        .send({
          recipientIds: [users.colleague.id],
          subject: 'Transport',
          body: 'Is the bus running?',
        })
        .expect(201);
    });

    it('cannot reach people outside the school account, and needs permission', async () => {
      const foreign = await call(teacher, 'post', '/messages/threads')
        .send({ recipientIds: [users.betaTeacher.id], subject: 'Hello', body: 'Hi' })
        .expect(422);
      expect(errorOf(foreign).code).toBe('RECIPIENT_NOT_FOUND');
      await call(teacher, 'post', '/messages/threads')
        .send({ recipientIds: [users.teacher.id], subject: 'Note to self', body: 'Hi' })
        .expect(422);
      // Students have no messaging.
      await call(student, 'get', '/messages/threads').expect(403);
      await call(student, 'post', '/messages/threads')
        .send({ recipientIds: [users.teacher.id], subject: 'Hello', body: 'Hi' })
        .expect(403);
      const search = dataOf<Correspondent[]>(
        await call(teacher, 'get', '/messages/recipients?search=zzzz').expect(200),
      );
      expect(search).toEqual([]);
    });
  });

  describe('timetable', () => {
    let grade7: ClassView;
    let maths: SubjectView;
    let english: SubjectView;
    let tom: TeacherDetail;
    let wendy: TeacherDetail;
    let first: SlotView;

    const stream = (name: string) => grade7.streams.find((s) => s.name === name)?.id as string;
    const lesson = (overrides: Record<string, unknown> = {}) => ({
      classId: grade7.id,
      dayOfWeek: 1,
      startTime: '08:00',
      endTime: '08:40',
      subjectId: maths.id,
      ...overrides,
    });
    const add = (overrides: Record<string, unknown> = {}, actor = admin) =>
      call(actor, 'post', '/timetable').send(lesson(overrides));
    const timetableOf = async (actor: SignedIn, query: string) =>
      dataOf<SlotView[]>(await call(actor, 'get', `/timetable?${query}`).expect(200));

    beforeAll(async () => {
      dataOf<AcademicYearView>(
        await asAdmin('post', '/academic-years')
          .send({ name: '2026', startDate: '2026-01-05', endDate: '2026-11-20' })
          .expect(201),
      );
      const subject = async (name: string, code: string) =>
        dataOf<SubjectView>(await asAdmin('post', '/subjects').send({ name, code }).expect(201));
      maths = await subject('Mathematics', 'MAT');
      english = await subject('English', 'ENG');
      const science = await subject('Science', 'SCI');
      const created = dataOf<ClassView>(
        await asAdmin('post', '/classes').send({ name: 'Grade 7', level: 7 }).expect(201),
      );
      for (const name of ['East', 'West']) {
        await asAdmin('post', `/classes/${created.id}/streams`).send({ name }).expect(201);
      }
      await asAdmin('put', `/classes/${created.id}/subjects`)
        .send({ subjects: [maths, english].map((s) => ({ subjectId: s.id, isCompulsory: true })) })
        .expect(200);
      grade7 = dataOf<ClassView[]>(await asAdmin('get', '/classes').expect(200)).find(
        (c) => c.id === created.id,
      ) as ClassView;
      const grade8 = dataOf<ClassView>(
        await asAdmin('post', '/classes').send({ name: 'Grade 8', level: 8 }).expect(201),
      );
      await asAdmin('put', `/classes/${grade8.id}/subjects`)
        .send({ subjects: [{ subjectId: maths.id, isCompulsory: true }] })
        .expect(200);
      Object.assign(grade7, { grade8Id: grade8.id, scienceId: science.id });

      const staff = async (firstName: string, userId?: string) =>
        dataOf<TeacherDetail>(
          await asAdmin('post', '/teachers')
            .send({
              staffNumber: unique('T'),
              firstName,
              lastName: 'Teacher',
              ...(userId ? { userId } : {}),
            })
            .expect(201),
        );
      tom = await staff('Tom', users.teacher.id);
      wendy = await staff('Wendy');
    });

    it('adds a lesson and refuses another at the same time for the same learners', async () => {
      first = dataOf<SlotView>(await add({ teacherId: tom.id, room: 'Room 4' }).expect(201));
      expect(first).toMatchObject({
        dayOfWeek: 1,
        startTime: '08:00',
        endTime: '08:40',
        stream: null,
        subject: { code: 'MAT' },
        teacher: { name: 'Tom Teacher' },
        room: 'Room 4',
      });

      const clash = await add({
        subjectId: english.id,
        startTime: '08:20',
        endTime: '09:00',
      }).expect(409);
      expect(errorOf(clash)).toMatchObject({ code: 'TIMETABLE_CLASH' });
      expect(errorOf(clash).message).toContain(
        'Grade 7 already has Mathematics from 08:00 to 08:40',
      );
      // A stream of that class is busy too.
      await add({ streamId: stream('East'), subjectId: english.id }).expect(409);
    });

    it('allows back-to-back lessons and streams taught in parallel', async () => {
      await add({
        streamId: stream('East'),
        subjectId: english.id,
        startTime: '08:40',
        endTime: '09:20',
        teacherId: wendy.id,
      }).expect(201);
      await add({
        streamId: stream('West'),
        startTime: '08:40',
        endTime: '09:20',
        teacherId: tom.id,
      }).expect(201);
      // The whole class cannot be taught while its streams are split.
      await add({ startTime: '09:00', endTime: '09:40' }).expect(409);
    });

    it('will not put a teacher in two places at once', async () => {
      const grade8Id = (grade7 as unknown as { grade8Id: string }).grade8Id;
      const busy = await add({ classId: grade8Id, teacherId: tom.id }).expect(409);
      expect(errorOf(busy).message).toContain(
        'The teacher is already teaching Mathematics to Grade 7',
      );
      await add({ classId: grade8Id, teacherId: wendy.id }).expect(201);
    });

    it('validates a lesson’s parts', async () => {
      const scienceId = (grade7 as unknown as { scienceId: string }).scienceId;
      const notTaken = await add({ subjectId: scienceId, dayOfWeek: 2 }).expect(400);
      expect(errorOf(notTaken).code).toBe('SUBJECT_NOT_TAKEN');
      const backwards = await add({ dayOfWeek: 2, startTime: '10:00', endTime: '09:00' }).expect(
        400,
      );
      expect(errorOf(backwards).code).toBe('INVALID_TIME');
      await add({ dayOfWeek: 8 }).expect(400);
      await add({ dayOfWeek: 2, startTime: '8am' }).expect(400);
      await add({ dayOfWeek: 2, streamId: grade7.id }).expect(400);
      await add({ dayOfWeek: 2, teacherId: grade7.id }).expect(400);
    });

    it('moves a lesson without clashing with itself', async () => {
      const same = dataOf<SlotView>(
        await asAdmin('put', `/timetable/${first.id}`)
          .send(lesson({ teacherId: tom.id, room: 'Lab' }))
          .expect(200),
      );
      expect(same.room).toBe('Lab');
      // Moving it onto the split-stream period is still a clash.
      await asAdmin('put', `/timetable/${first.id}`)
        .send(lesson({ startTime: '08:40', endTime: '09:20' }))
        .expect(409);
    });

    it('lists a class’s, a stream’s and a teacher’s lessons', async () => {
      expect(
        (await timetableOf(admin, `classId=${grade7.id}`)).map((s) => [
          s.startTime,
          s.stream?.name ?? 'All',
        ]),
      ).toEqual([
        ['08:00', 'All'],
        ['08:40', 'East'],
        ['08:40', 'West'],
      ]);
      // A stream sees its own lessons and those of the whole class.
      expect(
        (await timetableOf(student, `classId=${grade7.id}&streamId=${stream('East')}`)).map(
          (s) => s.subject.code,
        ),
      ).toEqual(['MAT', 'ENG']);
      expect((await timetableOf(admin, `teacherId=${wendy.id}`)).map((s) => s.class.name)).toEqual([
        'Grade 8',
        'Grade 7',
      ]);
      // "Mine" is the signed-in teacher's own lessons; nobody else's.
      expect((await timetableOf(teacher, 'mine=true')).map((s) => s.startTime)).toEqual([
        '08:00',
        '08:40',
      ]);
      expect(await timetableOf(colleague, 'mine=true')).toEqual([]);
      const unfiltered = await call(admin, 'get', '/timetable').expect(400);
      expect(errorOf(unfiltered).code).toBe('FILTER_REQUIRED');
    });

    it('keeps changes to those who manage the timetable, within their tenant', async () => {
      await add({ dayOfWeek: 3 }, teacher).expect(403);
      await call(teacher, 'delete', `/timetable/${first.id}`).expect(403);
      await call(parent, 'get', `/timetable?classId=${grade7.id}`).expect(403);
      await call(betaAdmin, 'delete', `/timetable/${first.id}`).expect(404);
      expect(await timetableOf(betaAdmin, `classId=${grade7.id}`)).toEqual([]);

      await asAdmin('delete', `/timetable/${first.id}`).expect(204);
      await asAdmin('delete', `/timetable/${first.id}`).expect(404);
      // The freed period can be used again.
      await add({ subjectId: english.id }).expect(201);
    });
  });
});
