// Revalidasi sesi lewat GET /me — dan SATU-SATUNYA tempat yang memutuskan
// apakah sebuah kegagalan berarti "sesi berakhir" atau "server/jaringan sedang
// bermasalah".
//
// KENAPA. `auth-context.tsx` dulu menghapus sesi untuk SEMUA error dari /me.
// Saat pool DB habis (insiden 2026-10-19 10.50–10.55 WIB) /me ikut hang/5xx dan
// setiap tab yang sedang memvalidasi ulang melempar penggunanya ke /login —
// padahal cookie-nya masih sah. Hanya 401/403 yang berarti server MENOLAK sesi
// (401 di sini sudah melewati refresh-sekali di `api.ts`, jadi memang final).
// Timeout, galat jaringan, dan 5xx berarti server tidak bisa menjawab; sesi
// dipertahankan dan /me dicoba lagi dengan backoff.

import { ApiError, api } from '@/lib/api';
import type { MeResponse } from '@/lib/types';

export type SessionCheck =
  | { kind: 'valid'; me: MeResponse }
  | { kind: 'rejected' }
  | { kind: 'unreachable' };

/**
 * Batas tunggu /me. `api.ts` tidak memasang timeout, jadi /me yang hang (pool
 * habis) akan menggantung selamanya dan tak pernah dicoba ulang.
 */
export const ME_TIMEOUT_MS = 20_000;

const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/** True HANYA bila server menolak sesi — satu-satunya alasan menghapusnya. */
export function isSessionRejected(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

/** Backoff eksponensial: 2s, 4s, 8s, … dibatasi 60s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
}

export async function checkSession(timeoutMs = ME_TIMEOUT_MS): Promise<SessionCheck> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
  });
  try {
    const me = await Promise.race([api.get<MeResponse>('/me'), timeout]);
    return { kind: 'valid', me };
  } catch (err) {
    return isSessionRejected(err) ? { kind: 'rejected' } : { kind: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
