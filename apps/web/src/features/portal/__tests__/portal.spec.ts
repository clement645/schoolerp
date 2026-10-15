import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { configureHttpAuth } from '@/services/http';
import { fail, fakeApi, ok, restoreApi, session } from '@/services/__tests__/fake-api';
import { useAuthStore } from '@/stores/auth';
import PortalAccountsPanel from '../PortalAccountsPanel.vue';
import PortalChildView from '../PortalChildView.vue';
import PortalHomeView from '../PortalHomeView.vue';

const CHILD = {
  id: 's1',
  name: 'Amina Otieno',
  admissionNumber: 'ADM-0001',
  class: 'Grade 7',
  stream: 'East',
  status: 'ACTIVE',
  relationship: 'MOTHER',
};
const OVERVIEW = {
  child: CHILD,
  attendance: { rate: 95, present: 19, absent: 1, late: 0, excused: 0 },
  fees: { currency: 'KES', balance: 18000, overdue: 5000 },
  latestResult: {
    examinationId: 'e1',
    examination: 'Mid-term',
    term: 'Term 2',
    academicYear: '2026',
    publishedAt: '2026-07-01T08:00:00.000Z',
    average: 88,
    grade: 'A',
    subjectsSat: 5,
  },
};
const INVOICE = {
  id: 'inv-1',
  number: 'INV-2026-000001',
  student: { id: 's1', name: 'Amina Otieno', admissionNumber: 'ADM-0001' },
  class: 'Grade 7',
  term: 'Term 2',
  issueDate: '2026-05-04',
  dueDate: '2026-06-01',
  status: 'PARTIALLY_PAID',
  isOverdue: true,
  total: 30000,
  paid: 12000,
  credited: 0,
  balance: 18000,
};
const FEES = {
  statement: {
    student: { id: 's1', name: 'Amina Otieno', admissionNumber: 'ADM-0001', class: 'Grade 7' },
    currency: 'KES',
    from: null,
    to: null,
    openingBalance: 0,
    closingBalance: 18000,
    totals: { invoiced: 30000, paid: 12000, credited: 0, refunded: 0 },
    lines: [
      {
        date: '2026-05-04',
        kind: 'INVOICE',
        reference: 'INV-2026-000001',
        description: 'Fees',
        debit: 30000,
        credit: 0,
        balance: 30000,
      },
      {
        date: '2026-05-20',
        kind: 'PAYMENT',
        reference: 'RCT-2026-000001',
        description: 'Cash',
        debit: 0,
        credit: 12000,
        balance: 18000,
      },
    ],
  },
  outstanding: [INVOICE],
};

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
  await useAuthStore().login('grace@example.com', 'a-long-passphrase');
}
async function mountAt(component: object, path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/portal', name: 'portal', component: PortalHomeView },
      { path: '/portal/children/:id', name: 'portal-child', component: PortalChildView },
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

describe('PortalHomeView', () => {
  it('lists a parent’s children', async () => {
    await signInAs(['portal:parent']);
    fakeApi({
      'GET /portal/children': () => ok([CHILD, { ...CHILD, id: 's2', name: 'Brian Otieno' }]),
    });
    const { wrapper } = await mountAt(PortalHomeView, '/portal');
    await vi.waitFor(() => expect(wrapper.findAll('li')).toHaveLength(2));
    expect(wrapper.text()).toContain('My Children');
    expect(wrapper.text()).toContain('Brian Otieno');
    wrapper.unmount();
  });

  it('goes straight to the record when there is only one', async () => {
    await signInAs(['portal:student']);
    fakeApi({ 'GET /portal/children': () => ok([CHILD]) });
    const { wrapper, router } = await mountAt(PortalHomeView, '/portal');
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('portal-child'));
    expect(router.currentRoute.value.params.id).toBe('s1');
    wrapper.unmount();
  });

  it('explains what to do when nothing is linked', async () => {
    await signInAs(['portal:parent']);
    fakeApi({ 'GET /portal/children': () => ok([]) });
    const { wrapper } = await mountAt(PortalHomeView, '/portal');
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('No children are linked to your account'),
    );
    wrapper.unmount();
  });
});

describe('PortalChildView', () => {
  it('summarises results, attendance and fees', async () => {
    await signInAs(['portal:parent']);
    fakeApi({ 'GET /portal/children/s1': () => ok(OVERVIEW) });
    const { wrapper } = await mountAt(PortalChildView, '/portal/children/s1');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Amina Otieno'));
    const text = wrapper.text();
    expect(text).toContain('88 · A');
    expect(text).toContain('95%');
    expect(text).toMatch(/KES\s?18,000\.00/);
    expect(text).toMatch(/KES\s?5,000\.00 overdue/);
    wrapper.unmount();
  });

  it('offers M-Pesa to a parent only when the school has it set up', async () => {
    await signInAs(['portal:parent']);
    fakeApi({
      'GET /portal/children/s1': () => ok(OVERVIEW),
      'GET /portal/children/s1/fees': () => ok(FEES),
      'GET /portal/mpesa/config': () => ok({ configured: false, environment: 'sandbox' }),
    });
    const { wrapper } = await mountAt(PortalChildView, '/portal/children/s1?tab=fees');
    await vi.waitFor(() => expect(wrapper.text()).toContain('INV-2026-000001'));
    await vi.waitFor(() => expect(wrapper.text()).toContain('Online payment is not available'));
    expect(wrapper.text()).not.toContain('Pay by M-Pesa');
    expect(wrapper.findAll('tbody tr')).toHaveLength(2);
    wrapper.unmount();
  });

  it('does not offer payment to a student', async () => {
    await signInAs(['portal:student']);
    const api = fakeApi({
      'GET /portal/children/s1': () => ok(OVERVIEW),
      'GET /portal/children/s1/fees': () => ok(FEES),
    });
    const { wrapper } = await mountAt(PortalChildView, '/portal/children/s1?tab=fees');
    await vi.waitFor(() => expect(wrapper.text()).toContain('INV-2026-000001'));
    expect(wrapper.text()).not.toContain('Pay by M-Pesa');
    expect(api.calls.some((call) => call.url === '/portal/mpesa/config')).toBe(false);
    wrapper.unmount();
  });

  it('says so when the record is not theirs', async () => {
    await signInAs(['portal:parent']);
    fakeApi({
      'GET /portal/children/s9': () => fail(404, 'STUDENT_NOT_FOUND', 'Student not found.'),
    });
    const { wrapper } = await mountAt(PortalChildView, '/portal/children/s9');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Record not found'));
    wrapper.unmount();
  });
});

describe('PortalAccountsPanel', () => {
  const ACCOUNTS = {
    student: { email: null },
    guardians: [
      {
        guardianId: 'g1',
        name: 'Grace Otieno',
        relationship: 'MOTHER',
        email: 'grace@example.com',
      },
    ],
  };
  const mountPanel = (canManage: boolean) =>
    mount(PortalAccountsPanel, {
      props: { studentId: 's1', canManage },
      global: { plugins: [plugins() as never] },
      attachTo: document.body,
    });

  it('shows who has access and lets an administrator remove it', async () => {
    const api = fakeApi({
      'GET /students/s1/portal-accounts': () => ok(ACCOUNTS),
      'PUT /students/s1/portal-accounts/guardians/g1': () =>
        ok({ ...ACCOUNTS, guardians: [{ ...ACCOUNTS.guardians[0], email: null }] }),
    });
    const panel = mountPanel(true);
    await vi.waitFor(() => expect(panel.findAll('li')).toHaveLength(2));
    expect(panel.text()).toContain('Signs in as grace@example.com');

    await panel.find('[aria-label="Remove portal access for Grace Otieno"]').trigger('click');
    await vi.waitFor(() => expect(panel.text()).not.toContain('grace@example.com'));
    expect(api.calls.find((call) => call.method === 'PUT')?.data).toEqual({ email: null });
    panel.unmount();
  });

  it('shows the server’s reason when an account cannot be linked', async () => {
    fakeApi({
      'GET /students/s1/portal-accounts': () => ok(ACCOUNTS),
      'PUT /students/s1/portal-accounts/student': () =>
        fail(400, 'WRONG_ROLE', 'That account does not have the Student role.'),
    });
    const panel = mountPanel(true);
    await vi.waitFor(() => expect(panel.findAll('li')).toHaveLength(2));
    await panel.find('[aria-label="Link an account for The learner"]').trigger('click');
    await vi.waitFor(() => expect(document.querySelector('#link-account-form')).toBeTruthy());

    const input = document.querySelector<HTMLInputElement>('#link-account-form input');
    if (input) {
      input.value = 'teacher@example.com';
      input.dispatchEvent(new Event('input'));
    }
    document.querySelector('#link-account-form')?.dispatchEvent(new Event('submit'));
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('does not have the Student role'),
    );
    panel.unmount();
  });

  it('is read-only without permission to manage accounts', async () => {
    fakeApi({ 'GET /students/s1/portal-accounts': () => ok(ACCOUNTS) });
    const panel = mountPanel(false);
    await vi.waitFor(() => expect(panel.findAll('li')).toHaveLength(2));
    expect(panel.findAll('button')).toHaveLength(0);
    panel.unmount();
  });
});
