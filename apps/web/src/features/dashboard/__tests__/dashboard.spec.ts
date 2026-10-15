import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureHttpAuth } from '@/services/http';
import { fail, fakeApi, ok, restoreApi, session } from '@/services/__tests__/fake-api';
import { useAuthStore } from '@/stores/auth';
import DashboardView from '../DashboardView.vue';

const chartStub = { props: ['option', 'label'], template: '<div data-testid="chart" />' };
const day = (date: string, present = 0, absent = 0) => ({
  date,
  present,
  absent,
  late: 0,
  excused: 0,
  rate: present + absent === 0 ? null : (present / (present + absent)) * 100,
});
const FULL = {
  term: {
    id: 't2',
    name: 'Term 2',
    academicYear: '2026',
    startDate: '2026-05-04',
    endDate: '2026-08-07',
  },
  counts: { students: 420, teachers: 28, classes: 12 },
  attendance: {
    week: [
      day('2026-10-07'),
      day('2026-10-08', 9, 1),
      day('2026-10-09'),
      day('2026-10-10'),
      day('2026-10-11'),
      day('2026-10-12'),
      day('2026-10-13', 8, 2),
    ],
    today: { rate: 80, marked: 10 },
  },
  performance: {
    trend: [
      { examination: 'Opener', date: '2026-05-10', mean: 58, passPercentage: 70 },
      { examination: 'Mid-term', date: '2026-06-20', mean: 62, passPercentage: 75 },
    ],
    latest: {
      examinationId: 'e2',
      name: 'Mid-term',
      status: 'PUBLISHED',
      meanScore: 62,
      passPercentage: 75,
    },
    meritList: [
      {
        resultId: 'r1',
        rank: 1,
        student: { id: 's1', name: 'Amina Otieno', admissionNumber: 'A1' },
        class: 'Grade 7',
        stream: 'East',
        average: 91,
        grade: 'A',
      },
    ],
  },
  finance: {
    currency: 'KES',
    collected: 1250000,
    outstanding: 310000,
    collectionRate: 80.13,
    recentPayments: [
      {
        id: 'p1',
        receiptNumber: 'RCT-2026-000041',
        student: { id: 's1', name: 'Amina Otieno', admissionNumber: 'A1' },
        amount: 15000,
        method: 'MPESA',
        reference: 'QGH7X1ABCD',
        paidOn: '2026-10-12',
        status: 'COMPLETED',
        allocated: 15000,
        refunded: 0,
        unallocated: 0,
      },
    ],
  },
  upcomingEvents: [
    {
      id: 'ev1',
      title: 'Parents’ day',
      description: null,
      category: 'MEETING',
      visibility: 'EVERYONE',
      startDate: '2026-10-20',
      endDate: '2026-10-20',
      startTime: '09:00',
      endTime: null,
      location: 'Main hall',
    },
  ],
};

const plugins = () =>
  [
    [
      VueQueryPlugin,
      { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    ],
  ] as never;
const mountView = () =>
  mount(DashboardView, {
    global: {
      plugins: plugins(),
      stubs: { AppChart: chartStub, RouterLink: { template: '<a><slot /></a>' } },
    },
    attachTo: document.body,
  });

async function signInAs(permissions: string[]) {
  fakeApi({
    'POST /auth/login': () =>
      ok(session('token-1', { permissions, schools: [{ id: 'school-1', name: 'Main' }] })),
  });
  await useAuthStore().login('amina@school.example', 'a-long-passphrase');
}

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => {
  restoreApi();
  configureHttpAuth(null);
  document.body.innerHTML = '';
});

describe('DashboardView', () => {
  it('shows the figures the server reports for the term', async () => {
    await signInAs(['calendar:read']);
    fakeApi({ 'GET /dashboard': () => ok(FULL), 'GET /academic-years': () => ok([]) });
    const view = mountView();
    await vi.waitFor(() =>
      expect(view.find('[data-testid="dashboard-stats"]').exists()).toBe(true),
    );

    const text = view.text();
    expect(text).toContain('Term 2, 2026');
    expect(text).toContain('Students420');
    expect(text).toContain('Attendance today80%');
    expect(text).toMatch(/Fees collectedKES\s?1,250,000\.00/);
    expect(text).toContain('Amina Otieno');
    expect(text).toContain('RCT-2026-000041');
    expect(text).toContain('Parents’ day');
    expect(text).toContain('Main hall');
    // Weekly attendance and the performance trend.
    expect(view.findAll('[data-testid="chart"]')).toHaveLength(2);
    view.unmount();
  });

  it('shows only the sections the person may see, and says when there is no data', async () => {
    await signInAs([]);
    fakeApi({
      'GET /dashboard': () =>
        ok({
          ...FULL,
          counts: { students: null, teachers: null, classes: null },
          attendance: {
            week: FULL.attendance.week.map((d) => day(d.date)),
            today: { rate: null, marked: 0 },
          },
          performance: null,
          finance: null,
          upcomingEvents: [],
        }),
    });
    const view = mountView();
    await vi.waitFor(() => expect(view.text()).toContain('Attendance today'));

    const text = view.text();
    expect(text).toContain('No register taken yet');
    expect(text).toContain('No register has been taken in the last seven days.');
    expect(text).toContain('Nothing is on the calendar');
    expect(text).not.toContain('Fees collected');
    expect(text).not.toContain('Merit list');
    expect(text).not.toContain('Students');
    expect(view.findAll('[data-testid="chart"]')).toHaveLength(0);
    view.unmount();
  });

  it('asks for the chosen term', async () => {
    await signInAs(['calendar:read']);
    const api = fakeApi({
      'GET /dashboard': () => ok(FULL),
      'GET /academic-years': () =>
        ok([
          {
            id: 'y1',
            name: '2026',
            startDate: '2026-01-05',
            endDate: '2026-11-20',
            isCurrent: true,
            terms: [
              {
                id: 't1',
                academicYearId: 'y1',
                name: 'Term 1',
                sequence: 1,
                startDate: '2026-01-05',
                endDate: '2026-04-03',
                isCurrent: false,
              },
            ],
          },
        ]),
    });
    const view = mountView();
    await vi.waitFor(() => expect(view.find('select').exists()).toBe(true));
    await view.find('select').setValue('t1');
    await vi.waitFor(() =>
      expect(
        api.calls.some(
          (call) =>
            call.url === '/dashboard' && (call.params as { termId?: string }).termId === 't1',
        ),
      ).toBe(true),
    );
    view.unmount();
  });

  it('reports a failure to load', async () => {
    await signInAs([]);
    fakeApi({ 'GET /dashboard': () => fail(500, 'INTERNAL', 'Something went wrong.') });
    const view = mountView();
    await vi.waitFor(() => expect(view.text()).toContain('The dashboard could not be loaded'));
    view.unmount();
  });
});
