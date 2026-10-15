import axios, { type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import type { z } from 'zod';
import { env } from '@/config/env';
import { errorEnvelopeSchema, successEnvelopeSchema } from '@/types/api';

declare module 'axios' {
  interface AxiosRequestConfig {
    /**
     * Send without the access token and without the automatic
     * refresh-and-retry on 401. Used by the session endpoints themselves.
     */
    skipAuth?: boolean;
    /** Internal: marks a request that has already been retried once. */
    retriedAfterRefresh?: boolean;
  }
}

/** The single error type thrown by the API layer. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    /** HTTP status, or `null` when no response was received. */
    readonly status: number | null,
    readonly details?: unknown,
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export const http = axios.create({
  baseURL: env.apiBaseUrl,
  timeout: 15_000,
  headers: { Accept: 'application/json' },
  // The refresh cookie is same-origin in production and in development (via
  // the dev-server proxy); this also covers a deliberately split deployment.
  withCredentials: true,
});

export function toApiRequestError(error: unknown): ApiRequestError {
  if (error instanceof ApiRequestError) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return new ApiRequestError(
        'Unable to reach the server. Check your connection and try again.',
        error.code === 'ECONNABORTED' ? 'TIMEOUT' : 'NETWORK_ERROR',
        null,
      );
    }

    const envelope = errorEnvelopeSchema.safeParse(error.response.data);
    if (envelope.success) {
      const { error: apiError, meta } = envelope.data;
      return new ApiRequestError(
        apiError.message,
        apiError.code,
        error.response.status,
        apiError.details,
        meta.requestId,
      );
    }

    // Not our envelope: e.g. a proxy error page while the API is down.
    return new ApiRequestError(
      'The server returned an unexpected response.',
      'UNEXPECTED_RESPONSE',
      error.response.status,
    );
  }

  return new ApiRequestError('An unexpected error occurred.', 'UNKNOWN_ERROR', null);
}

/** A message that is always safe to show, whatever was thrown. */
export function errorMessage(error: unknown): string {
  return toApiRequestError(error).message;
}

export interface HttpAuthHooks {
  /** The current access token, if signed in. */
  getAccessToken: () => string | null;
  /** The school the user is working in, sent as `X-School-Id`. */
  getSchoolId: () => string | null;
  /** Tries to renew the session; resolves to whether it succeeded. */
  refresh: () => Promise<boolean>;
  /** The session is gone and could not be renewed. */
  onSessionLost: () => void;
  /** The API insists the temporary password be replaced first. */
  onPasswordChangeRequired: () => void;
}

let hooks: HttpAuthHooks | null = null;

/**
 * Connects the HTTP layer to the session. Supplied by the auth store, which
 * keeps this module free of a dependency on it.
 */
export function configureHttpAuth(next: HttpAuthHooks | null): void {
  hooks = next;
}

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = config.skipAuth ? null : hooks?.getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
    const schoolId = hooks?.getSchoolId();
    if (schoolId) config.headers.set('X-School-Id', schoolId);
  }
  return config;
});

http.interceptors.response.use(undefined, async (error: unknown) => {
  if (!axios.isAxiosError(error) || !error.config || !hooks || error.config.skipAuth) {
    throw error;
  }
  const apiError = toApiRequestError(error);

  if (apiError.status === 401 && !error.config.retriedAfterRefresh) {
    // The access token expired: renew the session once and replay.
    if (await hooks.refresh()) {
      return http.request({ ...error.config, retriedAfterRefresh: true });
    }
    hooks.onSessionLost();
  } else if (apiError.code === 'PASSWORD_CHANGE_REQUIRED') {
    hooks.onPasswordChangeRequired();
  }
  throw error;
});

/**
 * Sends a request and validates the response body against `schema`, so a
 * contract drift between API and web fails loudly instead of rendering junk.
 */
export async function apiRequest<T extends z.ZodType>(
  config: AxiosRequestConfig,
  schema: T,
): Promise<z.infer<T>> {
  try {
    const response = await http.request<unknown>(config);
    const envelope = successEnvelopeSchema.safeParse(response.data);
    const payload = envelope.success ? schema.safeParse(envelope.data.data) : envelope;
    if (!payload.success) {
      throw new ApiRequestError(
        'The server returned an unexpected response.',
        'UNEXPECTED_RESPONSE',
        response.status,
      );
    }
    return payload.data;
  } catch (error) {
    throw toApiRequestError(error);
  }
}

/** Sends a request whose response carries no body (204). */
export async function apiSend(config: AxiosRequestConfig): Promise<void> {
  try {
    await http.request<unknown>(config);
  } catch (error) {
    throw toApiRequestError(error);
  }
}

export function apiGet<T extends z.ZodType>(
  url: string,
  schema: T,
  config?: AxiosRequestConfig,
): Promise<z.infer<T>> {
  return apiRequest({ ...config, method: 'GET', url }, schema);
}

export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

/**
 * Fetches a file. A refusal still arrives as JSON, but inside a Blob because
 * that is what was asked for; it is unwrapped so the real message is shown.
 */
export async function apiDownload(
  config: AxiosRequestConfig,
  fallbackName: string,
): Promise<DownloadedFile> {
  try {
    const response = await http.request<Blob>({ method: 'GET', ...config, responseType: 'blob' });
    const disposition = String(response.headers['content-disposition'] ?? '');
    return {
      blob: response.data,
      filename: /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName,
    };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
      try {
        error.response.data = JSON.parse(await error.response.data.text()) as unknown;
      } catch {
        // Not JSON: fall through to the generic "unexpected response".
      }
    }
    throw toApiRequestError(error);
  }
}
