/**
 * `checkSession` — sesi hanya dihapus kalau server MENOLAK (401/403).
 *
 * Insiden 2026-10-19 10.50–10.55 WIB: pool DB habis, /me hang/5xx, dan
 * pengguna ter-logout sendiri karena `auth-context.tsx` menghapus sesi untuk
 * SEMUA error. Tes ini menjalankan jalur `api.ts` yang sesungguhnya (termasuk
 * refresh-sekali pada 401) dengan `fetch` palsu.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSession, retryDelayMs } from './session-check';

const ME = { employee: { id: 'EMP-1' }, role: 'staff' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockFetch(handler: (url: string) => Promise<Response>) {
  const fn = vi.fn((input: RequestInfo | URL) => handler(String(input)));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('checkSession', () => {
  it('200 → valid, membawa jawaban /me', async () => {
    mockFetch(async () => json(200, ME));
    expect(await checkSession()).toEqual({ kind: 'valid', me: ME });
  });

  it('401 (refresh juga gagal) → rejected: sesi HARUS dihapus', async () => {
    const fetch = mockFetch(async () => json(401, { error: '[sesi tidak valid, silahkan login kembali]' }));
    expect(await checkSession()).toEqual({ kind: 'rejected' });
    // Refresh tetap dicoba lebih dulu — 401 yang bisa diselamatkan tidak logout.
    expect(fetch.mock.calls.some(([u]) => String(u).endsWith('/auth/refresh'))).toBe(true);
  });

  it('403 → rejected', async () => {
    mockFetch(async () => json(403, { error: '[akses ditolak]' }));
    expect(await checkSession()).toEqual({ kind: 'rejected' });
  });

  it.each([500, 502, 503, 504])('%i → unreachable: sesi TIDAK boleh dihapus', async (status) => {
    mockFetch(async () => json(status, { error: '[galat]' }));
    expect(await checkSession()).toEqual({ kind: 'unreachable' });
  });

  it('galat jaringan → unreachable', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await checkSession()).toEqual({ kind: 'unreachable' });
  });

  it('timeout (/me menggantung) → unreachable, bukan menunggu selamanya', async () => {
    vi.useFakeTimers();
    mockFetch(() => new Promise<Response>(() => {}));
    const result = checkSession(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toEqual({ kind: 'unreachable' });
  });
});

describe('retryDelayMs', () => {
  it('eksponensial lalu dibatasi 60 detik', () => {
    expect([0, 1, 2, 3].map(retryDelayMs)).toEqual([2_000, 4_000, 8_000, 16_000]);
    expect(retryDelayMs(10)).toBe(60_000);
  });
});
