import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { monthGrid, monthRange, shiftMonth } from '@/features/calendar/calendar.service';
import { byDay, type Slot } from '@/features/timetable/timetable.service';
import { configureHttpAuth } from '@/services/http';
import { fakeApi, noContent, ok, restoreApi, session } from '@/services/__tests__/fake-api';
import { useAuthStore } from '@/stores/auth';
import AnnouncementsView from '../AnnouncementsView.vue';
import MessagesView from '../MessagesView.vue';
import NotificationsView from '../NotificationsView.vue';
import { timeAgo } from '../communication.service';

const plugins = () =>
  [
    VueQueryPlugin,
    { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
  ] as const;

async function signInAs(permissions: string[]) {
  fakeApi({
    'POST /auth/login': () =>
      ok(session('token-1', { permissions, schools: [{ id: 'school-1', name: 'Main' }] })),
  });
  await useAuthStore().login('amina@school.example', 'a-long-passphrase');
}
async function mountAt(component: object, path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/messages', component },
      { path: '/notifications', component },
      { path: '/announcements', component: { template: '<p>announcements page</p>' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(component, {
    global: { plugins: [router, plugins() as never] },
    attachTo: document.body,
  });
  return { wrapper, router };
}

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => {
  restoreApi();
  configureHttpAuth(null);
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('timeAgo', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  it('describes how long ago something happened', () => {
    expect(timeAgo('2026-10-13T11:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-10-13T11:55:00Z', now)).toMatch(/5 minutes ago/);
    expect(timeAgo('2026-10-13T09:00:00Z', now)).toMatch(/3 hours ago/);
    expect(timeAgo('2026-10-12T11:00:00Z', now)).toMatch(/yesterday|1 day ago/);
    expect(timeAgo('2026-09-01T12:00:00Z', now)).toMatch(/last month|1 month ago/);
  });
});

describe('calendar helpers', () => {
  it('finds a month’s bounds and steps across year ends', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('lays a month out in whole Monday-first weeks', () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const weeks = monthGrid('2026-10', [], '2026-10-13');
    expect(weeks).toHaveLength(5);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0]?.[0]).toMatchObject({ date: '2026-09-28', inMonth: false });
    expect(weeks[0]?.[3]).toMatchObject({ date: '2026-10-01', inMonth: true });
    expect(weeks[4]?.[6]).toMatchObject({ date: '2026-11-01', inMonth: false });
    expect(
      weeks
        .flat()
        .filter((day) => day.isToday)
        .map((day) => day.date),
    ).toEqual(['2026-10-13']);
    // A month that starts on a Monday needs no leading padding.
    expect(monthGrid('2026-06', [], '')[0]?.[0]?.date).toBe('2026-06-01');
  });

  it('shows an event on every day it spans', () => {
    const event = {
      id: 'e1',
      title: 'Half-term',
      description: null,
      category: 'HOLIDAY' as const,
      visibility: 'EVERYONE' as const,
      startDate: '2026-10-29',
      endDate: '2026-11-02',
      startTime: null,
      endTime: null,
      location: null,
    };
    const days = monthGrid('2026-10', [event], '')
      .flat()
      .filter((day) => day.events.length > 0);
    expect(days.map((day) => day.date)).toEqual([
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
  });
});

describe('timetable helpers', () => {
  const slot = (dayOfWeek: number, startTime: string): Slot => ({
    id: `${dayOfWeek}-${startTime}`,
    dayOfWeek,
    startTime,
    endTime: '23:59',
    class: { id: 'c7', name: 'Grade 7' },
    stream: null,
    subject: { id: 's', name: 'Maths', code: 'MAT' },
    teacher: null,
    room: null,
  });

  it('groups lessons by day in time order, showing weekends only when used', () => {
    const week = byDay([slot(1, '10:00'), slot(1, '08:00'), slot(3, '09:00')]);
    expect(week.map((column) => column.label)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
    ]);
    expect(week[0]?.slots.map((entry) => entry.startTime)).toEqual(['08:00', '10:00']);
    expect(byDay([slot(6, '09:00')]).map((column) => column.label)).toContain('Saturday');
  });
});

describe('NotificationsView', () => {
  const item = (id: string, isRead: boolean, link: string | null) => ({
    id,
    kind: 'ANNOUNCEMENT',
    title: `Notice ${id}`,
    body: 'School closes at noon.',
    link,
    isRead,
    createdAt: new Date().toISOString(),
  });

  it('marks a notification read and follows its link, but never off-site', async () => {
    await signInAs([]);
    const api = fakeApi({
      'GET /notifications': () =>
        ok({
          items: [item('n1', false, '/announcements'), item('n2', false, 'https://evil.example/x')],
          page: 1,
          pageSize: 20,
          total: 2,
          unread: 2,
        }),
      'POST /notifications/n1/read': () => noContent(),
      'POST /notifications/n2/read': () => noContent(),
    });
    const { wrapper, router } = await mountAt(NotificationsView, '/notifications');
    await vi.waitFor(() => expect(wrapper.findAll('ul.divide-y > li')).toHaveLength(2));
    expect(wrapper.text()).toContain('2 unread');

    await wrapper.findAll('ul.divide-y > li button')[1]?.trigger('click');
    await vi.waitFor(() =>
      expect(api.calls.some((call) => call.url === '/notifications/n2/read')).toBe(true),
    );
    expect(router.currentRoute.value.path).toBe('/notifications');

    await wrapper.findAll('ul.divide-y > li button')[0]?.trigger('click');
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/announcements'));
    wrapper.unmount();
  });
});

describe('AnnouncementsView', () => {
  const NOTICE = {
    id: 'a1',
    title: 'Closing day',
    body: 'School closes at noon.',
    audience: 'EVERYONE',
    isPinned: true,
    expiresOn: null,
    isExpired: false,
    author: 'Grace Head',
    createdAt: '2026-10-12T08:00:00.000Z',
  };
  const mountView = () =>
    mount(AnnouncementsView, {
      global: { plugins: [plugins() as never] },
      attachTo: document.body,
    });

  it('lets a reader read, without tools to publish', async () => {
    await signInAs(['announcements:read']);
    fakeApi({ 'GET /announcements': () => ok([NOTICE]) });
    const view = mountView();
    await vi.waitFor(() => expect(view.text()).toContain('School closes at noon.'));
    expect(view.text()).not.toContain('New announcement');
    expect(view.text()).not.toContain('Everyone');
    expect(view.findAll('button')).toHaveLength(0);
    view.unmount();
  });

  it('publishes an announcement', async () => {
    await signInAs(['announcements:read', 'announcements:manage']);
    const api = fakeApi({
      'GET /announcements': () => ok([NOTICE]),
      'POST /announcements': () => ok({ ...NOTICE, id: 'a2', title: 'Sports day' }, 201),
    });
    const view = mountView();
    await vi.waitFor(() => expect(view.text()).toContain('New announcement'));
    await view
      .findAll('button')
      .find((b) => b.text().includes('New announcement'))
      ?.trigger('click');
    await vi.waitFor(() => expect(document.querySelector('#announcement-form')).toBeTruthy());

    const form = document.querySelector('#announcement-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('Enter a title of at least 3 characters.'),
    );

    const set = (selector: string, value: string) => {
      const field = form.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        selector,
      );
      if (!field) throw new Error(`missing ${selector}`);
      field.value = value;
      field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input'));
    };
    set('input[type="text"]', 'Sports day');
    set('textarea', 'Bring sportswear on Friday.');
    set('select', 'PARENTS');
    form.dispatchEvent(new Event('submit'));
    await vi.waitFor(() => expect(api.calls.some((call) => call.method === 'POST')).toBe(true));
    expect(api.calls.find((call) => call.method === 'POST')?.data).toEqual({
      title: 'Sports day',
      body: 'Bring sportswear on Friday.',
      audience: 'PARENTS',
      isPinned: false,
      expiresOn: null,
    });
    view.unmount();
  });
});

describe('MessagesView', () => {
  const me = { id: 'user-1', name: 'Amina Teacher', role: 'Teacher' };
  const them = { id: 'u2', name: 'Grace Otieno', role: 'Parent / Guardian' };
  const THREAD = {
    id: 't1',
    subject: 'Homework',
    participants: [me, them],
    messages: [
      {
        id: 'm1',
        body: 'Has she handed it in?',
        sender: them,
        isMine: false,
        sentAt: '2026-10-13T08:00:00.000Z',
      },
    ],
  };
  const SUMMARY = {
    id: 't1',
    subject: 'Homework',
    participants: [them],
    lastMessage: {
      body: 'Has she handed it in?',
      sender: 'Grace Otieno',
      sentAt: '2026-10-13T08:00:00.000Z',
    },
    hasUnread: true,
  };

  it('opens a conversation and sends a reply', async () => {
    await signInAs(['messages:read', 'messages:send']);
    const api = fakeApi({
      'GET /messages/threads': () => ok([SUMMARY]),
      'GET /messages/threads/t1': () => ok(THREAD),
      'POST /messages/threads/t1/messages': () =>
        ok(
          {
            ...THREAD,
            messages: [
              ...THREAD.messages,
              {
                id: 'm2',
                body: 'Yes, this morning.',
                sender: me,
                isMine: true,
                sentAt: '2026-10-13T08:05:00.000Z',
              },
            ],
          },
          201,
        ),
    });
    const { wrapper, router } = await mountAt(MessagesView, '/messages');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Homework'));
    expect(wrapper.text()).toContain('Choose a conversation');

    await wrapper.find('nav button').trigger('click');
    await vi.waitFor(() => expect(router.currentRoute.value.query.thread).toBe('t1'));
    await vi.waitFor(() => expect(wrapper.text()).toContain('Has she handed it in?'));

    await wrapper.find('textarea').setValue('Yes, this morning.');
    await wrapper.find('section form').trigger('submit');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Yes, this morning.'));
    expect(api.calls.find((call) => call.method === 'POST')?.data).toEqual({
      body: 'Yes, this morning.',
    });
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('');
    wrapper.unmount();
  });

  it('lets someone who can only read, read', async () => {
    await signInAs(['messages:read']);
    fakeApi({
      'GET /messages/threads': () => ok([SUMMARY]),
      'GET /messages/threads/t1': () => ok(THREAD),
    });
    const { wrapper } = await mountAt(MessagesView, '/messages?thread=t1');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Has she handed it in?'));
    expect(wrapper.text()).not.toContain('New message');
    expect(wrapper.find('textarea').exists()).toBe(false);
    wrapper.unmount();
  });
});
