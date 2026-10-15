import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { configureHttpAuth } from '@/services/http';
import { fakeApi, ok, restoreApi, session } from '@/services/__tests__/fake-api';
import { useAuthStore } from '@/stores/auth';
import { ageOn, formatDate } from '@/utils/format';
import ImportStudentsModal from '../ImportStudentsModal.vue';
import StudentsView from '../StudentsView.vue';
import { fullName, hasLeft, IMPORT_COLUMNS } from '../students.service';

const student = (overrides: Record<string, unknown> = {}) => ({
  id: 'stu-1',
  admissionNumber: 'ADM-0001',
  firstName: 'Amina',
  middleName: 'Wanjiru',
  lastName: 'Otieno',
  gender: 'FEMALE',
  dateOfBirth: '2013-04-17',
  admissionDate: '2026-01-05',
  status: 'ACTIVE',
  hasPhoto: false,
  class: { id: 'g7', name: 'Grade 7' },
  stream: { id: 'east', name: 'East' },
  ...overrides,
});
const page = (items: unknown[]) => ({ items, page: 1, pageSize: 25, total: items.length });

async function signInAs(permissions: string[]) {
  fakeApi({ 'POST /auth/login': () => ok(session('token-1', { permissions })) });
  const auth = useAuthStore();
  await auth.login('amina@school.example', 'a-long-passphrase');
  configureHttpAuth({
    getAccessToken: () => auth.accessToken,
    getSchoolId: () => 'school-1',
    refresh: () => auth.refresh(),
    onSessionLost: () => undefined,
    onPasswordChangeRequired: () => undefined,
  });
}

const plugins = () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/students/:id', name: 'student-profile', component: { template: '<div />' } },
    ],
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return [router, [VueQueryPlugin, { queryClient }]] as never;
};

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

describe('student helpers', () => {
  it('builds a full name, skipping a missing middle name', () => {
    expect(fullName({ firstName: 'Amina', middleName: 'Wanjiru', lastName: 'Otieno' })).toBe(
      'Amina Wanjiru Otieno',
    );
    expect(fullName({ firstName: 'Brian', middleName: null, lastName: 'Kiptoo' })).toBe(
      'Brian Kiptoo',
    );
  });

  it('knows which statuses mean the student has left', () => {
    expect(['ACTIVE', 'SUSPENDED'].map((s) => hasLeft(s as never))).toEqual([false, false]);
    expect(['TRANSFERRED', 'WITHDRAWN', 'GRADUATED'].map((s) => hasLeft(s as never))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('computes age in whole years, turning over on the birthday', () => {
    expect(ageOn('2013-04-17', '2026-04-16')).toBe(12);
    expect(ageOn('2013-04-17', '2026-04-17')).toBe(13);
    expect(ageOn('2012-02-29', '2025-02-28')).toBe(12);
    expect(ageOn('not-a-date')).toBeNull();
  });

  it('formats calendar dates without shifting the day', () => {
    expect(formatDate('2026-01-05')).toMatch(/5/);
    expect(formatDate('2026-01-05')).toMatch(/2026/);
    expect(formatDate(null)).toBe('—');
    expect(formatDate('garbage')).toBe('—');
  });
});

describe('StudentsView', () => {
  const routes = (items: unknown[]) => ({
    'GET /students': () => ok(page(items)),
    'GET /classes': () => ok([]),
  });

  it('lists students and offers every action to a manager', async () => {
    await signInAs(['students:read', 'students:manage', 'records:all_classes']);
    fakeApi(
      routes([
        student(),
        student({ id: 'stu-2', firstName: 'Brian', middleName: null, status: 'SUSPENDED' }),
      ]),
    );

    const wrapper = mount(StudentsView, { global: { plugins: plugins() } });
    await vi.waitFor(() => expect(wrapper.text()).toContain('Amina Wanjiru Otieno'));

    expect(wrapper.text()).toContain('Everyone enrolled at the school');
    expect(wrapper.text()).toContain('Grade 7');
    expect(wrapper.text()).toContain('Suspended');
    for (const label of ['Export', 'Import', 'Promote', 'Admit student']) {
      expect(wrapper.text()).toContain(label);
    }
    expect(wrapper.get('a').attributes('href')).toBe('/students/stu-1');
  });

  it('shows a teacher only export, and explains the narrower list', async () => {
    await signInAs(['students:read']);
    fakeApi(routes([student()]));

    const wrapper = mount(StudentsView, { global: { plugins: plugins() } });
    await vi.waitFor(() => expect(wrapper.text()).toContain('Amina'));

    expect(wrapper.text()).toContain('classes you are assigned to');
    expect(wrapper.text()).toContain('Export');
    for (const label of ['Import', 'Promote', 'Admit student']) {
      expect(wrapper.text()).not.toContain(label);
    }
  });

  it('asks for active students by name first, and sends changed filters', async () => {
    await signInAs(['students:read', 'records:all_classes']);
    const api = fakeApi(routes([student()]));

    const wrapper = mount(StudentsView, { global: { plugins: plugins() } });
    await vi.waitFor(() => expect(wrapper.text()).toContain('Amina'));
    const first = api.calls.find((call) => call.url === '/students');
    expect(first?.params).toEqual({
      status: 'ACTIVE',
      sort: 'name',
      order: 'asc',
      page: 1,
      pageSize: 25,
    });

    await wrapper.get('[aria-label="Filter by status"]').setValue('all');
    await wrapper.get('th button').trigger('click');
    await vi.waitFor(() => {
      const requests = api.calls.filter((call) => call.url === '/students');
      const last = requests[requests.length - 1];
      expect(last?.params).toMatchObject({ sort: 'name', order: 'desc' });
      expect(last?.params).not.toHaveProperty('status');
    });
  });

  it('tells a teacher with no assignments why the list is empty', async () => {
    await signInAs(['students:read']);
    fakeApi(routes([]));

    const wrapper = mount(StudentsView, { global: { plugins: plugins() } });

    await vi.waitFor(() =>
      expect(wrapper.text()).toContain(
        'You have no class assignments for the current academic year.',
      ),
    );
  });
});

describe('ImportStudentsModal', () => {
  const csv = (name = 'class-list.csv', size?: number) => {
    const file = new File([`${IMPORT_COLUMNS.join(',')}\nrow`], name, { type: 'text/csv' });
    if (size) Object.defineProperty(file, 'size', { value: size });
    return file;
  };

  async function openModal() {
    const wrapper = mount(ImportStudentsModal, {
      props: { open: false },
      global: { plugins: plugins() },
      attachTo: document.body,
    });
    await wrapper.setProps({ open: true });
    await flushPromises();
    return wrapper;
  }
  async function choose(file: File) {
    const input = document.body.querySelector<HTMLInputElement>(
      '[data-testid="import-file"]',
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await flushPromises();
  }
  const find = (testId: string) =>
    document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

  it('checks the chosen file first and imports only after confirmation', async () => {
    await signInAs(['students:manage']);
    const api = fakeApi({
      'POST /students/import': (call) =>
        ok({
          imported: !(call.params as { dryRun?: boolean }).dryRun,
          valid: 3,
          problems: [],
          problemsTruncated: false,
        }),
    });
    await openModal();
    expect((find('import-confirm') as HTMLButtonElement).disabled).toBe(true);

    await choose(csv());
    await vi.waitFor(() =>
      expect(find('import-ready')?.textContent).toContain('3 students are ready'),
    );
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.params).toEqual({ dryRun: true });

    find('import-confirm')?.click();
    await vi.waitFor(() =>
      expect(find('import-done')?.textContent).toContain('3 students were imported'),
    );
    expect(api.calls[1]?.params).toEqual({});
  });

  it('lists the problems and keeps the import button disabled', async () => {
    await signInAs(['students:manage']);
    fakeApi({
      'POST /students/import': () =>
        ok({
          imported: false,
          valid: 1,
          problems: [{ row: 3, message: 'Class "Grade 99" does not exist.' }],
          problemsTruncated: false,
        }),
    });
    await openModal();

    await choose(csv());

    await vi.waitFor(() => expect(find('import-problems')).not.toBeNull());
    expect(document.body.textContent).toContain('Nothing has been imported');
    expect(document.body.textContent).toContain('Class "Grade 99" does not exist.');
    expect((find('import-confirm') as HTMLButtonElement).disabled).toBe(true);
  });

  it('rejects the wrong file type and oversized files without uploading them', async () => {
    await signInAs(['students:manage']);
    const api = fakeApi({});
    await openModal();

    await choose(csv('class-list.xlsx'));
    expect(find('import-error')?.textContent).toContain('Choose a CSV file');

    await choose(csv('class-list.csv', 2_000_000));
    expect(find('import-error')?.textContent).toContain('larger than 1 MB');
    expect(api.calls).toHaveLength(0);
  });
});
