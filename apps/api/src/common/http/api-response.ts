/** Envelope returned by every successful API response. */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta: ApiResponseMeta;
}

/** Envelope returned by every failed API response. */
export interface ApiErrorResponse {
  success: false;
  error: {
    /** Stable, machine-readable code, e.g. `NOT_FOUND`. */
    code: string;
    /** Human-readable message that is safe to show to end users. */
    message: string;
    details?: unknown;
  };
  meta: ApiResponseMeta & { path: string };
}

export interface ApiResponseMeta {
  requestId: string | null;
  timestamp: string;
}
