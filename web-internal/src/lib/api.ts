// Small typed fetch wrapper for the CDPS API.
// Every backend error body is {"message": "[...bahasa indonesia...]"} — we
// normalize any failure into an ApiError carrying that exact string so pages
// can render it verbatim.

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
    const message =
      body && typeof body === 'object' && 'message' in body && typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : FALLBACK_MESSAGE;
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
