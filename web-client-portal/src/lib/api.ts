// Small typed fetch wrapper for the CDPS API — verbatim copy of
// web-internal/src/lib/api.ts's contract (same backend, same error envelope
// shape: {"error": "[...bahasa indonesia...]"}). Kept as a separate copy
// rather than a shared package because these are two independently deployed
// Next apps with no shared build today; if a third realm needs the same
// wrapper, extracting a shared `@cdps/web-client` package becomes worth it.

const API_BASE = '/api/v1';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const FALLBACK_MESSAGE = '[Terjadi kesalahan, silahkan coba lagi.]';

function errorBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { error?: unknown; message?: unknown };
  if (typeof b.error === 'string') return b.error;
  if (typeof b.message === 'string') return b.message;
  return null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(FALLBACK_MESSAGE, 0);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const message = errorBody(body) ?? FALLBACK_MESSAGE;
    throw new ApiError(message, res.status);
  }

  return body as T;
}

export const api = {
  get: <T,>(path: string): Promise<T> => request<T>(path, { method: 'GET' }),
  post: <T,>(path: string, data?: unknown): Promise<T> =>
    request<T>(path, {
      method: 'POST',
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
};

/** Extracts the verbatim [...] message from any thrown value, with a safe fallback. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return FALLBACK_MESSAGE;
}
