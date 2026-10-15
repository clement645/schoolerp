import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import type { ResolvedNavigationGroup } from '@/navigation/navigation';
import { useLayoutStore } from '@/stores/layout';
import AppShell from '../AppShell.vue';
import AppSidebar from '../AppSidebar.vue';
import GlobalSearch from '../GlobalSearch.vue';
import NotificationsMenu from '../NotificationsMenu.vue';
import UserMenu from '../UserMenu.vue';

const Icon = { render: () => null };
const Page = { template: '<p data-testid="page">page</p>' };

const groups: ResolvedNavigationGroup[] = [
  {
    id: 'academics',
    label: 'Academics',
    items: [
      { label: 'Students', routeName: 'students', icon: Icon, available: true },
      { label: 'Teachers', routeName: 'teachers', icon: Icon, available: false },
    ],
  },
  {
    id: 'administration',
    label: 'Administration',
    items: [{ label: 'System Status', routeName: 'system-status', icon: Icon, available: true }],
  },
];

function createTestRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/students', name: 'students', component: Page },
      { path: '/system/status', name: 'system-status', component: Page },
    ],
  });
}

/** Makes `window.matchMedia` report a viewport of the given width. */
function setViewport(width: number): void {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    const matches = (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
    return {
      matches,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    };
  });
}

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('AppSidebar', () => {
  async function mountSidebar(props: Record<string, unknown> = {}) {
    const router = createTestRouter();
    await router.push('/students');
    await router.isReady();
    return mount(AppSidebar, { props: { groups, ...props }, global: { plugins: [router] } });
  }

  it('links available sections and highlights the current one', async () => {
    const wrapper = await mountSidebar();
    const links = wrapper.findAll('a');

    expect(links.map((link) => link.text())).toEqual(['Students', 'System Status']);
    expect(links[0]?.attributes('aria-current')).toBe('page');
    expect(links[1]?.attributes('aria-current')).toBeUndefined();
  });

  it('keeps a section highlighted on its detail pages, but not on look-alike paths', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/students', name: 'students', component: Page },
        { path: '/students/:id', name: 'student-profile', component: Page },
        { path: '/students-archive', name: 'archive', component: Page },
        { path: '/system/status', name: 'system-status', component: Page },
      ],
    });
    const current = (wrapper: ReturnType<typeof mount>) =>
      wrapper.findAll('[aria-current="page"]').map((link) => link.text());

    await router.push('/students/abc');
    await router.isReady();
    const wrapper = mount(AppSidebar, { props: { groups }, global: { plugins: [router] } });
    expect(current(wrapper)).toEqual(['Students']);

    await router.push('/students-archive');
    await flushPromises();
    expect(current(wrapper)).toEqual([]);
  });

  it('shows unbuilt sections as disabled, not as links', async () => {
    const wrapper = await mountSidebar();
    const disabled = wrapper.get('[aria-disabled="true"]');

    expect(disabled.text()).toContain('Teachers');
    expect(disabled.text()).toContain('Soon');
    expect(disabled.element.tagName).not.toBe('A');
  });

  it('collapses and expands a group', async () => {
    const wrapper = await mountSidebar();
    const heading = wrapper.get('[data-testid="nav-group-academics"] button');
    const list = wrapper.get('#nav-group-items-academics');

    expect(heading.attributes('aria-expanded')).toBe('true');

    await heading.trigger('click');
    expect(heading.attributes('aria-expanded')).toBe('false');
    expect(list.isVisible()).toBe(false);
    expect(useLayoutStore().collapsedGroups).toEqual(['academics']);

    await heading.trigger('click');
    expect(heading.attributes('aria-expanded')).toBe('true');
  });

  it('keeps labels available to assistive technology in the icon rail', async () => {
    const wrapper = await mountSidebar({ collapsed: true });
    const link = wrapper.get('a');

    expect(wrapper.find('[data-testid="nav-group-academics"] button').exists()).toBe(false);
    expect(link.attributes('title')).toBe('Students');
    expect(link.get('span').classes()).toContain('sr-only');
  });

  it('shows the school footer only when a school is known', async () => {
    const without = await mountSidebar();
    const withSchool = await mountSidebar({
      school: { name: 'Example Academy', plan: 'Professional Plan' },
    });

    expect(without.find('[data-testid="sidebar-school"]').exists()).toBe(false);
    expect(withSchool.get('[data-testid="sidebar-school"]').text()).toContain('Professional Plan');
  });

  it('announces navigation so the mobile drawer can close', async () => {
    const wrapper = await mountSidebar();

    await wrapper.findAll('a')[1]?.trigger('click');

    expect(wrapper.emitted('navigate')).toHaveLength(1);
  });
});

describe('UserMenu', () => {
  it('shows a signed-out state without a menu when there is no user', () => {
    const wrapper = mount(UserMenu, { props: { user: null } });

    expect(wrapper.get('[data-testid="user-signed-out"]').text()).toContain('Not signed in');
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('shows the name, role and initials, and emits menu actions', async () => {
    const wrapper = mount(UserMenu, {
      props: { user: { name: 'amina wanjiru otieno', role: 'School Administrator' } },
    });

    expect(wrapper.text()).toContain('AW');
    expect(wrapper.text()).toContain('School Administrator');
    expect(wrapper.text()).not.toContain('Sign out');

    await wrapper.get('button[aria-haspopup="true"]').trigger('click');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Sign out')
      ?.trigger('click');

    expect(wrapper.emitted('sign-out')).toHaveLength(1);
    expect(wrapper.text()).not.toContain('Sign out');
  });

  it('closes on Escape', async () => {
    const wrapper = mount(UserMenu, {
      props: { user: { name: 'Amina Otieno', role: 'Teacher' } },
      attachTo: document.body,
    });
    const trigger = wrapper.get('button[aria-haspopup="true"]');

    await trigger.trigger('click');
    expect(trigger.attributes('aria-expanded')).toBe('true');

    await trigger.trigger('keydown', { key: 'Escape' });
    expect(trigger.attributes('aria-expanded')).toBe('false');
  });
});

describe('NotificationsMenu', () => {
  it('shows an empty state and no unread marker without notifications', async () => {
    const wrapper = mount(NotificationsMenu, { props: { notifications: [] } });

    expect(wrapper.find('[data-testid="notifications-unread-dot"]').exists()).toBe(false);

    await wrapper.get('button').trigger('click');
    expect(wrapper.text()).toContain('No notifications');
  });

  it('counts unread notifications and emits the selected one', async () => {
    const wrapper = mount(NotificationsMenu, {
      props: {
        notifications: [
          { id: 'n1', title: 'Results published', body: 'Term 3', time: '5 min ago', read: false },
          { id: 'n2', title: 'Fee received', body: 'KES 5,000', time: '1 h ago', read: true },
        ],
      },
    });
    const trigger = wrapper.get('button');

    expect(trigger.attributes('aria-label')).toBe('Notifications, 1 unread');
    expect(wrapper.find('[data-testid="notifications-unread-dot"]').exists()).toBe(true);

    await trigger.trigger('click');
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Fee received'))
      ?.trigger('click');

    expect(wrapper.emitted('select')).toEqual([['n2']]);
  });
});

describe('GlobalSearch', () => {
  async function mountSearch() {
    const router = createTestRouter();
    await router.push('/students');
    await router.isReady();
    const wrapper = mount(GlobalSearch, {
      props: { groups },
      global: { plugins: [router] },
      attachTo: document.body,
    });
    return { wrapper, router };
  }

  const input = () => document.body.querySelector<HTMLInputElement>('input[type="search"]');
  const options = () =>
    [...document.body.querySelectorAll('[role="option"] span:first-of-type')].map(
      (label) => label.textContent,
    );

  async function type(value: string): Promise<void> {
    const field = input();
    if (!field) throw new Error('search input is not rendered');
    field.value = value;
    field.dispatchEvent(new Event('input'));
    await flushPromises();
  }

  it('opens with Ctrl+K and lists reachable sections only', async () => {
    await mountSearch();
    expect(input()).toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await flushPromises();

    expect(document.activeElement).toBe(input());
    expect(options()).toEqual(['Students', 'System Status']);
  });

  it('filters as the user types and navigates with the keyboard', async () => {
    const { wrapper, router } = await mountSearch();
    await wrapper.get('[data-testid="global-search-trigger"]').trigger('click');
    await flushPromises();

    await type('status');
    expect(options()).toEqual(['System Status']);

    input()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('system-status');
    expect(input()).toBeNull();
  });

  it('moves the active option with the arrow keys and wraps around', async () => {
    const { wrapper } = await mountSearch();
    await wrapper.get('[data-testid="global-search-trigger"]').trigger('click');
    await flushPromises();
    const selected = () =>
      document.body.querySelector('[role="option"][aria-selected="true"]')?.textContent;

    expect(selected()).toContain('Students');

    input()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await flushPromises();
    expect(selected()).toContain('System Status');

    input()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await flushPromises();
    expect(selected()).toContain('Students');
  });

  it('shows an empty state when nothing matches', async () => {
    const { wrapper } = await mountSearch();
    await wrapper.get('[data-testid="global-search-trigger"]').trigger('click');
    await flushPromises();

    await type('zzz');

    expect(options()).toEqual([]);
    expect(document.body.textContent).toContain('No matching sections');
  });
});

describe('AppShell', () => {
  async function mountShell(width: number) {
    setViewport(width);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/',
          component: AppShell,
          children: [
            { path: 'system/status', name: 'system-status', component: Page },
            { path: 'other', name: 'other', component: Page },
          ],
        },
      ],
    });
    await router.push('/system/status');
    await router.isReady();
    const App = { template: '<RouterView />' };
    const wrapper = mount(App, {
      global: { plugins: [router, [VueQueryPlugin, { queryClient: new QueryClient() }]] },
      attachTo: document.body,
    });
    await flushPromises();
    return { wrapper, router };
  }

  const sidebarWidth = (wrapper: Awaited<ReturnType<typeof mountShell>>['wrapper']) =>
    wrapper.get('[data-testid="sidebar-desktop"]').classes();

  it('renders the page inside the shell with a signed-out topbar', async () => {
    const { wrapper } = await mountShell(1440);

    expect(wrapper.get('main [data-testid="page"]').text()).toBe('page');
    expect(wrapper.find('[data-testid="user-signed-out"]').exists()).toBe(true);
  });

  it('shows the full sidebar on desktop and lets the user collapse it', async () => {
    const { wrapper } = await mountShell(1440);
    const toggle = wrapper.get('[data-testid="navigation-toggle"]');

    expect(sidebarWidth(wrapper)).toContain('w-64');
    expect(toggle.attributes('aria-label')).toBe('Collapse sidebar');

    await toggle.trigger('click');

    expect(sidebarWidth(wrapper)).toContain('w-[4.5rem]');
    expect(toggle.attributes('aria-label')).toBe('Expand sidebar');
    expect(useLayoutStore().sidebarPreference).toBe('collapsed');
  });

  it('starts as an icon rail on tablets and can be expanded', async () => {
    const { wrapper } = await mountShell(900);

    expect(sidebarWidth(wrapper)).toContain('w-[4.5rem]');

    await wrapper.get('[data-testid="navigation-toggle"]').trigger('click');
    expect(sidebarWidth(wrapper)).toContain('w-64');
  });

  it('uses a drawer on phones that closes after navigating', async () => {
    const { wrapper, router } = await mountShell(390);
    const toggle = wrapper.get('[data-testid="navigation-toggle"]');

    expect(wrapper.find('[data-testid="sidebar-desktop"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="sidebar-drawer"]').exists()).toBe(false);
    expect(toggle.attributes('aria-label')).toBe('Open navigation');

    await toggle.trigger('click');
    expect(wrapper.find('[data-testid="sidebar-drawer"]').exists()).toBe(true);

    await router.push('/other');
    await flushPromises();
    expect(wrapper.find('[data-testid="sidebar-drawer"]').exists()).toBe(false);
  });

  it('closes the drawer when the backdrop is clicked', async () => {
    const { wrapper } = await mountShell(390);

    await wrapper.get('[data-testid="navigation-toggle"]').trigger('click');
    await wrapper.get('[data-testid="sidebar-drawer"]').trigger('click');

    expect(wrapper.find('[data-testid="sidebar-drawer"]').exists()).toBe(false);
  });
});
