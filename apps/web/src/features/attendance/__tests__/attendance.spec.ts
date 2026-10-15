import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureHttpAuth } from '@/services/http';
import { fail, fakeApi, ok, restoreApi, session } from '@/services/__tests__/fake-api';
import { useAuthStore } from '@/stores/auth';
import { addDaysIso, todayIso } from '@/utils/format';
import MonthlyPanel from '../MonthlyPanel.vue';
import RegisterPanel from '../RegisterPanel.vue';
import { formatRate, statusInfo } from '../attendance.service';

const CLASSES = [
  {
    id: 'c7',
    name: 'Grade 7',
    level: 7,
    isActive: true,
    gradingScheme: null,
    streams: [{ id: 's-east', classId: 'c7', name: 'East', capacity: null }],
    subjects: [],
  },
];
const learner = (name: string, status: string | null, note: string | null = null) => ({
  student: { id: `s-${name}`, name, admissionNumber: `ADM-${name}` },
  stream: 'East',
  status,
  note,
});
const register = (students: ReturnType<typeof learner>[]) => ({
  class: { id: 'c7', name: 'Grade 7' },
  date: todayIso(),
  lastMarkedAt: students.some((row) => row.status) ? '2026-10-13T07:30:00.000Z' : null,
  students,
  summary: { present: 0, absent: 0, late: 0, excused: 0, marked: 0, rate: null, unmarked: 3 },
});
const UNMARKED = register([learner('Amina', null), learner('Brian', null), learner('Chege', null)]);

const plugins = () =>
  [
    [
      VueQueryPlugin,
      { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    ],
  ] as never;

async function signInAs(permissions: string[]) {
  fakeApi({
    'POST /auth/login': () =>
      ok(session('token-1', { permissions, schools: [{ id: 'school-1', name: 'Main' }] })),
  });
  await useAuthStore().login('amina@school.example', 'a-long-passphrase');
}

const mountRegister = () =>
  mount(RegisterPanel, { global: { plugins: plugins() }, attachTo: document.body });
type Panel = ReturnType<typeof mountRegister>;
const radio = (panel: Panel, name: string, label: string) =>
  panel
    .find(`[aria-label="Attendance for ${name}"]`)
    .findAll('button')
    .find((button) => button.text() === label);

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => {
  restoreApi();
  configureHttpAuth(null);
  document.body.innerHTML = '';
});

describe('attendance helpers', () => {
  it('formats a rate, with a dash when nothing was marked', () => {
    expect([formatRate(66.67), formatRate(0), formatRate(null)]).toEqual(['66.67%', '0%', '—']);
  });

  it('describes each status', () => {
    expect(statusInfo('LATE')).toMatchObject({ label: 'Late', short: 'L' });
  });

  it('moves a calendar date across month and year ends', () => {
    expect(addDaysIso('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysIso('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysIso('2026-10-13', -29)).toBe('2026-09-14');
  });
});

describe('RegisterPanel', () => {
  it('saves only the learners whose marks changed', async () => {
    await signInAs(['attendance:read', 'attendance:mark']);
    const saved = register([
      learner('Amina', 'ABSENT', 'Sick'),
      learner('Brian', 'PRESENT'),
      learner('Chege', 'PRESENT'),
    ]);
    const api = fakeApi({
      'GET /classes': () => ok(CLASSES),
      'GET /attendance/register': () => ok(UNMARKED),
      'PUT /attendance/register': () => ok(saved),
    });
    const panel = mountRegister();
    await vi.waitFor(() => expect(panel.findAll('tbody tr')).toHaveLength(3));
    expect(panel.text()).toContain('Not marked yet');

    await radio(panel, 'Amina', 'Absent')?.trigger('click');
    const note = panel.find('[aria-label="Note for Amina"]');
    await note.setValue('Sick');
    await note.trigger('change');
    await panel
      .findAll('button')
      .find((b) => b.text().includes('Mark the rest present'))
      ?.trigger('click');
    expect(panel.find('[data-testid="unsaved"]').text()).toContain('3 unsaved changes');
    expect(radio(panel, 'Brian', 'Present')?.attributes('aria-checked')).toBe('true');

    await panel
      .findAll('button')
      .find((b) => b.text().includes('Save register'))
      ?.trigger('click');
    await vi.waitFor(() => expect(panel.text()).toContain('Register saved.'));

    const put = api.calls.find((call) => call.method === 'PUT');
    expect(put?.data).toEqual({
      classId: 'c7',
      date: todayIso(),
      records: [
        { studentId: 's-Amina', status: 'ABSENT', note: 'Sick' },
        { studentId: 's-Brian', status: 'PRESENT', note: null },
        { studentId: 's-Chege', status: 'PRESENT', note: null },
      ],
    });
    expect(panel.find('[data-testid="unsaved"]').exists()).toBe(false);
    panel.unmount();
  });

  it('drops a change that returns a learner to their saved mark', async () => {
    await signInAs(['attendance:read', 'attendance:mark']);
    fakeApi({
      'GET /classes': () => ok(CLASSES),
      'GET /attendance/register': () =>
        ok(register([learner('Amina', 'PRESENT'), learner('Brian', 'ABSENT')])),
    });
    const panel = mountRegister();
    await vi.waitFor(() => expect(panel.findAll('tbody tr')).toHaveLength(2));

    await radio(panel, 'Amina', 'Late')?.trigger('click');
    expect(panel.find('[data-testid="unsaved"]').text()).toContain('1 unsaved change');
    await radio(panel, 'Amina', 'Present')?.trigger('click');
    expect(panel.find('[data-testid="unsaved"]').exists()).toBe(false);
    panel.unmount();
  });

  it('is read-only without permission to mark', async () => {
    await signInAs(['attendance:read']);
    fakeApi({
      'GET /classes': () => ok(CLASSES),
      'GET /attendance/register': () => ok(UNMARKED),
    });
    const panel = mountRegister();
    await vi.waitFor(() => expect(panel.findAll('tbody tr')).toHaveLength(3));
    expect(radio(panel, 'Amina', 'Present')?.attributes('disabled')).toBeDefined();
    expect(panel.text()).not.toContain('Save register');
    panel.unmount();
  });

  it('shows why a register cannot be opened', async () => {
    await signInAs(['attendance:read']);
    fakeApi({
      'GET /classes': () => ok(CLASSES),
      'GET /attendance/register': () =>
        fail(403, 'CLASS_NOT_ASSIGNED', 'You are not assigned to this class.'),
    });
    const panel = mountRegister();
    await vi.waitFor(() => expect(panel.text()).toContain('You are not assigned to this class.'));
    panel.unmount();
  });
});

describe('MonthlyPanel', () => {
  it('lays out the month with one column per marked day', async () => {
    fakeApi({
      'GET /classes': () => ok(CLASSES),
      'GET /attendance/monthly': () =>
        ok({
          month: '2026-10',
          class: { id: 'c7', name: 'Grade 7' },
          days: ['2026-10-05', '2026-10-06'],
          students: [
            {
              student: { id: 's1', name: 'Amina', admissionNumber: 'ADM-1' },
              stream: 'East',
              marks: { '2026-10-05': 'PRESENT' },
              present: 1,
              absent: 0,
              late: 0,
              excused: 0,
              marked: 1,
              rate: 100,
            },
          ],
        }),
    });
    const panel = mount(MonthlyPanel, { global: { plugins: plugins() }, attachTo: document.body });
    await vi.waitFor(() => expect(panel.findAll('tbody tr')).toHaveLength(1));
    // Learner, two days, present, absent, rate.
    expect(panel.findAll('thead th')).toHaveLength(6);
    const cells = panel.findAll('tbody td');
    expect(cells[0]?.text()).toContain('Present');
    expect(cells[1]?.text()).toBe('·');
    expect(panel.text()).toContain('100%');
    panel.unmount();
  });
});
