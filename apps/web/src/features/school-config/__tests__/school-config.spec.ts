import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppTabs from '@/components/ui/AppTabs.vue';
import { describeAction } from '@/features/audit/audit.service';
import SubjectsView from '@/features/subjects/SubjectsView.vue';
import { apiRequest, configureHttpAuth } from '@/services/http';
import { fail, fakeApi, noContent, ok, restoreApi, session } from '@/services/__tests__/fake-api';
import { useAuthStore } from '@/stores/auth';
import { useSchoolStore } from '@/stores/school';
import GradingSchemeModal from '../GradingSchemeModal.vue';
import {
  describeRange,
  schoolSchema,
  SCHEME_TEMPLATES,
  type GradingScheme,
} from '../config.service';

const SCHOOLS = [
  { id: 'school-1', name: 'Main Campus' },
  { id: 'school-2', name: 'Lakeside Campus' },
];

async function signInAs(permissions: string[], schools = SCHOOLS.slice(0, 1)) {
  fakeApi({ 'POST /auth/login': () => ok(session('token-1', { permissions, schools })) });
  const auth = useAuthStore();
  await auth.login('amina@school.example', 'a-long-passphrase');
  configureHttpAuth({
    getAccessToken: () => auth.accessToken,
    getSchoolId: () => useSchoolStore().activeSchoolId,
    refresh: () => auth.refresh(),
    onSessionLost: () => undefined,
    onPasswordChangeRequired: () => undefined,
  });
  return auth;
}

// Retries are disabled so failures surface immediately.
const plugins = () =>
  [
    [
      VueQueryPlugin,
      { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    ],
  ] as never;

const last = <T>(items: T[] | undefined): T | undefined => items?.[items.length - 1];

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

describe('grading helpers', () => {
  it('describes score ranges the way they are applied', () => {
    expect(describeRange({ minScore: 80, upperLimit: null })).toBe('80 – 100');
    expect(describeRange({ minScore: 75, upperLimit: 80 })).toBe('75 – below 80');
    expect(describeRange({ minScore: null, upperLimit: null })).toBe('—');
  });

  it('offers templates that are themselves valid schemes', () => {
    for (const { scheme } of SCHEME_TEMPLATES) {
      const labels = scheme.boundaries.map((boundary) => boundary.label);
      const scores = scheme.boundaries.map((boundary) => boundary.minScore);

      expect(new Set(labels).size, scheme.name).toBe(labels.length);
      if (scheme.type === 'PERCENTAGE') {
        expect(scores, scheme.name).toContain(0);
        expect(new Set(scores).size, scheme.name).toBe(scores.length);
      } else {
        expect(
          scores.every((score) => score === null),
          scheme.name,
        ).toBe(true);
      }
    }
  });
});

describe('describeAction', () => {
  it('names configuration events readably and falls back to the raw action', () => {
    expect(describeAction('auth.login.failed')).toBe('Sign-in failed');
    expect(describeAction('grading_scheme.set_default')).toBe('Grading scheme made default');
    expect(describeAction('class.subjects.changed')).toBe('Class subjects changed');
    expect(describeAction('academic_year.created')).toBe('Academic year created');
    expect(describeAction('something.unforeseen')).toBe('something.unforeseen');
  });
});

describe('active school', () => {
  it('defaults to the first school and sends it with every authenticated request', async () => {
    await signInAs([]);
    const api = fakeApi({ 'GET /school': () => ok({ id: 'school-1', name: 'Main Campus' }) });

    await apiRequest(
      { method: 'GET', url: '/school' },
      schoolSchema.pick({ id: true, name: true }),
    );

    expect(useSchoolStore().activeSchoolId).toBe('school-1');
    expect(api.calls[0]).toMatchObject({
      authorization: 'Bearer token-1',
      schoolId: 'school-1',
    });
  });

  it('sends the newly chosen school after switching', async () => {
    await signInAs([], SCHOOLS);
    const api = fakeApi({ 'GET /school': () => ok({ id: 'school-2', name: 'Lakeside Campus' }) });

    useSchoolStore().select('school-2');
    await apiRequest(
      { method: 'GET', url: '/school' },
      schoolSchema.pick({ id: true, name: true }),
    );

    expect(api.calls[0]?.schoolId).toBe('school-2');
  });

  it('remembers a chosen school and ignores ones outside the account', async () => {
    await signInAs([], SCHOOLS);
    const school = useSchoolStore();

    school.select('school-2');
    expect(school.activeSchool?.name).toBe('Lakeside Campus');

    school.select('someone-elses-school');
    expect(school.activeSchoolId).toBe('school-2');
  });

  it('falls back to the first school when the remembered one is no longer available', async () => {
    localStorage.setItem('edumaster.school', JSON.stringify('school-removed'));
    await signInAs([], SCHOOLS);

    expect(useSchoolStore().activeSchoolId).toBe('school-1');
  });

  it('has no active school for platform staff', async () => {
    await signInAs(['platform:tenants:manage'], []);

    expect(useSchoolStore().activeSchoolId).toBeNull();
  });
});

describe('AppTabs', () => {
  const tabs = [
    { id: 'a', label: 'First' },
    { id: 'b', label: 'Second' },
    { id: 'c', label: 'Third' },
  ];

  it('marks the selected tab and moves with the arrow keys, wrapping around', async () => {
    const wrapper = mount(AppTabs, {
      props: { tabs, label: 'Sections', modelValue: 'a' },
      attachTo: document.body,
    });
    const selected = () => wrapper.get('[aria-selected="true"]').text();

    expect(selected()).toBe('First');
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.attributes('tabindex'))).toEqual([
      '0',
      '-1',
      '-1',
    ]);

    await wrapper.get('[role="tablist"]').trigger('keydown', { key: 'ArrowLeft' });
    expect(wrapper.emitted('update:modelValue')).toEqual([['c']]);

    await wrapper.setProps({ modelValue: 'c' });
    await wrapper.get('[role="tablist"]').trigger('keydown', { key: 'ArrowRight' });
    expect(last(wrapper.emitted('update:modelValue'))).toEqual(['a']);

    await wrapper.findAll('[role="tab"]')[1]?.trigger('click');
    expect(last(wrapper.emitted('update:modelValue'))).toEqual(['b']);
  });
});

describe('GradingSchemeModal', () => {
  const rows = () => document.body.querySelectorAll('[data-testid="grade-row"]');
  const field = (label: string) =>
    document.body.querySelector<HTMLInputElement>(`[aria-label="${label}"]`) as HTMLInputElement;
  const type = async (label: string, value: string) => {
    const input = field(label);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await flushPromises();
  };
  const submit = async () => {
    document.body
      .querySelector<HTMLFormElement>('#grading-scheme-form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await flushPromises();
  };
  const formError = () =>
    document.body.querySelector('[data-testid="grading-form-error"]')?.textContent?.trim();

  async function openModal(scheme: GradingScheme | null = null) {
    const wrapper = mount(GradingSchemeModal, {
      props: { open: false, scheme },
      global: { plugins: plugins() },
      attachTo: document.body,
    });
    await wrapper.setProps({ open: true });
    await flushPromises();
    return wrapper;
  }

  it('starts blank with two rows and fills in a chosen template', async () => {
    await signInAs(['settings:manage']);
    await openModal();
    expect(rows()).toHaveLength(2);

    const template = document.body.querySelector<HTMLSelectElement>('select') as HTMLSelectElement;
    template.value = 'competency-4';
    template.dispatchEvent(new Event('change'));
    await flushPromises();

    expect(rows()).toHaveLength(4);
    expect(field('Label of grade 1').value).toBe('EE');
    expect(field('Descriptor of grade 1').value).toBe('Exceeding Expectation');
    expect(field('Minimum score of grade 1').value).toBe('');
  });

  it('checks the form before calling the API', async () => {
    await signInAs(['settings:manage']);
    const api = fakeApi({});
    await openModal();

    await submit();
    expect(formError()).toBe('Enter a name for the grading scheme.');

    await type('Label of grade 1', 'A');
    await type('Label of grade 2', 'E');
    await type('Minimum score of grade 1', 'eighty');
    const name = document.body.querySelector<HTMLInputElement>(
      '[data-autofocus]',
    ) as HTMLInputElement;
    name.value = 'My scale';
    name.dispatchEvent(new Event('input'));
    await submit();

    expect(formError()).toBe('Scores and points must be numbers with at most two decimal places.');
    expect(api.calls).toHaveLength(0);
  });

  it('sends numbers as numbers and blank optional values as null', async () => {
    await signInAs(['settings:manage']);
    const created = { id: 's1', name: 'My scale', type: 'PERCENTAGE', description: null };
    const api = fakeApi({
      'POST /grading-schemes': () =>
        ok({ ...created, isDefault: true, classCount: 0, boundaries: [] }, 201),
    });
    const wrapper = await openModal();

    const name = document.body.querySelector<HTMLInputElement>(
      '[data-autofocus]',
    ) as HTMLInputElement;
    name.value = '  My scale ';
    name.dispatchEvent(new Event('input'));
    await type('Label of grade 1', 'Pass');
    await type('Minimum score of grade 1', '49.5');
    await type('Points of grade 1', '1');
    await type('Label of grade 2', 'Fail');
    await type('Minimum score of grade 2', '0');
    await submit();

    expect(api.calls[0]?.data).toEqual({
      name: 'My scale',
      type: 'PERCENTAGE',
      description: null,
      boundaries: [
        { label: 'Pass', descriptor: null, minScore: 49.5, points: 1 },
        { label: 'Fail', descriptor: null, minScore: 0, points: null },
      ],
    });
    expect(last(wrapper.emitted('update:open'))).toEqual([false]);
  });

  it('shows the server’s explanation when the scheme is rejected and stays open', async () => {
    await signInAs(['settings:manage']);
    fakeApi({
      'POST /grading-schemes': () =>
        fail(
          400,
          'INVALID_GRADING_SCHEME',
          'The lowest grade must start at 0 so that every score has a grade.',
        ),
    });
    const wrapper = await openModal();
    const name = document.body.querySelector<HTMLInputElement>(
      '[data-autofocus]',
    ) as HTMLInputElement;
    name.value = 'My scale';
    name.dispatchEvent(new Event('input'));
    await type('Label of grade 1', 'A');
    await type('Minimum score of grade 1', '80');
    await type('Label of grade 2', 'B');
    await type('Minimum score of grade 2', '40');

    await submit();

    expect(formError()).toBe('The lowest grade must start at 0 so that every score has a grade.');
    expect(wrapper.emitted('update:open')).toBeUndefined();
  });

  it('loads an existing scheme for editing and saves it with PUT', async () => {
    await signInAs(['settings:manage']);
    const scheme: GradingScheme = {
      id: 'scheme-9',
      name: 'Old scale',
      type: 'PERCENTAGE',
      description: 'Legacy',
      isDefault: false,
      classCount: 0,
      boundaries: [
        { id: 'b1', label: 'P', descriptor: 'Pass', minScore: 40, upperLimit: null, points: null },
        { id: 'b2', label: 'F', descriptor: null, minScore: 0, upperLimit: 40, points: null },
      ],
    };
    const api = fakeApi({ 'PUT /grading-schemes/scheme-9': () => ok(scheme) });
    await openModal(scheme);

    expect(field('Label of grade 1').value).toBe('P');
    expect(field('Minimum score of grade 1').value).toBe('40');
    expect(document.body.textContent).not.toContain('Start from');

    await submit();
    expect(api.calls[0]?.method).toBe('PUT');
  });
});

describe('SubjectsView', () => {
  const subjects = [
    { id: 'sub-1', name: 'Mathematics', code: 'MAT', isActive: true, classCount: 3 },
    { id: 'sub-2', name: 'Latin', code: 'LAT', isActive: false, classCount: 0 },
  ];

  async function mountView() {
    const wrapper = mount(SubjectsView, {
      global: { plugins: plugins() },
      attachTo: document.body,
    });
    await vi.waitFor(() => expect(wrapper.text()).toContain('Mathematics'));
    return wrapper;
  }

  it('lists subjects with their status, read-only without the manage permission', async () => {
    await signInAs(['subjects:read']);
    fakeApi({ 'GET /subjects': () => ok(subjects) });

    const wrapper = await mountView();

    expect(wrapper.findAll('tbody tr').map((row) => row.text())).toEqual([
      expect.stringMatching(/Mathematics\s*MAT\s*3\s*Active/),
      expect.stringMatching(/Latin\s*LAT\s*0\s*Inactive/),
    ]);
    expect(wrapper.text()).not.toContain('Add subject');
    expect(wrapper.find('[aria-label="Edit Mathematics"]').exists()).toBe(false);
  });

  it('offers add, edit and delete to managers', async () => {
    await signInAs(['subjects:read', 'subjects:manage']);
    fakeApi({ 'GET /subjects': () => ok(subjects) });

    const wrapper = await mountView();

    expect(wrapper.text()).toContain('Add subject');
    expect(wrapper.find('[aria-label="Edit Mathematics"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Delete Latin"]').exists()).toBe(true);
  });

  it('deletes after confirmation and refreshes the list', async () => {
    await signInAs(['subjects:read', 'subjects:manage']);
    let remaining = subjects;
    const api = fakeApi({
      'GET /subjects': () => ok(remaining),
      'DELETE /subjects/sub-2': () => {
        remaining = subjects.slice(0, 1);
        return noContent();
      },
    });
    const wrapper = await mountView();

    await wrapper.get('[aria-label="Delete Latin"]').trigger('click');
    await flushPromises();
    expect(api.calls.some((call) => call.method === 'DELETE')).toBe(false);

    document.body.querySelector<HTMLElement>('[data-testid="confirm-action"]')?.click();
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('Latin'));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('explains why a subject in use cannot be deleted and keeps the dialog open', async () => {
    await signInAs(['subjects:read', 'subjects:manage']);
    fakeApi({
      'GET /subjects': () => ok(subjects),
      'DELETE /subjects/sub-1': () =>
        fail(409, 'IN_USE', 'This subject is taught in one or more classes and cannot be deleted.'),
    });
    const wrapper = await mountView();

    await wrapper.get('[aria-label="Delete Mathematics"]').trigger('click');
    await flushPromises();
    document.body.querySelector<HTMLElement>('[data-testid="confirm-action"]')?.click();

    await vi.waitFor(() =>
      expect(document.body.querySelector('[data-testid="confirm-error"]')?.textContent).toContain(
        'taught in one or more classes',
      ),
    );
    expect(wrapper.text()).toContain('Mathematics');
  });

  it('shows an error state with a retry when loading fails', async () => {
    await signInAs(['subjects:read']);
    fakeApi({ 'GET /subjects': () => 'network-error' });
    const wrapper = mount(SubjectsView, { global: { plugins: plugins() } });

    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').exists()).toBe(true));
    expect(wrapper.get('[role="alert"]').text()).toContain('Unable to reach the server');
  });
});
