import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { http } from '@/services/http';
import type { Session, UserProfile } from '@/features/auth/auth.service';

const meta = { requestId: null, timestamp: '2026-10-13T00:00:00.000Z' };

export interface FakeReply {
  status: number;
  body?: unknown;
}

export const ok = (data: unknown, status = 200): FakeReply => ({
  status,
  body: { success: true, data, meta },
});

export const noContent = (): FakeReply => ({ status: 204 });

export const fail = (status: number, code: string, message = code): FakeReply => ({
  status,
  body: { success: false, error: { code, message }, meta: { ...meta, path: '/' } },
});

export interface RecordedCall {
  method: string;
  url: string;
  authorization: string | null;
  /** Value of the X-School-Id header, if sent. */
  schoolId: string | null;
  data: unknown;
  params: unknown;
}

type Handler = (call: RecordedCall) => FakeReply | 'network-error' | Promise<FakeReply>;

const originalAdapter = http.defaults.adapter;

/**
 * Replaces the network with scripted replies keyed by "METHOD /path", while
 * the real axios instance, interceptors and response validation still run.
 */
export function fakeApi(routes: Record<string, Handler>): { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];

  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const authorization: unknown = config.headers.get('Authorization');
    const schoolId: unknown = config.headers.get('X-School-Id');
    const call: RecordedCall = {
      method: (config.method ?? 'get').toUpperCase(),
      url: config.url ?? '',
      authorization: typeof authorization === 'string' ? authorization : null,
      schoolId: typeof schoolId === 'string' ? schoolId : null,
      data: typeof config.data === 'string' ? (JSON.parse(config.data) as unknown) : config.data,
      params: config.params,
    };
    calls.push(call);

    const handler = routes[`${call.method} ${call.url}`];
    if (!handler) throw new Error(`fakeApi: no handler for ${call.method} ${call.url}`);

    const reply = await handler(call);
    if (reply === 'network-error') {
      throw new AxiosError('Network Error', 'ERR_NETWORK', config);
    }
    const response: AxiosResponse = {
      data: reply.body,
      status: reply.status,
      statusText: '',
      headers: {},
      config,
    };
    if (reply.status >= 200 && reply.status < 300) return response;
    throw new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, null, response);
  };

  http.defaults.adapter = adapter;
  return { calls };
}

export function restoreApi(): void {
  http.defaults.adapter = originalAdapter;
}

export function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'user-1',
    email: 'amina@school.example',
    firstName: 'Amina',
    lastName: 'Otieno',
    mustChangePassword: false,
    roles: [{ key: 'SCHOOL_ADMIN', name: 'School Administrator' }],
    permissions: ['users:read', 'users:manage', 'roles:read', 'audit:read'],
    tenant: { id: 'tenant-1', name: 'Green Valley', plan: 'PROFESSIONAL' },
    schools: [{ id: 'school-1', name: 'Green Valley Academy' }],
    ...overrides,
  };
}

export function session(token = 'token-1', overrides: Partial<UserProfile> = {}): Session {
  return { accessToken: token, expiresInSeconds: 900, user: profile(overrides) };
}
