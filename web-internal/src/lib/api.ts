// Small typed fetch wrapper for the CDPS API.
// The apps/api backend returns error bodies shaped {"error": "[...bahasa
// indonesia...]"} (the legacy Go backend used {"message": ...}); we accept
// either key and normalize any failure into an ApiError carrying that exact
// string so pages can render the BI [...] message verbatim.

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

// The backend puts the verbatim BI [...] string under `error` (apps/api) or
// `message` (legacy Go backend). Return whichever string is present.
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
  put: <T,>(path: string, data?: unknown): Promise<T> =>
    request<T>(path, {
      method: 'PUT',
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
  delete: <T,>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
};

/** Extracts the verbatim [...] message from any thrown value, with a safe fallback. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return FALLBACK_MESSAGE;
}
