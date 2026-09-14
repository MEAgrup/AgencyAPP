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

/**
 * Path of the refresh route, and the one path `request` must NEVER try to
 * refresh for — a 401 from the refresh route itself is the end of the session,
 * not something to retry (it would recurse).
 */
const REFRESH_PATH = '/auth/refresh';

/**
 * One shared in-flight refresh promise.
 *
 * A page routinely has several requests in the air at once (the Leads screen
 * fires per tab; the Strategi form autosaves while the gap count reloads). When
 * the access cookie expires they all 401 within milliseconds of each other. If
 * each one called `/auth/refresh` on its own, GoTrue would rotate the refresh
 * token N times concurrently and all but one of those rotations would be
 * racing a token the server had just retired — the session would die from the
 * very mechanism meant to keep it alive. So the FIRST 401 starts the refresh
 * and everyone else awaits the same promise.
 */
let inFlightRefresh: Promise<boolean> | null = null;

/**
 * Asks the server for a fresh access cookie. Resolves true when the session
 * carried on, false when it is genuinely over (the server has already cleared
 * both cookies in that case).
 *
 * Never throws: a network failure here resolves false, and the caller then
 * surfaces the ORIGINAL error rather than a confusing one about refreshing.
 */
export async function refreshSession(): Promise<boolean> {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = (async () => {
    try {
      const res = await fetch(`${API_BASE}${REFRESH_PATH}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      // Cleared in `finally` so a failed refresh does not pin a permanently
      // rejected promise that every later 401 would reuse.
      inFlightRefresh = null;
    }
  })();
  return inFlightRefresh;
}

async function request<T>(path: string, init: RequestInit = {}, retrying = false): Promise<T> {
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

  // An expired access cookie must not reach the user. Refresh once, then replay
  // the ORIGINAL request — including its body, which is why the retry happens
  // here rather than at each call site: this is the only fetch wrapper in the
  // app, so one branch covers every screen.
  //
  // Before this, a 401 mid-form was terminal: nothing redirected, nothing
  // retried, and the AM was left with a filled-in form that could never submit
  // ("harus ngulang lagi dari awal", field feedback 2026-09-14). `retrying`
  // bounds it to a single attempt so a server that 401s for some OTHER reason
  // cannot produce a loop.
  if (res.status === 401 && !retrying && path !== REFRESH_PATH) {
    if (await refreshSession()) {
      return request<T>(path, init, true);
    }
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

/**
 * Halaman terbesar yang boleh diminta sekali jalan — cermin `page.MAX_LIMIT` di
 * server (P2 §6). Server tetap otoritasnya dan meng-clamp nilai di atas ini.
 *
 * Dipakai oleh layar yang BUKAN daftar yang bisa digulir bertahap, melainkan
 * butuh himpunan lengkap dalam satu tarikan: inbox persetujuan (baris yang tak
 * pernah tampil tak pernah disetujui) dan lookup yang dijoin ke data lain
 * (nama campaign untuk baris metrik). Untuk daftar biasa, pakai tombol
 * "Muat lebih banyak", bukan konstanta ini.
 */
export const MAX_PAGE_LIMIT = 500;

/** Extracts the verbatim [...] message from any thrown value, with a safe fallback. */
/**
 * 403 saat MEMUAT sebuah panel berarti "panel ini bukan hak Anda" — bukan
 * kesalahan yang perlu diteriakkan. Client Record dulu merender tiga pita
 * MERAH untuk Sales staff yang justru PEMILIK klien itu (Unified Board,
 * Laporan, Upcoming Milestones semuanya milik Account/AM), sehingga layar yang
 * sehat tampak rusak — dan Director/OD tidak pernah melihatnya karena keduanya
 * lolos `jwt_can_read_all()`. Ditemukan UAT peramban 2026-09-10
 * (`UAT_SALES_BROWSER_20260910.md` §3, `OBS-1-PITA-GALAT`).
 *
 * ⚠️ Hanya untuk kegagalan MEMUAT. 403 atas sebuah AKSI tetap harus terlihat:
 * di situ pengguna menekan sesuatu dan berhak tahu kenapa ia ditolak.
 */
export function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return FALLBACK_MESSAGE;
}
