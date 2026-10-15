import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { fail, fakeApi, ok, restoreApi, session } from '@/services/__tests__/fake-api';
import { useAuthStore } from '@/stores/auth';
import LoginView from '../LoginView.vue';

const Page = { template: '<p>page</p>' };

async function mountLogin(path = '/login') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: LoginView },
      { path: '/', name: 'home', component: Page },
      { path: '/audit-logs', name: 'audit-logs', component: Page },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(LoginView, { global: { plugins: [router] } });
  return { wrapper, router };
}

type Mounted = Awaited<ReturnType<typeof mountLogin>>['wrapper'];

/**
 * Fills in and submits the form, then waits until `settled` stops throwing.
 * Validation, the request and the navigation all complete asynchronously
 * (VeeValidate also uses timers), so a fixed number of ticks is not reliable.
 */
async function submit(
  wrapper: Mounted,
  email: string,
  password: string,
  settled: () => void,
): Promise<void> {
  await wrapper.get('input[type="email"]').setValue(email);
  await wrapper.get('input[type="password"]').setValue(password);
  await wrapper.get('form').trigger('submit');
  await vi.waitFor(settled);
  await flushPromises();
}

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    restoreApi();
  });

  it('validates the form without calling the API', async () => {
    const api = fakeApi({});
    const { wrapper } = await mountLogin();

    await submit(wrapper, 'not-an-email', '', () =>
      expect(wrapper.text()).toContain('Enter a valid email address.'),
    );

    expect(wrapper.text()).toContain('Enter your password.');
    expect(api.calls).toHaveLength(0);
  });

  it('signs in and goes to the home page', async () => {
    fakeApi({ 'POST /auth/login': () => ok(session()) });
    const { wrapper, router } = await mountLogin();

    await submit(wrapper, 'amina@school.example', 'a-long-passphrase', () =>
      expect(router.currentRoute.value.name).toBe('home'),
    );

    expect(useAuthStore().isAuthenticated).toBe(true);
  });

  it('returns the user to the page they originally asked for', async () => {
    fakeApi({ 'POST /auth/login': () => ok(session()) });
    const { wrapper, router } = await mountLogin('/login?redirect=/audit-logs');

    await submit(wrapper, 'amina@school.example', 'a-long-passphrase', () =>
      expect(router.currentRoute.value.name).toBe('audit-logs'),
    );
  });

  it('ignores a redirect that points at another site', async () => {
    fakeApi({ 'POST /auth/login': () => ok(session()) });
    const { wrapper, router } = await mountLogin('/login?redirect=//evil.example/phish');

    await submit(wrapper, 'amina@school.example', 'a-long-passphrase', () =>
      expect(router.currentRoute.value.name).toBe('home'),
    );
  });

  it('shows the server’s message when sign-in is rejected and keeps the email', async () => {
    fakeApi({
      'POST /auth/login': () => fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password.'),
    });
    const { wrapper, router } = await mountLogin();

    await submit(wrapper, 'amina@school.example', 'wrong-password', () =>
      expect(wrapper.find('[data-testid="login-error"]').exists()).toBe(true),
    );

    expect(wrapper.get('[data-testid="login-error"]').text()).toBe('Invalid email or password.');
    expect(router.currentRoute.value.name).toBe('login');
    expect((wrapper.get('input[type="email"]').element as HTMLInputElement).value).toBe(
      'amina@school.example',
    );
  });

  it('explains when the server cannot be reached', async () => {
    fakeApi({ 'POST /auth/login': () => 'network-error' });
    const { wrapper } = await mountLogin();

    await submit(wrapper, 'amina@school.example', 'a-long-passphrase', () =>
      expect(wrapper.find('[data-testid="login-error"]').exists()).toBe(true),
    );

    expect(wrapper.get('[data-testid="login-error"]').text()).toContain(
      'Unable to reach the server',
    );
  });

  it('tells a user whose session expired why they are here', async () => {
    const { wrapper } = await mountLogin('/login?reason=expired');

    expect(wrapper.text()).toContain('Your session has expired');
  });
});
