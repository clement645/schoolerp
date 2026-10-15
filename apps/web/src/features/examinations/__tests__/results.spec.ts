import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ResultsPolicyPanel from '@/features/school-config/ResultsPolicyPanel.vue';
import { configureHttpAuth } from '@/services/http';
import { fail, fakeApi, ok, restoreApi } from '@/services/__tests__/fake-api';
import ResultsPanel from '../ResultsPanel.vue';
import { formatChange } from '../results.service';

// Canvas charts cannot draw in jsdom; what they are given is asserted instead.
const chartStub = {
  props: ['option', 'label'],
  template: '<div data-testid="chart" :data-label="label" />',
};

const exam = (id: string, name: string, status: string, startDate: string) => ({
  id,
  name,
  type: 'END_TERM',
  status,
  startDate,
  endDate: startDate,
  term: { id: 't2', name: 'Term 2' },
  academicYear: { id: 'y1', name: '2026' },
  classes: [
    { id: 'c7', name: 'Grade 7' },
    { id: 'c8', name: 'Grade 8' },
  ],
  progress: { entered: 10, expected: 10 },
});
const EXAMS = [
  exam('mid', 'Mid-term', 'PUBLISHED', '2026-06-01'),
  exam('end', 'End-term', 'COMPILED', '2026-07-20'),
  exam('cat', 'CAT 3', 'OPEN', '2026-08-01'),
];

const row = (name: string, rank: number | null, average: number, extra: object = {}) => ({
  resultId: `r-${name}`,
  rank,
  student: { id: `s-${name}`, name, admissionNumber: `ADM-${name}` },
  class: 'Grade 7',
  stream: 'East',
  total: average * 2,
  maxTotal: 200,
  average,
  grade: rank === null ? null : 'A',
  points: null,
  trend: null,
  isComplete: true,
  passed: rank === null ? null : average >= 50,
  ...extra,
});
const OVERVIEW = {
  examination: {
    id: 'end',
    name: 'End-term',
    status: 'COMPILED',
    term: 'Term 2',
    academicYear: '2026',
  },
  stats: {
    studentsExamined: 2,
    meanScore: 65,
    highestScore: 85,
    lowestScore: 45,
    passPercentage: 50,
  },
  meritList: [
    row('Amina', 1, 85, { trend: { direction: 'up', change: 15 } }),
    row('Brian', 2, 45, { trend: { direction: 'down', change: -10 }, isComplete: false }),
    row('Dalia', null, 0),
  ],
};
const ANALYTICS = {
  subjectPerformance: [
    { subject: 'English', code: 'ENG', mean: 60, highest: 80, lowest: 40, entries: 2 },
  ],
  gradeDistribution: [{ grade: 'A', count: 1 }],
  classComparison: [
    { class: 'Grade 7', mean: 65, passPercentage: 50, students: 2 },
    { class: 'Grade 8', mean: 70, passPercentage: 100, students: 1 },
  ],
  streamComparison: [{ class: 'Grade 7', stream: 'East', mean: 65, students: 2 }],
  trend: [
    {
      examinationId: 'mid',
      examination: 'Mid-term',
      date: '2026-06-01',
      mean: 60,
      passPercentage: 80,
    },
    {
      examinationId: 'end',
      examination: 'End-term',
      date: '2026-07-20',
      mean: 65,
      passPercentage: 50,
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

function mountPanel(examId = '') {
  return mount(ResultsPanel, {
    props: {
      examId,
      'onUpdate:examId': (id: string) => void wrapper.setProps({ examId: id }),
    },
    global: { plugins: plugins(), stubs: { AppChart: chartStub } },
    attachTo: document.body,
  });
}
let wrapper: ReturnType<typeof mountPanel>;

const routes = (overrides: Parameters<typeof fakeApi>[0] = {}) =>
  fakeApi({
    'GET /examinations': () => ok(EXAMS),
    'GET /classes': () => ok([]),
    'GET /results': () => ok(OVERVIEW),
    'GET /results/analytics': () => ok(ANALYTICS),
    ...overrides,
  });

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  wrapper?.unmount();
  restoreApi();
  configureHttpAuth(null);
  document.body.innerHTML = '';
});

describe('formatChange', () => {
  it('signs a change in average', () => {
    expect([formatChange(4.5), formatChange(-10), formatChange(0)]).toEqual(['+4.5', '-10', '0']);
  });
});

describe('ResultsPanel', () => {
  it('opens on the latest compiled examination and shows its figures', async () => {
    const api = routes();
    wrapper = mountPanel();
    await vi.waitFor(() => expect(wrapper.text()).toContain('Merit list'));
    await flushPromises();

    // The open examination has no results, so the compiled one is chosen.
    expect(wrapper.props('examId')).toBe('end');
    const request = api.calls.find((call) => call.url === '/results');
    expect(request?.params).toEqual({
      examinationId: 'end',
      classId: undefined,
      stream: undefined,
    });

    const text = wrapper.text();
    expect(text).toContain('Students Examined2');
    expect(text).toContain('Pass Percentage50%');
    expect(text).toContain('Not yet published to parents and students.');
    expect(wrapper.findAll('[data-testid="chart"]')).toHaveLength(4);
  });

  it('lists learners with rank, movement and status', async () => {
    routes();
    wrapper = mountPanel('end');
    await vi.waitFor(() => expect(wrapper.findAll('tbody tr')).toHaveLength(3));

    const rows = wrapper.findAll('tbody tr').map((entry) => entry.text());
    expect(rows[0]).toContain('Amina');
    expect(rows[0]).toContain('+15');
    expect(rows[0]).toContain('Pass');
    expect(rows[1]).toContain('-10');
    expect(rows[1]).toContain('Below pass mark');
    expect(rows[1]).toContain('Missing a subject');
    expect(rows[2]).toContain('Not examined');
  });

  it('asks the server again when a class is chosen', async () => {
    const api = routes();
    wrapper = mountPanel('end');
    await vi.waitFor(() => expect(wrapper.findAll('tbody tr')).toHaveLength(3));

    await wrapper.findAll('select')[1]?.setValue('c7');
    await vi.waitFor(() =>
      expect(
        api.calls.some(
          (call) =>
            call.url === '/results' && (call.params as { classId?: string }).classId === 'c7',
        ),
      ).toBe(true),
    );
  });

  it('explains when nothing has been compiled yet', async () => {
    routes({ 'GET /examinations': () => ok([exam('cat', 'CAT 3', 'OPEN', '2026-08-01')]) });
    wrapper = mountPanel();
    await vi.waitFor(() => expect(wrapper.text()).toContain('No results yet'));
  });

  it('reports a failure to load results', async () => {
    routes({ 'GET /results': () => fail(500, 'INTERNAL', 'Something went wrong.') });
    wrapper = mountPanel('end');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Results could not be loaded'));
  });
});

describe('ResultsPolicyPanel', () => {
  const POLICIES = {
    passMark: 50,
    rankingPolicy: 'COMPETITION',
    showClassPosition: true,
    showStreamPosition: true,
    currency: 'KES',
  };
  const mountPolicies = (canManage: boolean) =>
    mount(ResultsPolicyPanel, {
      props: { canManage },
      global: { plugins: plugins() },
      attachTo: document.body,
    });

  it('saves a changed pass mark', async () => {
    const api = fakeApi({
      'GET /school/settings': () => ok(POLICIES),
      'PUT /school/settings': (call) => ok({ ...POLICIES, ...(call.data as object) }),
    });
    const panel = mountPolicies(true);
    await vi.waitFor(() => expect(panel.find('form').exists()).toBe(true));

    await panel.find('input[type="number"]').setValue('45');
    await panel.find('form').trigger('submit');
    await vi.waitFor(() => expect(panel.text()).toContain('Policies saved.'));
    expect(api.calls.find((call) => call.method === 'PUT')?.data).toMatchObject({
      passMark: 45,
      rankingPolicy: 'COMPETITION',
    });
    panel.unmount();
  });

  it('rejects a pass mark outside 0–100 without calling the server', async () => {
    const api = fakeApi({ 'GET /school/settings': () => ok(POLICIES) });
    const panel = mountPolicies(true);
    await vi.waitFor(() => expect(panel.find('form').exists()).toBe(true));

    await panel.find('input[type="number"]').setValue('140');
    await panel.find('form').trigger('submit');
    await flushPromises();
    expect(panel.text()).toContain('Enter a pass mark between 0 and 100.');
    expect(api.calls.some((call) => call.method === 'PUT')).toBe(false);
    panel.unmount();
  });

  it('is read-only without permission to manage settings', async () => {
    fakeApi({ 'GET /school/settings': () => ok(POLICIES) });
    const panel = mountPolicies(false);
    await vi.waitFor(() => expect(panel.find('form').exists()).toBe(true));
    expect(panel.find('button[type="submit"]').exists()).toBe(false);
    expect(panel.find('input[type="number"]').attributes('disabled')).toBeDefined();
    panel.unmount();
  });
});
