import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiDownload, configureHttpAuth } from '@/services/http';
import { fail, fakeApi, ok, restoreApi } from '@/services/__tests__/fake-api';
import ReportCardsPanel from '../ReportCardsPanel.vue';

const EXAM = {
  id: 'end',
  name: 'End-term',
  type: 'END_TERM',
  status: 'COMPILED',
  startDate: '2026-07-20',
  endDate: '2026-07-31',
  term: { id: 't2', name: 'Term 2' },
  academicYear: { id: 'y1', name: '2026' },
  classes: [{ id: 'c7', name: 'Grade 7' }],
  progress: { entered: 4, expected: 4 },
};
const row = (name: string, teacher: boolean) => ({
  student: { id: `s-${name}`, name, admissionNumber: `ADM-${name}` },
  class: 'Grade 7',
  stream: 'East',
  average: 85,
  grade: 'A',
  classPosition: 1,
  hasClassTeacherRemarks: teacher,
  hasPrincipalRemarks: false,
});
const LIST = {
  examination: {
    id: 'end',
    name: 'End-term',
    status: 'COMPILED',
    term: 'Term 2',
    academicYear: '2026',
  },
  canEdit: { classTeacherRemarks: true, principalRemarks: false },
  rows: [row('Amina', true), row('Brian', false)],
};
const CARD = {
  student: {
    id: 's-Amina',
    name: 'Amina',
    admissionNumber: 'ADM-Amina',
    class: 'Grade 7',
    stream: 'East',
  },
  examination: { id: 'end', name: 'End-term', term: 'Term 2', academicYear: '2026' },
  summary: {
    average: 85,
    grade: 'A',
    classPosition: { position: 1, outOf: 2 },
    streamPosition: null,
  },
  remarks: { classTeacher: 'A focused learner.', principal: null },
  isPublished: false,
};

const plugins = () =>
  [
    [
      VueQueryPlugin,
      { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    ],
  ] as never;

const mountPanel = () =>
  mount(ReportCardsPanel, {
    props: { examId: 'end' },
    global: { plugins: plugins() },
    attachTo: document.body,
  });

const routes = (overrides: Parameters<typeof fakeApi>[0] = {}) =>
  fakeApi({
    'GET /examinations': () => ok([EXAM]),
    'GET /classes': () => ok([]),
    'GET /examinations/end/report-cards': () => ok(LIST),
    'GET /examinations/end/report-cards/students/s-Amina': () => ok(CARD),
    ...overrides,
  });

const button = (wrapper: ReturnType<typeof mountPanel>, label: string) =>
  wrapper.findAll('button').find((entry) => entry.attributes('aria-label') === label);

beforeEach(() => {
  setActivePinia(createPinia());
});
afterEach(() => {
  restoreApi();
  configureHttpAuth(null);
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('ReportCardsPanel', () => {
  it('lists learners and marks unpublished results as provisional', async () => {
    routes();
    const wrapper = mountPanel();
    await vi.waitFor(() => expect(wrapper.findAll('tbody tr')).toHaveLength(2));

    expect(wrapper.text()).toContain('These results are not published yet.');
    const rows = wrapper.findAll('tbody tr').map((entry) => entry.text());
    expect(rows[0]).toContain('remarks written');
    expect(rows[1]).toContain('remarks missing');
    wrapper.unmount();
  });

  it('lets a class teacher write only their own remarks', async () => {
    const api = routes({
      'PUT /examinations/end/report-cards/students/s-Amina/remarks': () => ok(CARD),
    });
    const wrapper = mountPanel();
    await vi.waitFor(() => expect(wrapper.findAll('tbody tr')).toHaveLength(2));

    await button(wrapper, 'Write remarks for Amina')?.trigger('click');
    await vi.waitFor(() => expect(document.querySelectorAll('textarea')).toHaveLength(2));
    const [teacher, principal] = Array.from(document.querySelectorAll('textarea'));
    await vi.waitFor(() => expect(teacher?.value).toBe('A focused learner.'));
    expect(principal?.disabled).toBe(true);

    (teacher as HTMLTextAreaElement).value = 'Much improved.';
    teacher?.dispatchEvent(new Event('input'));
    document.querySelector<HTMLFormElement>('#remarks-form')?.dispatchEvent(new Event('submit'));

    await vi.waitFor(() => expect(api.calls.some((call) => call.method === 'PUT')).toBe(true));
    // The principal's remarks are not sent by someone who may not write them.
    expect(api.calls.find((call) => call.method === 'PUT')?.data).toEqual({
      classTeacherRemarks: 'Much improved.',
    });
    wrapper.unmount();
  });

  it('shows the server’s reason when a download is refused', async () => {
    routes({
      'GET /examinations/end/report-cards/pdf': () =>
        fail(422, 'TOO_MANY_REPORT_CARDS', 'Choose a class to download.'),
    });
    const wrapper = mountPanel();
    await vi.waitFor(() => expect(wrapper.findAll('tbody tr')).toHaveLength(2));

    await wrapper
      .findAll('button')
      .find((entry) => entry.text().includes('Download all'))
      ?.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Choose a class to download.'));
    wrapper.unmount();
  });
});

describe('apiDownload', () => {
  it('unwraps an error that arrives as a file', async () => {
    fakeApi({
      'GET /file': () => ({
        status: 404,
        body: new Blob(
          [
            JSON.stringify({
              success: false,
              error: { code: 'REPORT_CARD_NOT_FOUND', message: 'Report card not found.' },
              meta: { requestId: null, timestamp: '2026-10-13T00:00:00.000Z', path: '/file' },
            }),
          ],
          { type: 'application/json' },
        ),
      }),
    });
    await expect(apiDownload({ url: '/file' }, 'x.pdf')).rejects.toMatchObject({
      code: 'REPORT_CARD_NOT_FOUND',
      message: 'Report card not found.',
    });
  });

  it('returns the file with the name the server gave it', async () => {
    fakeApi({
      'GET /file': () => ({ status: 200, body: new Blob(['%PDF-'], { type: 'application/pdf' }) }),
    });
    const file = await apiDownload({ url: '/file' }, 'fallback.pdf');
    expect(file.filename).toBe('fallback.pdf');
    expect(file.blob.size).toBe(5);
  });
});
