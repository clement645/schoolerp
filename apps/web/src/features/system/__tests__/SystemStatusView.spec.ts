import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { AxiosError, type AxiosAdapter, type AxiosResponse } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';
import { http } from '@/services/http';
import SystemStatusView from '../SystemStatusView.vue';

const originalAdapter = http.defaults.adapter;
const meta = {
  requestId: 'd3b0c7f4-0000-4000-8000-000000000000',
  timestamp: '2026-10-13T00:00:00Z',
};

/** Replaces the network layer so the real axios → envelope → zod path runs. */
function respondWith(status: number, body: unknown): void {
  const adapter: AxiosAdapter = (config) => {
    const response: AxiosResponse = {
      data: body,
      status,
      statusText: '',
      headers: {},
      config,
    };
    return status >= 200 && status < 300
      ? Promise.resolve(response)
      : Promise.reject(
          new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, null, response),
        );
  };
  http.defaults.adapter = adapter;
}

function failNetwork(): void {
  http.defaults.adapter = (config) =>
    Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config));
}

async function mountView() {
  const queryClient = new QueryClient();
  const wrapper = mount(SystemStatusView, {
    global: { plugins: [[VueQueryPlugin, { queryClient }]] },
  });
  await flushPromises();
  return wrapper;
}

const stateOf = (wrapper: Awaited<ReturnType<typeof mountView>>, service: string) =>
  wrapper.get(`[data-testid="service-${service}"] [data-testid="service-state"]`).text();

describe('SystemStatusView', () => {
  afterEach(() => {
    http.defaults.adapter = originalAdapter;
  });

  it('shows a loading state before the first check completes', () => {
    http.defaults.adapter = () => new Promise(() => undefined);
    const wrapper = mount(SystemStatusView, {
      global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] },
    });

    expect(wrapper.find('[data-testid="status-loading"]').exists()).toBe(true);
  });

  it('shows every service as operational when the API reports ok', async () => {
    respondWith(200, {
      success: true,
      data: {
        status: 'ok',
        uptimeSeconds: 125,
        checks: {
          database: { status: 'up', latencyMs: 3 },
          redis: { status: 'up', latencyMs: 1 },
          storage: { status: 'up', latencyMs: 4 },
        },
      },
      meta,
    });

    const wrapper = await mountView();

    expect(wrapper.get('[data-testid="overall-status"]').text()).toBe('All systems operational');
    expect(stateOf(wrapper, 'api')).toBe('Operational');
    expect(stateOf(wrapper, 'database')).toBe('Operational');
    expect(stateOf(wrapper, 'redis')).toBe('Operational');
    expect(wrapper.text()).toContain('Responded in 3 ms');
    expect(wrapper.text()).toContain('2m 5s');
  });

  it('shows which dependency is down when the API answers 503', async () => {
    respondWith(503, {
      success: false,
      error: {
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'One or more dependencies are unavailable.',
        details: {
          status: 'degraded',
          uptimeSeconds: 10,
          checks: {
            database: { status: 'down', latencyMs: null },
            redis: { status: 'up', latencyMs: 2 },
            storage: { status: 'up', latencyMs: 5 },
          },
        },
      },
      meta: { ...meta, path: '/api/v1/health' },
    });

    const wrapper = await mountView();

    expect(wrapper.get('[data-testid="overall-status"]').text()).toBe('Degraded');
    expect(stateOf(wrapper, 'api')).toBe('Operational');
    expect(stateOf(wrapper, 'database')).toBe('Unavailable');
    expect(stateOf(wrapper, 'redis')).toBe('Operational');
    expect(wrapper.find('[data-testid="status-error"]').exists()).toBe(false);
  });

  it('shows an error state when the API is unreachable', async () => {
    failNetwork();

    const wrapper = await mountView();

    expect(wrapper.get('[data-testid="overall-status"]').text()).toBe('API unreachable');
    expect(wrapper.get('[data-testid="status-error"]').text()).toContain(
      'Unable to reach the server',
    );
    expect(stateOf(wrapper, 'api')).toBe('Unavailable');
    expect(stateOf(wrapper, 'database')).toBe('Unknown');
  });

  it('treats a response that violates the API contract as an error', async () => {
    respondWith(200, { success: true, data: { status: 'fine' }, meta });

    const wrapper = await mountView();

    expect(wrapper.get('[data-testid="status-error"]').text()).toContain('unexpected response');
  });
});
