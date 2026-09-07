/**
 * GET /api/v1/showcase — daftar "Klien Terbaik" untuk pemirsa ini (Gelombang C).
 *
 * Rute ini adalah SATU-SATUNYA pintu yang divisi Sales punya ke data klien
 * (C-1, keputusan pemilik 2026-09-07 — pengecualian pertama terhadap Role
 * Matrix Fase 0 §4). Tiga hal karena itu berlaku di sini dan tidak boleh
 * dilonggarkan tanpa keputusan pemilik baru:
 *
 *   * hanya GET — tidak ada jalur tulis di path ini sama sekali;
 *   * penyaringan izin (C-3) dan baris auditnya (pagar (c)) ada di DOMAIN,
 *     bukan di sini, supaya rute kedua yang lupa memanggilnya tidak mungkin;
 *   * pola bacanya `db()` + gerbang domain, SENGAJA bukan `readAsActor` —
 *     aktor Sales tidak ada di policy RLS `client_reports`, jadi `readAsActor`
 *     akan mengembalikan daftar kosong tanpa satu pun pesan salah. Gerbangnya
 *     ditegakkan di TS; izin yang menyempitkan barisnya.
 */
import { showcase } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { showcaseViewToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    return json(showcaseViewToWire(await showcase.listShowcase(db(), actor)));
  });
}
