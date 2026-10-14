import type { ApiErrorBody } from '@gms/shared';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

export interface FieldError {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: FieldError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let csrfToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;

/** The CSRF token comes from GET /auth/me and is sent on every unsafe request. */
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

/** Called when any request (other than the session probe) gets 401, e.g. an expired session. */
export function setUnauthenticatedHandler(handler: (() => void) | null) {
  onUnauthenticated = handler;
}

// Zod input types for coerced fields (page, pageSize) are `unknown`; only primitives are sent.
type Query = Record<string, unknown>;

function buildUrl(path: string, query?: Query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (
      typeof value === 'string'
        ? value !== ''
        : typeof value === 'number' || typeof value === 'boolean'
    ) {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return `${BASE_URL}${path}${search ? `?${search}` : ''}`;
}

interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** The session probe handles 401 itself instead of triggering a global sign-out. */
  silent401?: boolean;
  signal?: AbortSignal;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Cannot reach the server. Check your connection and try again.',
    );
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = (payload as ApiErrorBody | null)?.error;
    const error = new ApiError(
      response.status,
      body?.code ?? 'HTTP_ERROR',
      body?.message ?? `The server answered with an error (${response.status}).`,
      body?.details ?? [],
    );
    if (response.status === 401 && !options.silent401) onUnauthenticated?.();
    throw error;
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('GET', path, options),
  post: <T = void>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
};

/** Human-friendly message for toasts and inline errors. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something unexpected happened. Please try again.';
}
